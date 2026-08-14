import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { constants as fsConstants, existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import * as acp from "@agentclientprotocol/sdk";
import type {
  AgentCapabilities,
  AuthMethod,
  ContentBlock,
  SessionConfigOption,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
import type {
  AcpAgentDescriptor,
  AcpBridgeEvent,
  AcpPermissionRequest,
  AcpPromptInput,
  AcpReplacePromptInput,
  AcpSessionState,
} from "../contracts/acp.ts";
import type { OpenTabsState, Thread } from "../contracts/threads.ts";
import { readOpenTabsState, recordThreadSwitch } from "./open-tabs.ts";
import { getProject } from "./projects.ts";
import { getSelectedAgentIds } from "./db.ts";
import { setActiveProjectId } from "./session.ts";
import {
  getThread,
  listThreads,
  createThread as createThreadRow,
  updateThreadTitle,
  updateThreadAgentSessionId,
  touchThread,
  getThreadSortOrder,
  deleteThread as removeThreadRow,
} from "./threads.ts";
import {
  updateLaunchSelection,
  updateWorkspaceSelection,
  readLaunchState,
} from "./launch-state.ts";
import { normalizeWorkspacePath, pickWorkspaceThread } from "../contracts/workspace-scope.ts";
import { isLiveWorktree } from "./worktree-manager.ts";
import {
  getAgentDescriptor,
  getDefaultAgentId,
  listRegisteredAgents,
  resolveAgentSpawn,
} from "./agents/registry.ts";
import { listMcpServers, toAcpMcpServers } from "./mcp-servers.ts";
import { SubagentManager } from "./subagents/subagent-manager.ts";
import { TerminalManager } from "./terminal-manager.ts";
import {
  applySessionUpdate,
  applyTurnStop,
  appendLocalUserMessage,
  assemblePromptBlocks,
  createEmptySessionSlice,
  type AcpSessionSlice,
} from "../src/lib/acp-session-reducer.ts";
import type { AnalyticsEventName, AnalyticsProperties } from "./analytics-schema.ts";
import type {
  MonitorProcessDescriptor,
  MonitorSwitchPhase,
  MonitorSwitchRecord,
} from "../contracts/monitor.ts";

export interface AgentMonitorObserver {
  onConnectionSpawned: (input: {
    connectionId: string;
    agentId: string;
    pid: number;
    spawnedAt: number;
    previousConnectionId: string | null;
  }) => void;
  onConnectionReady?: (input: { connectionId: string; initializedAt: number }) => void;
  onConnectionClosed?: (input: {
    connectionId: string;
    agentId: string;
    pid: number | null;
    activeThreadId: string | null;
    runningThreadIds: string[];
    spawnedAt: number;
    intentional: boolean;
    stderrTail: string;
  }) => void;
  onConnectionExit: (input: {
    connectionId: string;
    agentId: string;
    pid: number | null;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    activeThreadId: string | null;
    runningThreadIds: string[];
    spawnedAt: number;
    intentional: boolean;
    stderrTail: string;
  }) => void;
  /** Fired once per thread activation with the resolved cache phase. */
  onSwitchRecord?: (record: MonitorSwitchRecord) => void;
}

const ACP_SWITCH_PHASE_TIMEOUT_MS = 10_000;
const ACP_PROMPT_TIMEOUT_MS = 10 * 60_000;

function modelOptionsFromConfig(
  options: SessionConfigOption[] | undefined,
): Array<{ modelId: string; name: string; provider?: string }> {
  const option =
    options?.find((o) => o.category === "model") ?? options?.find((o) => o.id === "model");
  if (!option || option.type !== "select" || !Array.isArray(option.options)) return [];
  const out: Array<{ modelId: string; name: string; provider?: string }> = [];
  for (const item of option.options as Array<Record<string, unknown>>) {
    if (typeof item.value === "string") {
      let modelId = item.value;
      let name = typeof item.name === "string" ? item.name : item.value;
      if (modelId.includes("\t")) {
        const parts = modelId.split("\t");
        modelId = parts[1]?.trim() || parts[0]?.trim() || modelId;
        name = parts[1]?.trim() || name;
      }
      out.push({
        modelId,
        name,
        provider: typeof item.provider === "string" ? item.provider : undefined,
      });
      continue;
    }
    if (!Array.isArray(item.options)) continue;
    const provider = typeof item.name === "string" ? item.name : undefined;
    for (const nested of item.options as Array<Record<string, unknown>>) {
      if (typeof nested.value !== "string") continue;
      let modelId = nested.value;
      let name = typeof nested.name === "string" ? nested.name : nested.value;
      if (modelId.includes("\t")) {
        const parts = modelId.split("\t");
        modelId = parts[1]?.trim() || parts[0]?.trim() || modelId;
        name = parts[1]?.trim() || name;
      }
      out.push({
        modelId,
        name,
        provider: typeof nested.provider === "string" ? nested.provider : provider,
      });
    }
  }
  return out;
}

function requestWithTimeout<T>(
  request: Promise<T>,
  timeoutMs: number,
  phase: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`${phase} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    request.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function terminateChildProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) return;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  const timer = new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 2_000);
    timeout.unref?.();
  });
  await Promise.race([exited, timer]);
  if (child.exitCode == null && child.signalCode == null) {
    try {
      child.kill("SIGKILL");
    } catch {
      // best effort
    }
    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 2_000);
        timeout.unref?.();
      }),
    ]);
  }
}

type SendToRenderer = (channel: string, payload: unknown) => void;
type EventSendToRenderer = (event: AcpBridgeEvent) => void;
type SetWindowTitle = (title: string) => void;
interface LiveConnection {
  connectionId: string;
  agentId: string;
  agentInfoName: string;
  process: ChildProcessWithoutNullStreams;
  connection: acp.ClientConnection;
  agent: acp.ClientContext;
  agentCapabilities: AgentCapabilities;
  authMethods: AuthMethod[];
  /**
   * Set only when the agent actually rejects `session/new` with an
   * `auth_required` error — i.e. the user is genuinely not signed in. This is
   * distinct from `authMethods`, which merely advertises the auth flows the
   * agent *supports* and is present even for signed-in users, so it must never
   * be used to decide whether authentication is required.
   */
  authRequiredMessage: string | null;
  /**
   * Non-standard model catalog some agents (e.g. Grok) advertise in the
   * initialize result's `_meta.modelState` instead of via session config
   * options. When present we synthesize a "model" config option from it and
   * route model switches through the custom `session/set_model` method.
   */
  modelState?: {
    currentModelId?: string | null;
    availableModels?: Array<{ modelId: string; name: string }>;
  } | null;
  closed: Promise<void>;
}

interface ThreadSessionRuntime {
  threadId: string;
  agentSessionId: string;
  /** Which agent process owns this session. */
  agentId: string;
  projectId: string;
  cwd: string;
  slice: AcpSessionSlice;
  editorText: string;
  /**
   * True only between a client-initiated prompt request being sent and its
   * response resolving. `isStreaming` (which drives the composer's stop button
   * and the tab's working indicator) is set true by every agent chunk/tool_call
   * in `applySessionUpdate`, but is only cleared by `applyTurnStop` when the
   * prompt request resolves. Without this flag, a `session/update` that arrives
   * after the turn ends — a late flush, or an agent streaming background work
   * out-of-band — would flip `isStreaming` back to true with nothing left to
   * clear it, sticking the loader forever. Updates outside an active turn are
   * clamped to non-streaming in `handleSessionUpdate`.
   */
  promptInFlight: boolean;
}

interface PendingPermission {
  resolve: (response: acp.RequestPermissionResponse) => void;
  request: AcpPermissionRequest;
  timer: ReturnType<typeof setTimeout>;
}

interface QueuedPrompt {
  blocks: ContentBlock[];
  streamingBehavior?: "followUp" | "steer";
  resolve: (result: any) => void;
  reject: (error: unknown) => void;
}

/**
 * True when an ACP request rejected with the protocol's `auth_required` error.
 * The SDK's `RequestError.authRequired()` helper emits code -32000 with an
 * "Authentication required" message; -32000 is a generic server-error code
 * reused for other failures (permission/turn), so we also match the message.
 */
function isAuthRequiredError(err: unknown): boolean {
  if (!(err instanceof acp.RequestError)) return false;
  return err.code === -32000 && /auth(?:entication)?[\s_-]*required/i.test(err.message);
}

/**
 * `O_NOFOLLOW` refuses to open a final path component that is a symlink, so a
 * symlink swapped in after the containment check can't redirect an agent's
 * read/write out of the workspace (TOCTOU). Unavailable on Windows — fall back
 * to plain flags there.
 */
const NO_FOLLOW = process.platform !== "win32" && typeof fsConstants.O_NOFOLLOW === "number";

function readFileOptions(): { encoding: "utf8"; flag?: number } {
  return NO_FOLLOW
    ? { encoding: "utf8", flag: fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW }
    : { encoding: "utf8" };
}

function writeFileOptions(): { encoding: "utf8"; flag?: number } {
  return NO_FOLLOW
    ? {
        encoding: "utf8",
        flag:
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW,
      }
    : { encoding: "utf8" };
}

function emptySessionState(): AcpSessionState {
  return {
    projectId: null,
    threadId: null,
    agentId: null,
    agentSessionId: null,
    cwd: null,
    title: null,
    configOptions: [],
    commands: [],
    entries: [],
    toolCalls: {},
    plan: null,
    usage: null,
    currentModeId: null,
    isStreaming: false,
    isCompacting: false,
    editorText: "",
    authRequiredMessage: null,
    switchingAgent: false,
  };
}

/**
 * Spawns ACP agent processes, owns sessions, and bridges session/update to the renderer.
 * Replaces the pi-sdk AgentManager.
 */
export class AgentConnectionManager {
  private readonly sendToRenderer: SendToRenderer;
  private readonly setWindowTitle: SetWindowTitle;
  private readonly broadcastActiveProject?: (projectId: string) => void;
  private readonly captureAnalytics?: (
    name: AnalyticsEventName,
    properties: AnalyticsProperties,
  ) => void;
  private readonly setAgentContext?: (
    ctx: { agentId?: string | null; agentName?: string | null; modelId?: string | null } | null,
  ) => void;

  private connection: LiveConnection | null = null;
  private connecting: Promise<LiveConnection> | null = null;
  /** In-flight spawn per agentId, so concurrent callers share one spawn instead of racing. */
  private readonly spawning = new Map<string, Promise<LiveConnection>>();
  /**
   * Keep one live ACP transport per agent. ACP sessions belong to the agent
   * process that created them, so tearing this down on every cross-agent
   * thread switch made switching require a new process plus session restore.
   */
  private readonly connections = new Map<string, LiveConnection>();
  private activeProjectId: string | null = null;
  private activeThreadId: string | null = null;
  private preferredAgentId: string = getDefaultAgentId();
  private readonly sessions = new Map<string, ThreadSessionRuntime>();
  /**
   * Session replay is delivered as session/update notifications while
   * session/load is still in flight. Keep those notifications in the main
   * process until the activation can publish one complete authoritative state.
   */
  private readonly loadingSessionThreads = new Set<string>();
  /**
   * Path guard: ACP session id → the set of filesystem roots that session may
   * touch. Seeded from the session's cwd (the worktree or project root) so a
   * worktree-bound agent can't read/write into a sibling worktree. Sessions
   * absent from the map are unguarded. See
   * docs/worktree.md "Threat model".
   */
  private readonly workspaceRoots = new Map<string, Set<string>>();
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private permissionRequestSequence = 0;
  /** Local rejectors make abort/timeout settle prompt callers even if ACP ignores cancel. */
  private readonly pendingPromptCancels = new Map<string, () => void>();
  private readonly queuedPrompts = new Map<string, QueuedPrompt[]>();
  private readonly terminalManager: TerminalManager;
  /** Client-hosted subagent tool: lets any session spawn sibling agent sessions. */
  private readonly subagents: SubagentManager;
  /** Dedup key for the last broadcast running-threads set. */
  private lastRunningThreadsKey = "";
  /** Per tool-call start timestamps for `tool_call_finished` timing, keyed `${sessionId}:${toolCallId}`. */
  private readonly toolCallStarts = new Map<string, { startedAt: number; kind?: string }>();
  private monitorObserver: AgentMonitorObserver | null = null;
  private readonly connectionSpawnedAt = new Map<string, number>();
  private readonly intentionalConnectionIds = new Set<string>();
  private readonly lastConnectionIds = new Map<string, string>();
  private threadActivationQueue: Promise<unknown> = Promise.resolve();
  private activationGeneration = 0;
  private readonly threadActivationGenerations = new Map<string, number>();

  private currentEditorText = "";

  constructor(options: {
    sendToRenderer: SendToRenderer | EventSendToRenderer;
    setWindowTitle: SetWindowTitle;
    broadcastActiveProject?: (projectId: string) => void;
    captureAnalytics?: (name: AnalyticsEventName, properties: AnalyticsProperties) => void;
    setAgentContext?: (
      ctx: { agentId?: string | null; agentName?: string | null; modelId?: string | null } | null,
    ) => void;
  }) {
    this.sendToRenderer =
      options.sendToRenderer.length <= 1
        ? (_channel, payload) =>
            (options.sendToRenderer as EventSendToRenderer)(payload as AcpBridgeEvent)
        : (options.sendToRenderer as SendToRenderer);
    this.setWindowTitle = options.setWindowTitle;
    this.broadcastActiveProject = options.broadcastActiveProject;
    this.captureAnalytics = options.captureAnalytics;
    this.setAgentContext = options.setAgentContext;
    this.terminalManager = new TerminalManager({
      onOutput: (terminalId, chunk) => {
        this.emit({ type: "terminal-output", terminalId, output: chunk, append: true });
      },
    });
    this.subagents = new SubagentManager({
      host: {
        acquireConnection: async (agentId) => {
          const live = await this.acquireConnection(agentId);
          return {
            agentId: live.agentId,
            agentCapabilities: live.agentCapabilities,
            agent: live.agent,
          };
        },
        baseMcpServers: (caps) => toAcpMcpServers(listMcpServers(), caps.mcpCapabilities),
        emitEvent: (event) => this.emit(event),
      },
      captureAnalytics: (name, properties) => this.captureAnalytics?.(name, properties),
    });
    void this.subagents.init();
  }

  getSubagentConfig() {
    return this.subagents.getConfig();
  }

  setSubagentConfig(partial: Parameters<SubagentManager["setConfig"]>[0]) {
    return this.subagents.setConfig(partial);
  }

  getSubagentRuns() {
    return this.subagents.getRunSnapshots();
  }

  listAgents(): AcpAgentDescriptor[] {
    // Always re-probe PATH so onboarding reflects install state.
    return listRegisteredAgents();
  }

  async getModelCatalogs(): Promise<
    Record<string, Array<{ modelId: string; name: string; provider?: string }>>
  > {
    // Draft model pickers need catalogs before a thread exists. Warm every
    // selected agent so the picker is not limited to whichever providers have
    // already been used in a live session. A provider that is unavailable or
    // needs authentication is skipped; its catalog can still be populated by
    // a later successful session.
    const selectedAgentIds = getSelectedAgentIds();
    await Promise.all(
      selectedAgentIds.map(async (agentId) => {
        try {
          await this.acquireConnection(agentId);
        } catch {
          // Best effort: one unavailable provider must not hide the others.
        }
      }),
    );

    const result: Record<string, Array<{ modelId: string; name: string; provider?: string }>> = {};
    const add = (
      agentId: string,
      models: Array<{ modelId: string; name: string; provider?: string }>,
    ) => {
      if (!models.length) return;
      const current = result[agentId] ?? [];
      const seen = new Set(current.map((model) => `${model.provider ?? ""}:${model.modelId}`));
      for (const model of models) {
        const key = `${model.provider ?? ""}:${model.modelId}`;
        if (!seen.has(key)) {
          seen.add(key);
          current.push(model);
        }
      }
      result[agentId] = current;
    };
    for (const runtime of this.sessions.values()) {
      add(runtime.agentId, modelOptionsFromConfig(runtime.slice.configOptions));
    }
    for (const live of this.connections.values()) {
      add(
        live.agentId,
        (live.modelState?.availableModels ?? []).map((model) => ({
          modelId: model.modelId,
          name: model.name,
        })),
      );
    }

    // A number of ACP agents only advertise model choices in the
    // session/new response, not initialize. Probe a temporary session for
    // selected agents whose catalog is still empty so draft @model is not
    // limited to providers with a currently open thread.
    const catalogCwd =
      this.getActiveCwd() ??
      (this.activeProjectId
        ? (getProject(this.activeProjectId)?.path ?? process.cwd())
        : process.cwd());
    await Promise.all(
      selectedAgentIds.map(async (agentId) => {
        if (result[agentId]?.length) return;
        const live = this.connections.get(agentId);
        if (!live) return;
        let attached: Awaited<ReturnType<typeof this.sessionMcpServers>> | null = null;
        let sessionId: string | null = null;
        try {
          attached = await this.sessionMcpServers(live, catalogCwd);
          const created = (await requestWithTimeout(
            live.agent.request(acp.methods.agent.session.new, {
              cwd: catalogCwd,
              mcpServers: attached.servers as never,
            }),
            ACP_SWITCH_PHASE_TIMEOUT_MS,
            "agent/model-catalog-session-new",
          )) as { sessionId: string; configOptions?: SessionConfigOption[] | null };
          sessionId = created.sessionId;
          add(
            agentId,
            modelOptionsFromConfig(this.withModelOption(live, created.configOptions ?? [])),
          );
        } catch {
          // Model discovery is best effort; the provider can still populate
          // its catalog when the user opens a real thread later.
        } finally {
          if (sessionId) {
            try {
              await requestWithTimeout(
                live.agent.request(acp.methods.agent.session.close, { sessionId }),
                ACP_SWITCH_PHASE_TIMEOUT_MS,
                "agent/model-catalog-session-close",
              );
            } catch {
              // best effort
            }
          }
          attached?.release();
        }
      }),
    );
    return result;
  }

  getPreferredAgentId(): string {
    return this.preferredAgentId;
  }

  setPreferredAgentId(agentId: string): void {
    const agent = getAgentDescriptor(agentId);
    if (!agent) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    if (agent.available === false) {
      throw new Error(
        agent.statusMessage ??
          `${agent.displayName} is not installed. ${agent.installHint ?? ""}`.trim(),
      );
    }
    this.preferredAgentId = agentId;
  }

  private emit(payload: AcpBridgeEvent): void {
    this.sendToRenderer("agent:event", payload);
  }

  getState(): AcpSessionState {
    const threadId = this.activeThreadId;
    if (!threadId) {
      return {
        ...emptySessionState(),
        projectId: this.activeProjectId,
        agentId: this.connection?.agentId ?? this.preferredAgentId,
        authRequiredMessage: this.authMessage(),
      };
    }
    return this.buildSessionState(threadId);
  }

  /**
   * The active thread's working directory — its bound worktree (validated), else
   * the project root. This is the app's single source of truth for "where am I",
   * so file listings and other cwd-relative surfaces follow a worktree switch
   * automatically (switching a worktree switches the active thread).
   */
  getActiveCwd(): string | null {
    const threadId = this.activeThreadId;
    if (!threadId) return null;
    const runtime = this.sessions.get(threadId);
    if (runtime) return runtime.cwd;
    const thread = getThread(threadId);
    if (!thread) return null;
    const project = getProject(thread.project_id);
    if (!project) return null;
    return this.resolveThreadCwd(thread.worktree_path, project.path);
  }

  /** Clear the live view when the user closes the last open thread tab. */
  async clearActiveThread(): Promise<void> {
    this.activeThreadId = null;
    await updateLaunchSelection({ projectId: this.activeProjectId, threadId: null });
    this.pushState(null);
  }

  private authMessage(): string | null {
    // Only surfaced after a real `auth_required` failure from `session/new`.
    // An agent advertising `authMethods` at `initialize` is NOT a sign-in
    // signal — signed-in agents advertise them too — so we must not nag based
    // on that alone (that false positive is what made onboarding unreliable).
    return this.connection?.authRequiredMessage ?? null;
  }

  private buildSessionState(threadId: string): AcpSessionState {
    const runtime = this.sessions.get(threadId);
    const thread = getThread(threadId);
    if (!runtime) {
      return {
        ...emptySessionState(),
        projectId: thread?.project_id ?? this.activeProjectId,
        threadId,
        agentId: thread?.agent_id ?? this.connection?.agentId ?? null,
        agentSessionId: thread?.agent_session_id ?? null,
        title: thread?.title ?? null,
        authRequiredMessage: this.authMessage(),
      };
    }
    return {
      projectId: runtime.projectId,
      threadId: runtime.threadId,
      agentId: runtime.agentId,
      agentSessionId: runtime.agentSessionId,
      cwd: runtime.cwd,
      title: runtime.slice.title ?? thread?.title ?? null,
      configOptions: runtime.slice.configOptions,
      commands: runtime.slice.commands,
      entries: runtime.slice.entries,
      toolCalls: runtime.slice.toolCalls,
      plan: runtime.slice.plan,
      usage: runtime.slice.usage,
      currentModeId: runtime.slice.currentModeId,
      isStreaming: runtime.slice.isStreaming,
      isCompacting: false,
      editorText: runtime.editorText,
      authRequiredMessage: this.connectionForAgent(runtime.agentId)?.authRequiredMessage ?? null,
      switchingAgent: false,
    };
  }

  private pushState(threadId?: string | null): void {
    const id = threadId ?? this.activeThreadId;
    // Only the ACTIVE thread's state may become the renderer's snapshot. A
    // background thread's turn completing — or an abandoned session settling
    // after a switch — must not clobber the view the user is looking at
    // (snapshot cwd/thread drive the header workspace mirror and tab focus).
    // Its streaming flags still reach the tab strip via running-threads.
    if (id && id !== this.activeThreadId) {
      this.emitRunningThreads();
      return;
    }
    const runtime = id ? this.sessions.get(id) : null;
    if (runtime) {
      this.emit({
        type: "thread-tool-calls",
        threadId: runtime.threadId,
        toolCalls: runtime.slice.toolCalls,
      });
    }
    if (!id) {
      this.emit({ type: "session-state", state: this.getState() });
    } else {
      this.emit({ type: "session-state", state: this.buildSessionState(id) });
    }
    this.emitRunningThreads();
  }

  setMonitorObserver(observer: AgentMonitorObserver | null): void {
    this.monitorObserver = observer;
  }

  getMonitorProcessDescriptors(): MonitorProcessDescriptor[] {
    const running = new Set(this.getRunningThreadIds());
    const entries: MonitorProcessDescriptor[] = [];

    for (const [agentId, live] of this.connections) {
      const pid = live.process.pid;
      if (!pid) continue;
      const threadIds = [...this.sessions.entries()]
        .filter(([, runtime]) => runtime.agentId === agentId)
        .map(([threadId]) => threadId);
      const primaryThreadId =
        threadIds.find((threadId) => threadId === this.activeThreadId) ?? threadIds[0];
      entries.push({
        pid,
        role: "acp-agent",
        label: live.agentInfoName || agentId,
        agentId,
        threadId: primaryThreadId,
        threadIds,
        streamingThreadIds: threadIds.filter((threadId) => running.has(threadId)),
        isStreaming: threadIds.some((threadId) => running.has(threadId)),
      });
    }

    for (const terminal of this.terminalManager.getActiveProcesses()) {
      entries.push({
        pid: terminal.pid,
        role: "terminal",
        label: `Agent shell ${terminal.terminalId.slice(0, 8)}`,
        sessionId: terminal.terminalId,
      });
    }

    return entries;
  }

  /** Thread IDs whose agent is currently streaming (across every open thread). */
  getRunningThreadIds(): string[] {
    const running: string[] = [];
    for (const [threadId, runtime] of this.sessions) {
      if (runtime.slice.isStreaming) running.push(threadId);
    }
    return running.sort();
  }

  /** Broadcast the running-thread set to the renderer when it changes. */
  private emitRunningThreads(): void {
    const running = this.getRunningThreadIds();
    const key = running.join(",");
    if (key === this.lastRunningThreadsKey) return;
    this.lastRunningThreadsKey = key;
    this.emit({ type: "running-threads", threadIds: running });
  }

  async ensureConnection(agentId?: string): Promise<LiveConnection> {
    const targetId = agentId ?? this.preferredAgentId;
    if (this.connection && this.connection.agentId === targetId) {
      return this.connection;
    }
    const cached = this.connections.get(targetId);
    if (cached) {
      this.connection = cached;
      return cached;
    }
    if (this.connecting) {
      const live = await this.connecting;
      if (live.agentId === targetId) return live;
    }
    this.connecting = this.switchAgent(targetId);
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  /**
   * Get (or spawn) a live connection for an agent WITHOUT making it the
   * active UI agent — used by subagent runs so an orchestrator spawning e.g.
   * Codex doesn't flip the composer over to Codex.
   */
  async acquireConnection(agentId: string): Promise<LiveConnection> {
    const descriptor = getAgentDescriptor(agentId);
    if (!descriptor) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    const cached = this.connections.get(agentId);
    if (cached) return cached;
    let pending = this.spawning.get(agentId);
    const isNewSpawn = !pending;
    const spawnStartedAt = Date.now();
    if (!pending) {
      pending = this.spawnAndInitialize(descriptor).finally(() => this.spawning.delete(agentId));
      this.spawning.set(agentId, pending);
    }
    try {
      const live = await pending;
      this.connections.set(agentId, live);
      if (isNewSpawn) {
        this.captureAnalytics?.("agent_connected", {
          ...this.agentProps(agentId),
          connect_duration_ms: Date.now() - spawnStartedAt,
          install_kind: descriptor.installKind,
        });
      }
      return live;
    } catch (err) {
      if (isNewSpawn) {
        this.captureAnalytics?.("agent_connection_failed", {
          ...this.agentProps(agentId),
          error_type: err instanceof Error ? err.name : undefined,
        });
      }
      throw err;
    }
  }

  async switchAgent(agentId: string): Promise<LiveConnection> {
    this.emit({
      type: "session-state",
      state: { ...this.getState(), switchingAgent: true },
    });

    const previousAgentId = this.connection?.agentId ?? null;
    const live = await this.acquireConnection(agentId);
    this.connection = live;
    this.preferredAgentId = agentId;
    if (previousAgentId && previousAgentId !== live.agentId) {
      this.captureAnalytics?.("agent_switched", {
        from_agent_id: previousAgentId,
        to_agent_id: live.agentId,
        agent_name: getAgentDescriptor(live.agentId)?.name,
      });
    }

    this.emit({
      type: "connection",
      agentId: live.agentId,
      agentCapabilities: live.agentCapabilities,
      authMethods: live.authMethods,
      authRequiredMessage: live.authRequiredMessage,
    });
    this.pushState();
    return live;
  }

  private async spawnAndInitialize(descriptor: AcpAgentDescriptor): Promise<LiveConnection> {
    const { command, args, env } = resolveAgentSpawn(descriptor);
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    }) as ChildProcessWithoutNullStreams;

    const connectionId = randomUUID();
    const spawnedAt = Date.now();
    const previousConnectionId = this.lastConnectionIds.get(descriptor.id) ?? null;
    let stderrTail = "";
    const appendStderr = (buf: Buffer): void => {
      const text = buf.toString("utf8");
      stderrTail = `${stderrTail}${text}`.slice(-16_384);
    };

    child.stderr.on("data", (buf: Buffer) => {
      appendStderr(buf);
      const text = buf.toString("utf8").trim();
      if (text) console.error(`[acp-agent:${descriptor.id}]`, text);
    });

    // Register the lifecycle before the handshake. A process that dies or
    // times out during initialize is still a real connection episode and must
    // not disappear from diagnostics.
    this.connectionSpawnedAt.set(connectionId, spawnedAt);
    this.lastConnectionIds.set(descriptor.id, connectionId);
    this.monitorObserver?.onConnectionSpawned({
      connectionId,
      agentId: descriptor.id,
      pid: child.pid ?? 0,
      spawnedAt,
      previousConnectionId,
    });
    let exitReported = false;
    const reportExit = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (exitReported) return;
      exitReported = true;
      this.monitorObserver?.onConnectionExit({
        connectionId,
        agentId: descriptor.id,
        pid: child.pid ?? null,
        exitCode,
        signal,
        activeThreadId: this.activeThreadId,
        runningThreadIds: this.getRunningThreadIds(),
        spawnedAt,
        intentional: this.intentionalConnectionIds.has(connectionId),
        stderrTail,
      });
      this.connectionSpawnedAt.delete(connectionId);
      this.intentionalConnectionIds.delete(connectionId);
      const current = this.connections.get(descriptor.id);
      if (this.connection?.process === child) this.connection = null;
      if (current?.process === child) {
        this.connections.delete(descriptor.id);
        this.invalidateAgentSessions(descriptor.id);
      }
    };
    child.on("exit", reportExit);

    const input = Writable.toWeb(child.stdin);
    const output = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
    const stream = acp.ndJsonStream(input, output);

    let agentCtx!: acp.ClientContext;
    let initResult!: acp.InitializeResponse;

    const app = acp
      .client({ name: "pipper" })
      .onNotification(acp.methods.client.session.update, async (ctx) => {
        await this.handleSessionUpdate(ctx.params.sessionId, ctx.params.update);
      })
      .onRequest(acp.methods.client.session.requestPermission, async (ctx) => {
        return this.handlePermissionRequest(ctx.params, ctx.requestId);
      })
      .onRequest(acp.methods.client.fs.readTextFile, async (ctx) => {
        return this.handleReadTextFile(ctx.params);
      })
      .onRequest(acp.methods.client.fs.writeTextFile, async (ctx) => {
        return this.handleWriteTextFile(ctx.params);
      })
      .onRequest(acp.methods.client.terminal.create, async (ctx) => {
        // Option A path guard: bound the terminal's *starting* cwd to the
        // session's workspace. The spawned process can still `cd` out — an
        // honest agent won't; a hard boundary (OS sandbox) is deferred. See
        // docs/worktree.md "Threat model".
        if (ctx.params.cwd) {
          this.assertWithinWorkspace(ctx.params.sessionId, ctx.params.cwd);
        }
        const terminalId = this.terminalManager.create({
          command: ctx.params.command,
          args: ctx.params.args ?? undefined,
          cwd: ctx.params.cwd ?? undefined,
          sessionId: ctx.params.sessionId,
          env: ctx.params.env as never,
          outputByteLimit: ctx.params.outputByteLimit ?? undefined,
        });
        return { terminalId };
      })
      .onRequest(acp.methods.client.terminal.output, async (ctx) => {
        const out = this.terminalManager.getOutput(ctx.params.terminalId);
        return {
          output: out.output,
          truncated: out.truncated,
          exitStatus: out.exitStatus,
        };
      })
      .onRequest(acp.methods.client.terminal.waitForExit, async (ctx) => {
        const result = await this.terminalManager.waitForExit(
          ctx.params.terminalId,
          ACP_SWITCH_PHASE_TIMEOUT_MS,
        );
        return { exitCode: result.exitCode, signal: result.signal };
      })
      .onRequest(acp.methods.client.terminal.kill, async (ctx) => {
        this.terminalManager.kill(ctx.params.terminalId);
        return {};
      })
      .onRequest(acp.methods.client.terminal.release, async (ctx) => {
        this.terminalManager.release(ctx.params.terminalId);
        return {};
      });

    const connection = app.connect(stream);
    agentCtx = connection.agent;

    try {
      initResult = await requestWithTimeout(
        agentCtx.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true,
          },
          clientInfo: {
            name: "pipper",
            title: "Pipper",
            version: "0.0.20",
          },
        }),
        ACP_SWITCH_PHASE_TIMEOUT_MS,
        "agent/initialize",
      );
    } catch (err) {
      // A timed-out handshake has no usable owner. Close both sides so the
      // abandoned request cannot keep the child process and transport alive.
      try {
        connection.close();
      } catch {
        // best effort
      }
      await terminateChildProcess(child);
      throw err;
    }

    const agentInfoName = initResult.agentInfo?.name ?? descriptor.name ?? descriptor.id;
    const agentCapabilities = initResult.agentCapabilities ?? {};
    const authMethods = initResult.authMethods ?? [];
    const modelState =
      (initResult as { _meta?: { modelState?: LiveConnection["modelState"] } })._meta?.modelState ??
      null;

    const closed = connection.closed.then(() => {
      // A transport can close while its child is still alive. That is a
      // different failure mode from a process exit and must be visible in the
      // incident log. The exit handler owns the latter case.
      if (child.exitCode == null && child.signalCode == null) {
        this.monitorObserver?.onConnectionClosed?.({
          connectionId,
          agentId: descriptor.id,
          pid: child.pid ?? null,
          activeThreadId: this.activeThreadId,
          runningThreadIds: this.getRunningThreadIds(),
          spawnedAt,
          intentional: this.intentionalConnectionIds.has(connectionId),
          stderrTail,
        });
      }
      const current = this.connections.get(descriptor.id);
      if (this.connection?.process === child) this.connection = null;
      if (current?.process === child) {
        this.connections.delete(descriptor.id);
        this.invalidateAgentSessions(descriptor.id);
      }
    });

    this.monitorObserver?.onConnectionReady?.({ connectionId, initializedAt: Date.now() });

    return {
      connectionId,
      agentId: descriptor.id,
      agentInfoName,
      process: child,
      connection,
      agent: agentCtx,
      agentCapabilities,
      authMethods,
      authRequiredMessage: null,
      modelState,
      closed,
    };
  }

  private async closeConnection(): Promise<void> {
    this.connection = null;
    this.cancelAllPendingPermissions();
    for (const threadId of this.pendingPromptCancels.keys()) {
      this.cancelPendingPrompt(threadId, "connection closed");
      this.rejectQueuedPrompts(threadId, "agent connection closed");
    }
    for (const threadId of this.queuedPrompts.keys()) {
      this.rejectQueuedPrompts(threadId, "agent connection closed");
    }
    this.toolCallStarts.clear();
    this.sessions.clear();
    this.workspaceRoots.clear();
    this.terminalManager.killAll();
    const liveConnections = [...this.connections.values()];
    this.connections.clear();
    await Promise.all(
      liveConnections.map(async (live) => {
        this.intentionalConnectionIds.add(live.connectionId);
        try {
          live.connection.close();
        } catch {
          // ignore
        }
        await terminateChildProcess(live.process);
      }),
    );
  }

  private invalidateAgentSessions(agentId: string): void {
    let activeInvalidated = false;
    for (const [threadId, runtime] of this.sessions) {
      if (runtime.agentId === agentId) {
        activeInvalidated ||= this.activeThreadId === threadId;
        this.cancelPendingPermissions(runtime.agentSessionId);
        this.cancelPendingPrompt(threadId, "agent connection closed");
        this.rejectQueuedPrompts(threadId, "agent connection closed");
        this.clearToolCallTiming(runtime.agentSessionId);
        this.terminalManager.releaseSession(runtime.agentSessionId);
        this.subagents.releaseSessionMcp(runtime.agentSessionId);
        this.releaseWorkspaceRoot(runtime.agentSessionId);
        this.sessions.delete(threadId);
        this.emit({ type: "thread-closed", threadId });
      }
    }
    if (activeInvalidated) {
      this.activeThreadId = null;
      void updateLaunchSelection({ projectId: this.activeProjectId, threadId: null });
      this.pushState(null);
    } else {
      this.emitRunningThreads();
    }
  }

  private findThreadBySessionId(sessionId: string): string | null {
    for (const [threadId, runtime] of this.sessions) {
      if (runtime.agentSessionId === sessionId) return threadId;
    }
    return null;
  }

  private connectionForAgent(agentId: string): LiveConnection | null {
    if (this.connection?.agentId === agentId) return this.connection;
    return this.connections.get(agentId) ?? null;
  }

  private cancelPendingPrompt(threadId: string, reason: string): void {
    const cancel = this.pendingPromptCancels.get(threadId);
    if (!cancel) return;
    cancel();
    this.pendingPromptCancels.delete(threadId);
    console.warn(`[agent] prompt for ${threadId} cancelled: ${reason}`);
  }

  private async handleSessionUpdate(sessionId: string, update: SessionUpdate): Promise<void> {
    // Headless subagent sessions accumulate into their run's slice; their
    // streaming must not leak into thread timelines or the renderer.
    if (this.subagents.handleSessionUpdate(sessionId, update)) return;

    const threadId = this.findThreadBySessionId(sessionId);
    let runtime: ThreadSessionRuntime | null = null;
    if (threadId && this.sessions.has(threadId)) {
      runtime = this.sessions.get(threadId)!;
    }

    if (!runtime) {
      // Still forward raw update
      this.emit({
        type: "session-update",
        sessionId,
        threadId: null,
        update,
      });
      return;
    }

    this.trackToolCallTiming(sessionId, runtime, update);

    runtime.slice = applySessionUpdate(runtime.slice, update);
    // `applySessionUpdate` sets isStreaming=true for every agent chunk/tool_call,
    // but only `applyTurnStop` (on the prompt request resolving) clears it. An
    // update that lands outside an active turn — a late flush after the response,
    // or an agent streaming background work out-of-band — would otherwise turn the
    // loader back on with nothing left to clear it. Clamp such updates to
    // non-streaming so the composer's stop button and the tab's working icon
    // reflect only genuine in-flight turns.
    if (
      this.sessions.has(runtime.threadId) &&
      !runtime.promptInFlight &&
      runtime.slice.isStreaming
    ) {
      runtime.slice = { ...runtime.slice, isStreaming: false };
    }
    // A background thread's streaming can flip via updates without a pushState; keep tabs in sync.
    this.emitRunningThreads();

    // A session/load replay is not a live turn. Publishing each replay chunk
    // here exposes a partially hydrated target session to the renderer before
    // its thread identity has become authoritative. The activation publishes
    // the complete runtime once loading finishes.
    if (this.loadingSessionThreads.has(runtime.threadId)) return;

    if (runtime.slice.titleChanged && runtime.slice.title && this.sessions.has(runtime.threadId)) {
      updateThreadTitle(runtime.threadId, runtime.slice.title);
      this.emit({
        type: "title",
        threadId: runtime.threadId,
        title: runtime.slice.title,
      });
      this.setWindowTitle(runtime.slice.title);
    }

    const event: AcpBridgeEvent = {
      type: "session-update",
      sessionId,
      threadId: runtime.threadId,
      update,
    };

    this.emit(event);
    this.emit({
      type: "thread-tool-calls",
      threadId: runtime.threadId,
      toolCalls: runtime.slice.toolCalls,
    });
    // The renderer applies the same pure reducer to session-update. Sending a
    // full session-state snapshot for every chunk needlessly rebuilds the panel
    // projection and forces all snapshot subscribers to render again. The next
    // turn stop and activation still publish an authoritative snapshot.
    if (!runtime.promptInFlight && runtime.threadId === this.activeThreadId) {
      this.pushState(runtime.threadId);
    }
  }

  private permissionKey(sessionId: string, requestId: string | number): string {
    return `${sessionId}:${String(requestId)}`;
  }

  private handlePermissionRequest(
    params: acp.RequestPermissionRequest,
    requestId: string | number | null,
  ): Promise<acp.RequestPermissionResponse> {
    // Subagent sessions have no UI surface to answer on; resolve per config.
    const auto = this.subagents.autoPermissionResponse(params);
    if (auto) return Promise.resolve(auto);

    const sessionId = params.sessionId;
    const stableRequestId = requestId ?? ++this.permissionRequestSequence;
    const key = this.permissionKey(sessionId, stableRequestId);
    const request: AcpPermissionRequest = {
      sessionId,
      requestId: stableRequestId,
      threadId: this.findThreadBySessionId(sessionId),
      toolCall: params.toolCall as AcpPermissionRequest["toolCall"],
      options: (params.options ?? []).map((opt) => ({
        optionId: opt.optionId,
        name: opt.name,
        kind: opt.kind,
      })),
    };

    return new Promise((resolve) => {
      // Default allow_once after timeout if UI never responds.
      const timer = setTimeout(() => {
        const pending = this.pendingPermissions.get(key);
        if (!pending) return;
        const allow = request.options.find((o) => o.kind === "allow_once") ?? request.options[0];
        this.pendingPermissions.delete(key);
        if (allow) {
          resolve({
            outcome: { outcome: "selected", optionId: allow.optionId },
          });
        } else {
          resolve({ outcome: { outcome: "cancelled" } });
        }
        this.emit({ type: "permission-resolved", sessionId, requestId: stableRequestId });
      }, 120_000);
      const displaced = this.pendingPermissions.get(key);
      if (displaced) {
        clearTimeout(displaced.timer);
        displaced.resolve({ outcome: { outcome: "cancelled" } });
        this.emit({ type: "permission-resolved", sessionId, requestId: stableRequestId });
      }
      this.pendingPermissions.set(key, { resolve, request, timer });
      this.emit({ type: "permission-request", request });
    });
  }

  async respondToPermission(response: {
    sessionId: string;
    requestId?: string | number;
    optionId?: string;
    cancelled?: boolean;
  }): Promise<void> {
    const key =
      response.requestId == null
        ? [...this.pendingPermissions.entries()].find(
            ([, pending]) => pending.request.sessionId === response.sessionId,
          )?.[0]
        : this.permissionKey(response.sessionId, response.requestId);
    const pending = key ? this.pendingPermissions.get(key) : undefined;
    if (!pending) return;
    this.pendingPermissions.delete(key!);
    clearTimeout(pending.timer);
    if (response.cancelled || !response.optionId) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    } else {
      pending.resolve({
        outcome: { outcome: "selected", optionId: response.optionId },
      });
    }
    this.emit({
      type: "permission-resolved",
      sessionId: response.sessionId,
      requestId: pending.request.requestId,
    });
  }

  private cancelPendingPermissions(sessionId: string): void {
    for (const [key, pending] of this.pendingPermissions) {
      if (pending.request.sessionId !== sessionId) continue;
      this.pendingPermissions.delete(key);
      clearTimeout(pending.timer);
      pending.resolve({ outcome: { outcome: "cancelled" } });
      this.emit({
        type: "permission-resolved",
        sessionId,
        requestId: pending.request.requestId,
      });
    }
  }

  private cancelAllPendingPermissions(): void {
    for (const sessionId of new Set(
      [...this.pendingPermissions.values()].map((p) => p.request.sessionId),
    )) {
      this.cancelPendingPermissions(sessionId);
    }
  }

  private requestPrompt(
    live: LiveConnection,
    runtime: ThreadSessionRuntime,
    blocks: ContentBlock[],
    streamingBehavior?: "followUp" | "steer",
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let cancel!: () => void;
      let timeout!: ReturnType<typeof setTimeout>;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (this.pendingPromptCancels.get(runtime.threadId) === cancel) {
          this.pendingPromptCancels.delete(runtime.threadId);
        }
        clearTimeout(timeout);
        callback();
      };
      cancel = () => finish(() => reject(new Error("agent prompt cancelled")));
      timeout = setTimeout(() => {
        void live.agent
          .notify(acp.methods.agent.session.cancel, { sessionId: runtime.agentSessionId })
          .catch(() => {});
        finish(() =>
          reject(new Error(`session/prompt timed out after ${ACP_PROMPT_TIMEOUT_MS}ms`)),
        );
      }, ACP_PROMPT_TIMEOUT_MS);
      this.pendingPromptCancels.set(runtime.threadId, cancel);

      live.agent
        .request(acp.methods.agent.session.prompt, {
          sessionId: runtime.agentSessionId,
          prompt: blocks,
          ...(streamingBehavior ? { streamingBehavior } : {}),
        })
        .then(
          (result) => finish(() => resolve(result)),
          (error) => finish(() => reject(error)),
        );
    });
  }

  private rejectQueuedPrompts(threadId: string, reason: string): void {
    const queued = this.queuedPrompts.get(threadId);
    if (!queued) return;
    this.queuedPrompts.delete(threadId);
    for (const prompt of queued) prompt.reject(new Error(reason));
  }

  private drainPromptQueue(runtime: ThreadSessionRuntime, live: LiveConnection): void {
    if (runtime.promptInFlight) return;
    const queue = this.queuedPrompts.get(runtime.threadId);
    const prompt = queue?.shift();
    if (!prompt) {
      this.queuedPrompts.delete(runtime.threadId);
      return;
    }

    runtime.promptInFlight = true;
    const turnStartedAt = Date.now();
    const toolCallsBefore = Object.keys(runtime.slice.toolCalls).length;
    const agentProps = this.agentProps(runtime.agentId);
    this.captureAnalytics?.("prompt_submitted", {
      ...agentProps,
      project_id: runtime.projectId,
      thread_id: runtime.threadId,
      has_images: prompt.blocks.some((block) => block.type === "image"),
      has_resources: prompt.blocks.some(
        (block) => block.type === "resource" || block.type === "resource_link",
      ),
    });

    void this.requestPrompt(live, runtime, prompt.blocks, prompt.streamingBehavior)
      .then((result) => {
        runtime.slice = applyTurnStop(runtime.slice);
        this.captureAnalytics?.("turn_completed", {
          ...agentProps,
          thread_id: runtime.threadId,
          stop_reason: result.stopReason,
          turn_duration_ms: Date.now() - turnStartedAt,
          tool_call_count: Math.max(
            0,
            Object.keys(runtime.slice.toolCalls).length - toolCallsBefore,
          ),
        });
        this.reportTokens(runtime, agentProps, runtime.threadId);
        this.emit({
          type: "stop",
          sessionId: runtime.agentSessionId,
          threadId: runtime.threadId,
          stopReason: result.stopReason,
        });
        prompt.resolve(result);
      })
      .catch((error) => {
        runtime.slice = applyTurnStop(runtime.slice);
        this.captureAnalytics?.("turn_failed", {
          ...agentProps,
          thread_id: runtime.threadId,
          turn_duration_ms: Date.now() - turnStartedAt,
          error_type: error instanceof Error ? error.name : undefined,
        });
        // If ACP timed out or was cancelled, its underlying request may still
        // be alive. Do not start another prompt against the same session.
        if (error instanceof Error && /timed out|cancelled/i.test(error.message)) {
          this.rejectQueuedPrompts(runtime.threadId, error.message);
        }
        prompt.reject(error);
      })
      .finally(() => {
        runtime.promptInFlight = false;
        this.clearToolCallTiming(runtime.agentSessionId);
        this.pushState(runtime.threadId);
        if (this.sessions.get(runtime.threadId) === runtime) {
          this.drainPromptQueue(runtime, live);
        }
      });
  }

  private async handleReadTextFile(
    params: acp.ReadTextFileRequest,
  ): Promise<acp.ReadTextFileResponse> {
    this.assertWithinWorkspace(params.sessionId, params.path);
    const content = await readFile(params.path, readFileOptions());
    if (params.line != null || params.limit != null) {
      const lines = content.split("\n");
      const start = Math.max(0, (params.line ?? 1) - 1);
      const end = params.limit != null ? start + params.limit : lines.length;
      return { content: lines.slice(start, end).join("\n") };
    }
    return { content };
  }

  private async handleWriteTextFile(
    params: acp.WriteTextFileRequest,
  ): Promise<acp.WriteTextFileResponse> {
    this.assertWithinWorkspace(params.sessionId, params.path);
    await mkdir(dirname(params.path), { recursive: true });
    await writeFile(params.path, params.content, writeFileOptions());
    return {};
  }

  private mcpServersForConnection(live: LiveConnection): Array<Record<string, unknown>> {
    const caps = live.agentCapabilities.mcpCapabilities;
    return toAcpMcpServers(listMcpServers(), caps);
  }

  /**
   * User-configured MCP servers plus the client-hosted subagent tool endpoint
   * (a fresh token per session so tool calls are attributable). The returned
   * bind() must be called with the established ACP session id.
   */
  private async sessionMcpServers(
    live: LiveConnection,
    cwd: string,
  ): Promise<{
    servers: Array<Record<string, unknown>>;
    bind: (sessionId: string) => void;
    release: () => void;
  }> {
    const base = this.mcpServersForConnection(live);
    const attached = await this.subagents.attachMcpServers(base, live.agentCapabilities, {
      cwd,
      depth: 0,
    });
    return {
      servers: attached.servers,
      bind: (sessionId) => {
        if (attached.token) this.subagents.bindSession(attached.token, sessionId);
      },
      release: () => {
        if (attached.token) this.subagents.releaseTokenForSession(attached.token);
      },
    };
  }

  /**
   * Normalize and sanitize session config options. Some third-party ACP adapters
   * (e.g. antigravity-acp) leak raw tab-separated output from CLI discovery (`id\tDisplay Name`).
   * Clean them so modelId matches what the CLI expects and UI renders clean names.
   */
  private sanitizeConfigOptions(
    rawOptions: SessionConfigOption[] | null | undefined,
  ): SessionConfigOption[] {
    return (rawOptions ?? []).map((opt) => {
      if (opt.id === "model" || opt.category === "model") {
        let currentValue = opt.currentValue;
        if (typeof currentValue === "string" && currentValue.includes("\t")) {
          const parts = currentValue.split("\t");
          currentValue = parts[1]?.trim() || parts[0]?.trim() || currentValue;
        }
        let choices = opt.options;
        if (Array.isArray(choices)) {
          choices = choices.map((item) => {
            if (item && typeof item === "object") {
              const rec = item as Record<string, unknown>;
              const rawVal = rec.value;
              const rawName = rec.name;
              if (typeof rawVal === "string" && rawVal.includes("\t")) {
                const parts = rawVal.split("\t");
                const cleanName = parts[1]?.trim() || parts[0]?.trim() || rawVal;
                return {
                  ...rec,
                  value: cleanName,
                  name:
                    typeof rawName === "string" && rawName.includes("\t")
                      ? cleanName
                      : (rawName ?? cleanName),
                };
              }
            }
            return item;
          });
        }
        return {
          ...opt,
          currentValue,
          options: choices,
        } as SessionConfigOption;
      }
      return opt;
    });
  }

  /**
   * Some agents (e.g. Grok) advertise their model catalog in the initialize
   * result's `_meta.modelState` rather than as a session config option. When the
   * agent returned no native "model" option, synthesize one from that catalog so
   * it flows through the standard model picker UI unchanged.
   */
  private withModelOption(
    live: LiveConnection,
    options: SessionConfigOption[],
  ): SessionConfigOption[] {
    const sanitized = this.sanitizeConfigOptions(options);
    const ms = live.modelState;
    const models = ms?.availableModels ?? [];
    if (models.length === 0) return sanitized;
    if (sanitized.some((o) => o.category === "model" || o.id === "model")) return sanitized;
    const modelOption = {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: ms?.currentModelId ?? models[0]?.modelId ?? null,
      options: models.map((m) => ({ value: m.modelId, name: m.name })),
    } as unknown as SessionConfigOption;
    return [modelOption, ...sanitized];
  }

  /**
   * The cwd a thread's session should run in: its bound worktree when that path
   * still resolves to a live worktree, else the project root. Validating on bind
   * keeps git the source of truth — an externally-removed worktree degrades to
   * the project root instead of failing `session/new` on a stale path.
   */
  private resolveThreadCwd(worktreePath: string | null | undefined, projectPath: string): string {
    if (worktreePath && isLiveWorktree(worktreePath, projectPath)) return worktreePath;
    return projectPath;
  }

  /** Seed the path guard for an ACP session with its (realpath'd) cwd root. */
  private registerWorkspaceRoot(agentSessionId: string, cwd: string): void {
    let root = resolve(cwd);
    try {
      root = realpathSync(root);
    } catch {
      // cwd may not exist yet in exotic cases; fall back to the resolved path.
    }
    this.workspaceRoots.set(agentSessionId, new Set([root]));
  }

  private releaseWorkspaceRoot(agentSessionId: string | null | undefined): void {
    if (agentSessionId) this.workspaceRoots.delete(agentSessionId);
  }

  /**
   * Resolve a target path through its deepest *existing* ancestor's realpath so
   * a not-yet-created file still resolves through symlink-free parents (defeats
   * `../worktree-b` and a symlinked parent), then re-append the missing tail.
   */
  private resolveExistingPrefix(targetPath: string): string {
    let current = resolve(targetPath);
    const tail: string[] = [];
    while (!existsSync(current)) {
      const parent = dirname(current);
      if (parent === current) break;
      tail.unshift(basename(current));
      current = parent;
    }
    let real = current;
    try {
      real = realpathSync(current);
    } catch {
      // keep the resolved (non-real) path
    }
    return tail.length ? join(real, ...tail) : real;
  }

  /**
   * Reject an agent file/terminal target that escapes its session's workspace
   * root(s). No-op for unguarded (internal) sessions. Uses `path.relative` — not
   * `startsWith`, which would let `/proj-evil` escape root `/proj`.
   */
  private assertWithinWorkspace(agentSessionId: string | undefined, targetPath: string): void {
    // Explicit allowlist of unguarded internal session IDs that bypass validation
    const unguardedInternalSessions = new Set<string>([]);

    if (!agentSessionId) return;
    if (unguardedInternalSessions.has(agentSessionId)) return;

    const roots = this.workspaceRoots.get(agentSessionId);
    if (!roots || roots.size === 0) {
      throw new Error("Path outside workspace");
    }
    const resolved = this.resolveExistingPrefix(targetPath);
    for (const root of roots) {
      const rel = relative(root, resolved);
      if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
    }
    throw new Error("Path outside workspace");
  }

  private async sessionNew(
    live: LiveConnection,
    cwd: string,
  ): Promise<{ sessionId: string; configOptions: SessionConfigOption[] }> {
    const attached = await this.sessionMcpServers(live, cwd);
    let result: { sessionId: string; configOptions?: SessionConfigOption[] | null };
    try {
      result = await requestWithTimeout(
        live.agent.request(acp.methods.agent.session.new, {
          cwd,
          mcpServers: attached.servers as never,
        }),
        ACP_SWITCH_PHASE_TIMEOUT_MS,
        "session/new",
      );
    } catch (err) {
      // A genuine "not signed in" surfaces here as an ACP `auth_required`
      // error — the only reliable signal — so record it for `authMessage()`.
      if (isAuthRequiredError(err)) {
        const descriptor = getAgentDescriptor(live.agentId);
        live.authRequiredMessage =
          descriptor?.authHint ??
          `${descriptor?.displayName ?? live.agentId} requires authentication. Please sign in from your terminal first.`;
      }
      attached.release();
      throw err;
    }
    live.authRequiredMessage = null;
    attached.bind(result.sessionId);

    const configOptions = this.withModelOption(
      live,
      (result.configOptions as SessionConfigOption[] | null | undefined) ?? [],
    );

    // If an agent (e.g. antigravity-acp) provided a raw/tab-separated default model,
    // explicitly sync the clean model back to the adapter session so it doesn't
    // pass the raw tab-separated string to its CLI subprocess.
    const modelOpt = configOptions.find((o) => o.category === "model" || o.id === "model");
    if (modelOpt && typeof modelOpt.currentValue === "string") {
      const rawOpt = (
        (result.configOptions as SessionConfigOption[] | null | undefined) ?? []
      ).find((o) => o.category === "model" || o.id === "model");
      if (
        live.agentId.includes("antigravity") ||
        (typeof rawOpt?.currentValue === "string" && rawOpt.currentValue.includes("\t"))
      ) {
        try {
          await requestWithTimeout(
            live.agent.request(acp.methods.agent.session.setConfigOption, {
              sessionId: result.sessionId,
              configId: modelOpt.id,
              value: modelOpt.currentValue as never,
            }),
            ACP_SWITCH_PHASE_TIMEOUT_MS,
            "session/set_config_option",
          );
        } catch {
          // best-effort sync
        }
      }
    }

    // For antigravity-acp, also ensure mode is initialized to bypassPermissions
    // so tool executions never deadlock waiting on headless stdin.
    const modeOpt = configOptions.find((o) => o.category === "mode" || o.id === "mode");
    if (modeOpt && live.agentId.includes("antigravity")) {
      try {
        await requestWithTimeout(
          live.agent.request(acp.methods.agent.session.setConfigOption, {
            sessionId: result.sessionId,
            configId: modeOpt.id,
            value: "bypassPermissions" as never,
          }),
          ACP_SWITCH_PHASE_TIMEOUT_MS,
          "session/set_config_option",
        );
      } catch {
        // best-effort sync
      }
    }

    return {
      sessionId: result.sessionId,
      configOptions,
    };
  }

  private async sessionLoad(
    live: LiveConnection,
    cwd: string,
    sessionId: string,
  ): Promise<{ sessionId: string; configOptions: SessionConfigOption[] }> {
    const attached = await this.sessionMcpServers(live, cwd);
    let result: { sessionId?: string; configOptions?: SessionConfigOption[] | null };
    try {
      result = await requestWithTimeout(
        live.agent.request(acp.methods.agent.session.load, {
          cwd,
          sessionId,
          mcpServers: attached.servers as never,
        }),
        ACP_SWITCH_PHASE_TIMEOUT_MS,
        "session/load",
      );
    } catch (err) {
      attached.release();
      throw err;
    }
    attached.bind(result?.sessionId ?? sessionId);
    return {
      sessionId: result?.sessionId ?? sessionId,
      configOptions: this.withModelOption(live, result?.configOptions ?? []),
    };
  }

  private async sessionResume(
    live: LiveConnection,
    prevSessionId: string,
    cwd: string,
  ): Promise<{ sessionId: string; configOptions: SessionConfigOption[] }> {
    const attached = await this.sessionMcpServers(live, cwd);
    let result: { sessionId?: string; configOptions?: SessionConfigOption[] | null };
    try {
      result = await requestWithTimeout(
        live.agent.request(acp.methods.agent.session.resume, {
          prevSessionId,
          cwd,
          mcpServers: attached.servers as never,
        } as never),
        ACP_SWITCH_PHASE_TIMEOUT_MS,
        "session/resume",
      );
    } catch (err) {
      attached.release();
      throw err;
    }
    attached.bind(result?.sessionId ?? prevSessionId);
    return {
      sessionId: result?.sessionId ?? prevSessionId,
      configOptions: this.withModelOption(live, result?.configOptions ?? []),
    };
  }

  private enqueueThreadActivation<T>(task: () => Promise<T>): Promise<T> {
    const result = this.threadActivationQueue.then(task, task);
    this.threadActivationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async activateProject(projectId: string, preferredThreadId?: string | null): Promise<void> {
    return this.enqueueThreadActivation(() =>
      this.activateProjectInternal(projectId, preferredThreadId),
    );
  }

  private async activateProjectInternal(
    projectId: string,
    preferredThreadId?: string | null,
  ): Promise<void> {
    const project = getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    this.activeProjectId = projectId;
    setActiveProjectId(projectId);
    this.broadcastActiveProject?.(projectId);

    const threads = listThreads().filter((t) => t.project_id === projectId);
    let thread: Thread | null = preferredThreadId ? getThread(preferredThreadId) : null;
    if (!thread) {
      // No explicit thread: enter the project's persisted workspace context —
      // its most-recently-used open tab there, else its most recent thread —
      // before falling back to any project thread.
      const state = await readLaunchState();
      const workspacePath = normalizeWorkspacePath(
        state.selectedWorktreePathByProject[projectId],
        project.path,
      );
      thread =
        pickWorkspaceThread({
          projectId,
          workspacePath,
          openThreadIds: state.openThreadIds,
          threadSwitchHistory: state.threadSwitchHistory,
          threads,
        }) ??
        threads[0] ??
        null;
    }

    if (!thread) {
      this.activeThreadId = null;
      await updateLaunchSelection({ projectId, threadId: null });
      this.pushState(null);
      return;
    }

    // switchThread reconciles the persisted workspace to the activated
    // thread's cwd, so header/tabs/terminals agree after restart and after
    // project switches.
    await this.switchThreadInternal(thread.id, "restore");

    await updateLaunchSelection({ projectId, threadId: thread.id });
  }

  async switchThread(threadId: string): Promise<OpenTabsState> {
    return this.enqueueThreadActivation(() => this.switchThreadInternal(threadId, "tab"));
  }

  private async switchThreadInternal(
    threadId: string,
    source: MonitorSwitchRecord["source"] = "tab",
  ): Promise<OpenTabsState> {
    const startedAt = Date.now();
    const previousThreadId = this.activeThreadId;
    let phase: MonitorSwitchPhase = this.sessions.has(threadId) ? "cache_hit" : "session_load";
    let openTabCount = 0;
    const record = (success: boolean, error?: string) => {
      this.monitorObserver?.onSwitchRecord?.({
        timestamp: Date.now(),
        threadId,
        agentId: this.connection?.agentId ?? null,
        projectId: this.activeProjectId,
        source,
        phase,
        durationMs: Date.now() - startedAt,
        success,
        error,
        openTabCount,
        previousThreadId,
      });
    };
    try {
      const state = await this.switchThreadCore(threadId, (nextPhase) => {
        phase = nextPhase;
      });
      // The returned tabs state reflects the open-tab set after this
      // activation; capture it so records are comparable to tab events.
      openTabCount = state.openThreadIds.length;
      record(true);
      return state;
    } catch (err) {
      try {
        openTabCount = (await readOpenTabsState()).openThreadIds.length;
      } catch {
        // best effort
      }
      record(false, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private async switchThreadCore(
    threadId: string,
    onPhase: (phase: MonitorSwitchPhase) => void,
  ): Promise<OpenTabsState> {
    const thread = getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    const project = getProject(thread.project_id);
    if (!project) throw new Error(`Project not found: ${thread.project_id}`);

    // Switch agent if needed
    if (thread.agent_id && thread.agent_id !== this.connection?.agentId) {
      try {
        await this.switchAgent(thread.agent_id);
      } catch {
        // Fall back to preferred / default if registered agent missing
        await this.ensureConnection(this.preferredAgentId);
      }
    } else {
      await this.ensureConnection(thread.agent_id || this.preferredAgentId);
    }

    const live = this.connection!;
    const projectChanged = this.activeProjectId !== project.id;
    this.activeProjectId = project.id;
    this.activeThreadId = threadId;
    this.publishActiveAgentContext(live.agentId);
    setActiveProjectId(project.id);
    if (projectChanged) this.broadcastActiveProject?.(project.id);

    // Bind the session to its worktree (validated), else the project root.
    const cwd = this.resolveThreadCwd(thread.worktree_path, project.path);
    const generation = ++this.activationGeneration;
    this.threadActivationGenerations.set(threadId, generation);

    // Close previous session optionally — skip for rapid switches; load new
    if (!this.sessions.has(threadId)) {
      onPhase("session_load");
      // Register the runtime BEFORE awaiting session/load: agents stream the
      // conversation replay as session/update notifications while the load
      // request is still in flight, and handleSessionUpdate can only route
      // them into this slice if the sessionId is already known here. Without
      // this, a reloaded thread renders with an empty timeline.
      const runtime = {
        threadId,
        agentSessionId: thread.agent_session_id,
        agentId: live.agentId,
        projectId: project.id,
        cwd,
        slice: createEmptySessionSlice(),
        editorText: "",
        promptInFlight: false,
      };
      this.sessions.set(threadId, runtime);
      this.loadingSessionThreads.add(threadId);

      try {
        let sessionId = thread.agent_session_id;
        let configOptions: SessionConfigOption[] = [];
        try {
          const loaded = await this.sessionLoad(live, cwd, sessionId);
          if (this.threadActivationGenerations.get(threadId) !== generation) {
            throw new Error(`Stale activation for thread ${threadId}`);
          }
          sessionId = loaded.sessionId;
          configOptions = loaded.configOptions;
        } catch (err) {
          // A phase timeout only settles the local request. The ACP request may
          // still complete later, so never cascade into resume/new and create a
          // second session while the timed-out load is alive.
          if (err instanceof Error && /timed out/i.test(err.message)) throw err;
          // Agent restarted — try resume. A failed load may have streamed a
          // partial replay before erroring; drop it so the fallback path
          // doesn't append onto half a timeline.
          runtime.slice = createEmptySessionSlice();
          try {
            const resumed = await this.sessionResume(live, thread.agent_session_id, cwd);
            onPhase("session_resume");
            sessionId = resumed.sessionId;
            configOptions = resumed.configOptions;
            updateThreadAgentSessionId(threadId, sessionId);
          } catch {
            const created = await this.sessionNew(live, cwd);
            onPhase("session_new");
            sessionId = created.sessionId;
            configOptions = created.configOptions;
            updateThreadAgentSessionId(threadId, sessionId);
          }
        }

        // Merge instead of replacing the slice: the replay already populated
        // entries/toolCalls, only the session identity and config are new.
        runtime.agentSessionId = sessionId;
        this.registerWorkspaceRoot(sessionId, cwd);
        if (configOptions.length > 0 || runtime.slice.configOptions.length === 0) {
          runtime.slice = { ...runtime.slice, configOptions };
        }
      } catch (err) {
        // No session could be established — remove the placeholder so a
        // retry doesn't silently reuse a dead runtime.
        this.sessions.delete(threadId);
        this.threadActivationGenerations.delete(threadId);
        throw err;
      } finally {
        this.loadingSessionThreads.delete(threadId);
      }
    }

    touchThread(threadId);
    // Every thread activation reconciles the persisted workspace to the
    // session's actual cwd — the main process is the single writer for the
    // canonical selection, and the renderer only mirrors it. This keeps
    // header, tab scoping, and terminals coherent for tab clicks, close
    // fallbacks, and orchestration switches alike.
    await updateWorkspaceSelection(project.id, cwd);
    await updateLaunchSelection({ projectId: project.id, threadId });
    // Return the state produced by the same queued mutation. Callers that need
    // to broadcast the tab state can use this result without performing a
    // second read-modify-write for the same switch.
    const openTabsState = await recordThreadSwitch(threadId);
    this.pushState(threadId);
    return openTabsState;
  }

  async createThread(
    projectId: string,
    title: string | null,
    afterThreadId?: string | null,
    agentId?: string | null,
    worktreePath?: string | null,
    initialModelId?: string | null,
  ): Promise<Thread> {
    return this.enqueueThreadActivation(() =>
      this.createThreadInternal(
        projectId,
        title,
        afterThreadId,
        agentId,
        worktreePath,
        initialModelId,
      ),
    );
  }

  private async createThreadInternal(
    projectId: string,
    title: string | null,
    afterThreadId?: string | null,
    agentId?: string | null,
    worktreePath?: string | null,
    initialModelId?: string | null,
  ): Promise<Thread> {
    const project = getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    // Bind to the worktree when valid; store only what we actually bound to so a
    // stale/invalid path is never persisted as this thread's worktree.
    const cwd = this.resolveThreadCwd(worktreePath, project.path);
    const boundWorktree = cwd === project.path ? null : cwd;

    const targetAgentId = agentId ?? this.preferredAgentId;
    const live = await this.ensureConnection(targetAgentId);
    const created = await this.sessionNew(live, cwd);
    this.registerWorkspaceRoot(created.sessionId, cwd);

    let sortOrder: number | undefined;
    if (afterThreadId) {
      const afterOrder = getThreadSortOrder(afterThreadId);
      if (afterOrder != null) sortOrder = afterOrder + 1;
    }

    const thread = createThreadRow(
      projectId,
      title,
      live.agentId,
      created.sessionId,
      sortOrder,
      boundWorktree,
    );

    this.sessions.set(thread.id, {
      threadId: thread.id,
      agentSessionId: created.sessionId,
      agentId: live.agentId,
      projectId,
      cwd,
      slice: createEmptySessionSlice({ configOptions: created.configOptions }),
      editorText: "",
      promptInFlight: false,
    });

    const projectChanged = this.activeProjectId !== projectId;
    this.activeProjectId = projectId;
    this.activeThreadId = thread.id;
    this.publishActiveAgentContext(live.agentId);
    setActiveProjectId(projectId);
    // Creating a thread for another project (tab-bar dropdown) is a project
    // switch: without this broadcast the renderer's project store — and with
    // it the header's project name, workspace, and branch — keeps showing
    // the previous project while the agent panel already follows the new one.
    if (projectChanged) this.broadcastActiveProject?.(projectId);
    touchThread(thread.id);
    await updateWorkspaceSelection(projectId, cwd);
    await updateLaunchSelection({ projectId, threadId: thread.id });

    this.captureAnalytics?.("thread_created", {
      project_id: projectId,
      thread_id: thread.id,
      agent_id: live.agentId,
      agent_name: getAgentDescriptor(live.agentId)?.name,
      is_main: boundWorktree === null,
    } as AnalyticsProperties);

    this.pushState(thread.id);

    // Seed model after the session exists so the first prompt lands on the
    // user's chosen model. Best-effort: a failed seed still leaves a usable thread.
    if (initialModelId) {
      try {
        const modelOpt = created.configOptions.find(
          (option) => option.id === "model" || option.category === "model",
        );
        await this.setConfigOption(modelOpt?.id ?? "model", initialModelId);
      } catch (err) {
        console.warn("[createThread] initial model seed failed:", err);
      }
    }

    return thread;
  }

  async deleteThread(threadId: string): Promise<void> {
    return this.enqueueThreadActivation(() => this.deleteThreadInternal(threadId));
  }

  private async deleteThreadInternal(threadId: string): Promise<void> {
    const thread = getThread(threadId);
    if (!thread) return;

    const runtime = this.sessions.get(threadId);
    const sessionId = runtime?.agentSessionId ?? thread.agent_session_id;
    const owner = this.connectionForAgent(runtime?.agentId ?? thread.agent_id);
    this.cancelPendingPermissions(sessionId);
    this.cancelPendingPrompt(threadId, "thread deleted");
    this.rejectQueuedPrompts(threadId, "thread deleted");
    this.clearToolCallTiming(sessionId);
    this.terminalManager.releaseSession(sessionId);
    if (sessionId) this.subagents.releaseSessionMcp(sessionId);
    if (owner && sessionId) {
      try {
        await requestWithTimeout(
          owner.agent.request(acp.methods.agent.session.delete, { sessionId }),
          ACP_SWITCH_PHASE_TIMEOUT_MS,
          "session/delete",
        );
      } catch {
        // best effort
      }
    }
    this.releaseWorkspaceRoot(sessionId);
    this.sessions.delete(threadId);
    this.emit({ type: "thread-closed", threadId });
    removeThreadRow(threadId);

    if (this.activeThreadId === threadId) {
      this.activeThreadId = null;
      const remaining = listThreads().filter((t) => t.project_id === thread.project_id);
      // Stay in the deleted thread's workspace when it still has threads —
      // falling back to the project-wide MRU would yank the whole shell
      // (header, tabs, terminals) into another workspace.
      const state = await readLaunchState();
      const replacement =
        pickWorkspaceThread({
          projectId: thread.project_id,
          workspacePath: thread.worktree_path ?? null,
          openThreadIds: state.openThreadIds,
          threadSwitchHistory: state.threadSwitchHistory,
          threads: remaining,
        }) ??
        remaining[0] ??
        null;
      if (replacement) {
        await this.switchThreadInternal(replacement.id, "delete");
      } else {
        await updateLaunchSelection({ projectId: thread.project_id, threadId: null });
        this.pushState(null);
      }
    }
  }

  async closeThreadSession(threadId: string): Promise<void> {
    return this.enqueueThreadActivation(() => this.closeThreadSessionInternal(threadId));
  }

  private async closeThreadSessionInternal(threadId: string): Promise<void> {
    const runtime = this.sessions.get(threadId);
    if (!runtime) return;
    const owner = this.connectionForAgent(runtime.agentId);
    this.cancelPendingPermissions(runtime.agentSessionId);
    this.cancelPendingPrompt(threadId, "thread session closed");
    this.rejectQueuedPrompts(threadId, "thread session closed");
    this.clearToolCallTiming(runtime.agentSessionId);
    this.terminalManager.releaseSession(runtime.agentSessionId);
    this.subagents.releaseSessionMcp(runtime.agentSessionId);
    if (owner) {
      try {
        await requestWithTimeout(
          owner.agent.request(acp.methods.agent.session.close, {
            sessionId: runtime.agentSessionId,
          }),
          ACP_SWITCH_PHASE_TIMEOUT_MS,
          "session/close",
        );
      } catch {
        // best effort
      }
    }
    this.releaseWorkspaceRoot(runtime.agentSessionId);
    this.sessions.delete(threadId);
    this.emit({ type: "thread-closed", threadId });
  }

  async renameThread(threadId: string, title: string): Promise<Thread> {
    updateThreadTitle(threadId, title);
    const thread = getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    const runtime = this.sessions.get(threadId);
    if (runtime) {
      runtime.slice = { ...runtime.slice, title, titleChanged: false };
    }
    this.pushState(threadId);
    return thread;
  }

  async sendPrompt(input: AcpPromptInput): Promise<void> {
    return this.sendPromptInternal(input, true);
  }

  private async sendPromptInternal(
    input: AcpPromptInput,
    appendUserMessage: boolean,
  ): Promise<void> {
    const threadId = input.threadId ?? this.activeThreadId;
    if (!threadId) throw new Error("No active thread");
    if (!this.sessions.has(threadId)) {
      await this.switchThread(threadId);
    }
    const runtime = this.sessions.get(threadId);
    const live = runtime ? this.connectionForAgent(runtime.agentId) : null;
    if (!runtime || !live) throw new Error("No session for thread");

    if (runtime.promptInFlight && !input.streamingBehavior) {
      throw new Error("A prompt is already in flight; choose follow-up or steer to queue it.");
    }

    const caps = live.agentCapabilities.promptCapabilities;
    const blocks = assemblePromptBlocks({
      message: input.message,
      images: input.images,
      resources: input.resources,
      prompt: input.prompt,
      allowImage: caps?.image !== false,
      allowEmbeddedContext: Boolean(caps?.embeddedContext),
    });

    if (appendUserMessage && input.message) {
      runtime.slice = appendLocalUserMessage(runtime.slice, input.message);
      this.pushState(threadId);
    }

    // New turn: drop prior plan so the popover only reappears when this turn
    // emits a plan update (applyTurnStop also clears; this covers image-only prompts).
    runtime.slice = { ...runtime.slice, isStreaming: true, plan: null };
    this.pushState(threadId);
    touchThread(threadId);

    const queued = new Promise<any>((resolve, reject) => {
      const queue = this.queuedPrompts.get(threadId) ?? [];
      queue.push({
        blocks,
        streamingBehavior: input.streamingBehavior,
        resolve,
        reject,
      });
      this.queuedPrompts.set(threadId, queue);
    });
    this.drainPromptQueue(runtime, live);
    await queued;
  }

  /** Emit `tokens_reported` from the slice's usage snapshot at turn end (never per chunk). */
  private reportTokens(
    runtime: ThreadSessionRuntime,
    agentProps: AnalyticsProperties,
    threadId: string,
  ): void {
    const usage = runtime.slice.usage;
    if (!usage) return;
    this.captureAnalytics?.("tokens_reported", {
      ...agentProps,
      thread_id: threadId,
      tokens_used: usage.used,
      context_size: usage.size,
      cost_amount: usage.cost?.amount,
      cost_currency: usage.cost?.currency,
    });
  }

  async replacePrompt(input: AcpReplacePromptInput): Promise<void> {
    const threadId = input.threadId;
    if (!this.sessions.has(threadId)) {
      await this.switchThread(threadId);
    }
    const runtime = this.sessions.get(threadId);
    const live = runtime ? this.connectionForAgent(runtime.agentId) : null;
    if (!runtime || !live) throw new Error("No session for thread");

    runtime.promptInFlight = true;
    runtime.slice = appendLocalUserMessage(runtime.slice, input.message);
    runtime.slice = { ...runtime.slice, isStreaming: true };
    this.pushState(threadId);

    try {
      // Custom extension method
      await requestWithTimeout(
        live.agent.request("_pipper/replace_prompt", {
          sessionId: runtime.agentSessionId,
          promptId: input.targetUserEntryId,
          text: input.message,
        }),
        ACP_PROMPT_TIMEOUT_MS,
        "_pipper/replace_prompt",
        () => {
          void live.agent
            .notify(acp.methods.agent.session.cancel, { sessionId: runtime.agentSessionId })
            .catch(() => {});
        },
      );
      runtime.promptInFlight = false;
      runtime.slice = applyTurnStop(runtime.slice);
      this.pushState(threadId);
    } catch {
      runtime.promptInFlight = false;
      // Fallback: regular prompt
      await this.sendPromptInternal(
        {
          threadId,
          message: input.message,
          images: input.images,
        },
        false,
      );
    }
  }

  async abort(): Promise<void> {
    const threadId = this.activeThreadId;
    if (!threadId) return;
    const runtime = this.sessions.get(threadId);
    const owner = runtime ? this.connectionForAgent(runtime.agentId) : null;
    if (!runtime || !owner) return;
    this.cancelPendingPrompt(threadId, "user abort");
    this.rejectQueuedPrompts(threadId, "agent prompt cancelled");
    this.clearToolCallTiming(runtime.agentSessionId);
    await owner.agent
      .notify(acp.methods.agent.session.cancel, { sessionId: runtime.agentSessionId })
      .catch(() => {});
    this.cancelPendingPermissions(runtime.agentSessionId);
    // Cascade cancel to subagent runs this session spawned.
    this.subagents.cancelRunsForParent(runtime.agentSessionId);
    // Cascade cancel to ACP agent terminals (session/cancel → terminal/kill).
    // Kill keeps terminalIds valid for final output queries; release is agent-owned.
    this.terminalManager.killRunning();
  }

  async setConfigOption(configId: string, value: string | boolean): Promise<SessionConfigOption[]> {
    const threadId = this.activeThreadId;
    if (!threadId) return [];
    const runtime = this.sessions.get(threadId);
    const owner = runtime ? this.connectionForAgent(runtime.agentId) : null;
    if (!runtime || !owner) return [];
    let targetValue = value;
    if (configId === "model" && typeof targetValue === "string" && targetValue.includes("\t")) {
      const parts = targetValue.split("\t");
      targetValue = parts[1]?.trim() || parts[0]?.trim() || targetValue;
    }

    // Grok exposes its models via initialize `_meta.modelState` and switches them
    // with a custom `session/set_model` method — it doesn't implement the standard
    // `session/set_config_option`. Route the synthesized "model" option there and
    // update the local option optimistically (the agent acks via `_meta.model.Ok`).
    if (configId === "model" && owner.modelState) {
      await requestWithTimeout(
        owner.agent.request(
          "session/set_model" as never,
          {
            sessionId: runtime.agentSessionId,
            modelId: targetValue,
          } as never,
        ),
        ACP_SWITCH_PHASE_TIMEOUT_MS,
        "session/set_model",
      );
      const options = runtime.slice.configOptions.map((o) =>
        o.id === "model" || o.category === "model"
          ? ({ ...o, currentValue: targetValue } as SessionConfigOption)
          : o,
      );
      runtime.slice = { ...runtime.slice, configOptions: options };
      this.pushState(threadId);
      return options;
    }
    const result = await requestWithTimeout(
      owner.agent.request(acp.methods.agent.session.setConfigOption, {
        sessionId: runtime.agentSessionId,
        configId,
        value: targetValue as never,
      }),
      ACP_SWITCH_PHASE_TIMEOUT_MS,
      "session/set_config_option",
    );
    const rawResultOptions =
      (result.configOptions as SessionConfigOption[] | null | undefined) ??
      runtime.slice.configOptions;
    const options = this.sanitizeConfigOptions(rawResultOptions);
    runtime.slice = { ...runtime.slice, configOptions: options };
    this.pushState(threadId);
    return options;
  }

  getCommands() {
    return this.getState().commands;
  }

  getConfigOptions() {
    return this.getState().configOptions;
  }

  getCapabilities(): AgentCapabilities | null {
    return this.connection?.agentCapabilities ?? null;
  }

  /** Promote the given agent onto the analytics base context (name resolved from the registry). */
  private publishActiveAgentContext(agentId: string): void {
    this.setAgentContext?.({ agentId, agentName: getAgentDescriptor(agentId)?.name ?? null });
  }

  /** Build the standard agent-identity properties for an event from an agent id. */
  private agentProps(agentId: string): AnalyticsProperties {
    return { agent_id: agentId, agent_name: getAgentDescriptor(agentId)?.name };
  }

  /**
   * Bracket tool-call start/finish and emit `tool_call_finished` with duration
   * when a call reaches a terminal status. `tool_kind` lets us answer "which
   * agent spends the most time on which tool kind."
   */
  private trackToolCallTiming(
    sessionId: string,
    runtime: ThreadSessionRuntime,
    update: SessionUpdate,
  ): void {
    if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") return;
    const toolCallId = (update as { toolCallId?: string }).toolCallId;
    if (!toolCallId) return;
    const key = `${sessionId}:${toolCallId}`;
    const status = (update as { status?: string }).status;
    const kind = (update as { kind?: string }).kind;

    if (!this.toolCallStarts.has(key)) {
      this.toolCallStarts.set(key, { startedAt: Date.now(), kind });
    } else if (kind) {
      // A later update may be the first to carry the kind; keep it.
      const entry = this.toolCallStarts.get(key)!;
      if (!entry.kind) entry.kind = kind;
    }

    if (status === "completed" || status === "failed") {
      const entry = this.toolCallStarts.get(key);
      if (!entry) return;
      this.toolCallStarts.delete(key);
      this.captureAnalytics?.("tool_call_finished", {
        ...this.agentProps(runtime.agentId),
        thread_id: runtime.threadId,
        tool_kind: entry.kind ?? kind,
        tool_duration_ms: Date.now() - entry.startedAt,
        success: status === "completed",
      });
    }
  }

  private clearToolCallTiming(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const key of this.toolCallStarts.keys()) {
      if (key.startsWith(prefix)) this.toolCallStarts.delete(key);
    }
  }

  getStats() {
    const usage = this.getState().usage;
    if (!usage) return null;
    return {
      used: usage.used,
      size: usage.size,
      cost: usage.cost,
    };
  }

  async setEditorText(text: string): Promise<void> {
    this.currentEditorText = text;
    const active = this.activeThreadId ? this.sessions.get(this.activeThreadId) : null;
    if (active) active.editorText = text;
    this.emit({ type: "editor-text", text });
  }

  async pasteToEditor(text: string): Promise<void> {
    await this.setEditorText(this.currentEditorText + text);
  }

  getEditorText(): string {
    return this.currentEditorText;
  }

  reportEditorText(text: string): void {
    this.currentEditorText = text;
  }

  async activateFromLaunchState(): Promise<void> {
    const state = await readLaunchState();
    if (!state.projectId) return;
    await this.activateProject(state.projectId, state.threadId);
  }

  dispose(): Promise<void> {
    this.terminalManager.killAll();
    this.subagents.dispose();
    return this.closeConnection();
  }

  /** @deprecated Compact is agent-owned; no-op. */
  async compact(_customInstructions?: string): Promise<void> {
    // Dropped explicit UI compact — agent decides when to compact.
  }
}

/** Back-compat alias used by main.ts during migration. */
export { AgentConnectionManager as AgentManager };
