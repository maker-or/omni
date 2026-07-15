import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
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
import type { Thread } from "../contracts/threads.ts";
import { getProject } from "./projects.ts";
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
import { updateLaunchSelection, readLaunchState } from "./launch-state.ts";
import { getActivePath } from "./workspace-manager.ts";
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

type SendToRenderer = (channel: string, payload: unknown) => void;
type SetWindowTitle = (title: string) => void;
type SendToFlyout = (channel: string, payload: unknown) => void;

interface LiveConnection {
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
  /** Which agent process owns this session — looked up independently of whatever
   * connection is currently active, since the active connection can change out
   * from under a session (e.g. editor/updater) after it was created. */
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
  private readonly sendToFlyout: SendToFlyout;
  private readonly broadcastActiveProject?: (projectId: string) => void;
  private readonly reloadMainWindow?: () => void;
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
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private readonly terminalManager: TerminalManager;
  /** Client-hosted subagent tool: lets any session spawn sibling agent sessions. */
  private readonly subagents: SubagentManager;
  /** Dedup key for the last broadcast running-threads set. */
  private lastRunningThreadsKey = "";
  /** Per tool-call start timestamps for `tool_call_finished` timing, keyed `${sessionId}:${toolCallId}`. */
  private readonly toolCallStarts = new Map<string, { startedAt: number; kind?: string }>();

  // Companion / editor session (ephemeral, not DB-backed)
  private editorSession: ThreadSessionRuntime | null = null;
  private editorAgentSessionId: string | null = null;

  // Updater one-shot
  private updaterSession: ThreadSessionRuntime | null = null;
  private updaterEventHandler: ((payload: AcpBridgeEvent) => void) | null = null;
  private updaterCompletion: {
    resolve: (summary: string) => void;
    reject: (error: Error) => void;
  } | null = null;

  private currentEditorText = "";

  constructor(options: {
    sendToRenderer: SendToRenderer;
    setWindowTitle: SetWindowTitle;
    sendToFlyout?: SendToFlyout;
    broadcastActiveProject?: (projectId: string) => void;
    reloadMainWindow?: () => void;
    captureAnalytics?: (name: AnalyticsEventName, properties: AnalyticsProperties) => void;
    setAgentContext?: (
      ctx: { agentId?: string | null; agentName?: string | null; modelId?: string | null } | null,
    ) => void;
  }) {
    this.sendToRenderer = options.sendToRenderer;
    this.setWindowTitle = options.setWindowTitle;
    this.sendToFlyout = options.sendToFlyout ?? (() => {});
    this.broadcastActiveProject = options.broadcastActiveProject;
    this.reloadMainWindow = options.reloadMainWindow;
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

  private emitEditor(payload: AcpBridgeEvent): void {
    this.sendToFlyout("editor:event", payload);
  }

  private emitUpdater(payload: AcpBridgeEvent): void {
    this.updaterEventHandler?.(payload);
    this.sendToRenderer("updater:event", payload);
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
      agentId: this.connection?.agentId ?? thread?.agent_id ?? null,
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
      authRequiredMessage: this.authMessage(),
      switchingAgent: false,
    };
  }

  private pushState(threadId?: string | null): void {
    const id = threadId ?? this.activeThreadId;
    if (!id) {
      this.emit({ type: "session-state", state: this.getState() });
    } else {
      this.emit({ type: "session-state", state: this.buildSessionState(id) });
    }
    this.emitRunningThreads();
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

    child.stderr.on("data", (buf: Buffer) => {
      const text = buf.toString("utf8").trim();
      if (text) console.error(`[acp-agent:${descriptor.id}]`, text);
    });

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
        return this.handlePermissionRequest(ctx.params);
      })
      .onRequest(acp.methods.client.fs.readTextFile, async (ctx) => {
        return this.handleReadTextFile(ctx.params);
      })
      .onRequest(acp.methods.client.fs.writeTextFile, async (ctx) => {
        return this.handleWriteTextFile(ctx.params);
      })
      .onRequest(acp.methods.client.terminal.create, async (ctx) => {
        const terminalId = this.terminalManager.create({
          command: ctx.params.command,
          args: ctx.params.args ?? undefined,
          cwd: ctx.params.cwd ?? undefined,
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
        const result = await this.terminalManager.waitForExit(ctx.params.terminalId);
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

    initResult = await agentCtx.request(acp.methods.agent.initialize, {
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
    });

    const agentInfoName = initResult.agentInfo?.name ?? descriptor.name ?? descriptor.id;
    const agentCapabilities = initResult.agentCapabilities ?? {};
    const authMethods = initResult.authMethods ?? [];
    const modelState =
      (initResult as { _meta?: { modelState?: LiveConnection["modelState"] } })._meta?.modelState ??
      null;

    const closed = connection.closed.then(() => {
      this.connections.delete(descriptor.id);
      this.invalidateAgentSessions(descriptor.id);
      if (this.connection?.process === child) {
        this.connection = null;
      }
    });

    child.on("exit", () => {
      this.connections.delete(descriptor.id);
      this.invalidateAgentSessions(descriptor.id);
      if (this.connection?.process === child) {
        this.connection = null;
      }
    });

    return {
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
    this.sessions.clear();
    this.terminalManager.killAll();
    const liveConnections = [...this.connections.values()];
    this.connections.clear();
    for (const live of liveConnections) {
      try {
        live.connection.close();
      } catch {
        // ignore
      }
      try {
        live.process.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }

  private invalidateAgentSessions(agentId: string): void {
    for (const threadId of this.sessions.keys()) {
      if (getThread(threadId)?.agent_id === agentId) this.sessions.delete(threadId);
    }
    if (this.editorSession?.agentId === agentId) {
      this.editorSession = null;
      this.editorAgentSessionId = null;
    }
    if (this.updaterSession?.agentId === agentId) {
      this.updaterSession = null;
    }
  }

  private findThreadBySessionId(sessionId: string): string | null {
    for (const [threadId, runtime] of this.sessions) {
      if (runtime.agentSessionId === sessionId) return threadId;
    }
    if (this.editorSession?.agentSessionId === sessionId) return this.editorSession.threadId;
    if (this.updaterSession?.agentSessionId === sessionId) return this.updaterSession.threadId;
    return null;
  }

  private async handleSessionUpdate(sessionId: string, update: SessionUpdate): Promise<void> {
    // Headless subagent sessions accumulate into their run's slice; their
    // streaming must not leak into thread timelines or the renderer.
    if (this.subagents.handleSessionUpdate(sessionId, update)) return;

    const threadId = this.findThreadBySessionId(sessionId);
    let runtime: ThreadSessionRuntime | null = null;
    if (threadId && this.sessions.has(threadId)) {
      runtime = this.sessions.get(threadId)!;
    } else if (this.editorSession?.agentSessionId === sessionId) {
      runtime = this.editorSession;
    } else if (this.updaterSession?.agentSessionId === sessionId) {
      runtime = this.updaterSession;
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

    // Time tool calls for thread sessions only (subagents are handled above;
    // editor/updater runs are ephemeral and excluded).
    if (this.sessions.has(runtime.threadId)) {
      this.trackToolCallTiming(sessionId, runtime, update);
    }

    runtime.slice = applySessionUpdate(runtime.slice, update);
    // `applySessionUpdate` sets isStreaming=true for every agent chunk/tool_call,
    // but only `applyTurnStop` (on the prompt request resolving) clears it. An
    // update that lands outside an active turn — a late flush after the response,
    // or an agent streaming background work out-of-band — would otherwise turn the
    // loader back on with nothing left to clear it. Clamp such updates to
    // non-streaming so the composer's stop button and the tab's working icon
    // reflect only genuine in-flight turns. Scoped to thread sessions; the
    // editor/updater sessions manage their own turn lifecycle.
    if (this.sessions.has(runtime.threadId) && !runtime.promptInFlight && runtime.slice.isStreaming) {
      runtime.slice = { ...runtime.slice, isStreaming: false };
    }
    // A background thread's streaming can flip via updates without a pushState; keep tabs in sync.
    this.emitRunningThreads();

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

    if (this.editorSession?.agentSessionId === sessionId) {
      this.emitEditor(event);
      this.emitEditor({ type: "session-state", state: this.getEditorState() });
    } else if (this.updaterSession?.agentSessionId === sessionId) {
      this.emitUpdater(event);
    } else {
      this.emit(event);
      if (runtime.threadId === this.activeThreadId) {
        this.pushState(runtime.threadId);
      }
    }
  }

  private handlePermissionRequest(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    // Subagent sessions have no UI surface to answer on; resolve per config.
    const auto = this.subagents.autoPermissionResponse(params);
    if (auto) return Promise.resolve(auto);

    const sessionId = params.sessionId;
    const request: AcpPermissionRequest = {
      sessionId,
      threadId: this.findThreadBySessionId(sessionId),
      toolCall: params.toolCall as AcpPermissionRequest["toolCall"],
      options: (params.options ?? []).map((opt) => ({
        optionId: opt.optionId,
        name: opt.name,
        kind: opt.kind,
      })),
    };

    return new Promise((resolve) => {
      this.pendingPermissions.set(sessionId, { resolve, request });
      this.emit({ type: "permission-request", request });
      // Default allow_once after timeout if UI never responds
      setTimeout(() => {
        if (!this.pendingPermissions.has(sessionId)) return;
        const allow = request.options.find((o) => o.kind === "allow_once") ?? request.options[0];
        this.pendingPermissions.delete(sessionId);
        if (allow) {
          resolve({
            outcome: { outcome: "selected", optionId: allow.optionId },
          });
        } else {
          resolve({ outcome: { outcome: "cancelled" } });
        }
        this.emit({ type: "permission-resolved", sessionId });
      }, 120_000);
    });
  }

  async respondToPermission(response: {
    sessionId: string;
    optionId?: string;
    cancelled?: boolean;
  }): Promise<void> {
    const pending = this.pendingPermissions.get(response.sessionId);
    if (!pending) return;
    this.pendingPermissions.delete(response.sessionId);
    if (response.cancelled || !response.optionId) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    } else {
      pending.resolve({
        outcome: { outcome: "selected", optionId: response.optionId },
      });
    }
    this.emit({ type: "permission-resolved", sessionId: response.sessionId });
  }

  private cancelPendingPermissions(sessionId: string): void {
    const pending = this.pendingPermissions.get(sessionId);
    if (!pending) return;
    this.pendingPermissions.delete(sessionId);
    pending.resolve({ outcome: { outcome: "cancelled" } });
    this.emit({ type: "permission-resolved", sessionId });
  }

  private async handleReadTextFile(
    params: acp.ReadTextFileRequest,
  ): Promise<acp.ReadTextFileResponse> {
    const content = await readFile(params.path, "utf8");
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
    await mkdir(dirname(params.path), { recursive: true });
    await writeFile(params.path, params.content, "utf8");
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
  ): Promise<{ servers: Array<Record<string, unknown>>; bind: (sessionId: string) => void }> {
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
    };
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
    const ms = live.modelState;
    const models = ms?.availableModels ?? [];
    if (models.length === 0) return options;
    if (options.some((o) => o.category === "model" || o.id === "model")) return options;
    const modelOption = {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: ms?.currentModelId ?? models[0]?.modelId ?? null,
      options: models.map((m) => ({ value: m.modelId, name: m.name })),
    } as unknown as SessionConfigOption;
    return [modelOption, ...options];
  }

  private async sessionNew(
    live: LiveConnection,
    cwd: string,
  ): Promise<{ sessionId: string; configOptions: SessionConfigOption[] }> {
    const { servers, bind } = await this.sessionMcpServers(live, cwd);
    let result: { sessionId: string; configOptions?: SessionConfigOption[] | null };
    try {
      result = await live.agent.request(acp.methods.agent.session.new, {
        cwd,
        mcpServers: servers as never,
      });
    } catch (err) {
      // A genuine "not signed in" surfaces here as an ACP `auth_required`
      // error — the only reliable signal — so record it for `authMessage()`.
      if (isAuthRequiredError(err)) {
        const descriptor = getAgentDescriptor(live.agentId);
        live.authRequiredMessage =
          descriptor?.authHint ??
          `${descriptor?.displayName ?? live.agentId} requires authentication. Please sign in from your terminal first.`;
      }
      throw err;
    }
    live.authRequiredMessage = null;
    bind(result.sessionId);
    return {
      sessionId: result.sessionId,
      configOptions: this.withModelOption(
        live,
        (result.configOptions as SessionConfigOption[] | null | undefined) ?? [],
      ),
    };
  }

  private async sessionLoad(
    live: LiveConnection,
    cwd: string,
    sessionId: string,
  ): Promise<{ sessionId: string; configOptions: SessionConfigOption[] }> {
    const { servers, bind } = await this.sessionMcpServers(live, cwd);
    const result = await live.agent.request(acp.methods.agent.session.load, {
      cwd,
      sessionId,
      mcpServers: servers as never,
    });
    bind((result as { sessionId?: string })?.sessionId ?? sessionId);
    return {
      sessionId: (result as { sessionId?: string })?.sessionId ?? sessionId,
      configOptions: this.withModelOption(
        live,
        ((result as { configOptions?: SessionConfigOption[] | null })?.configOptions as
          | SessionConfigOption[]
          | null
          | undefined) ?? [],
      ),
    };
  }

  private async sessionResume(
    live: LiveConnection,
    prevSessionId: string,
    cwd: string,
  ): Promise<{ sessionId: string; configOptions: SessionConfigOption[] }> {
    const { servers, bind } = await this.sessionMcpServers(live, cwd);
    const result = await live.agent.request(acp.methods.agent.session.resume, {
      prevSessionId,
      cwd,
      mcpServers: servers as never,
    } as never);
    bind((result as { sessionId?: string })?.sessionId ?? prevSessionId);
    return {
      sessionId: (result as { sessionId?: string })?.sessionId ?? prevSessionId,
      configOptions: this.withModelOption(
        live,
        ((result as { configOptions?: SessionConfigOption[] | null })?.configOptions as
          | SessionConfigOption[]
          | null
          | undefined) ?? [],
      ),
    };
  }

  async activateProject(projectId: string, preferredThreadId?: string | null): Promise<void> {
    const project = getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    this.activeProjectId = projectId;
    setActiveProjectId(projectId);
    this.broadcastActiveProject?.(projectId);

    const threads = listThreads().filter((t) => t.project_id === projectId);
    let thread: Thread | null = preferredThreadId
      ? getThread(preferredThreadId)
      : (threads[0] ?? null);

    if (!thread) {
      this.activeThreadId = null;
      await updateLaunchSelection({ projectId, threadId: null });
      this.pushState(null);
      return;
    } else {
      await this.switchThread(thread.id);
    }

    await updateLaunchSelection({ projectId, threadId: thread.id });
  }

  async switchThread(threadId: string): Promise<void> {
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

    // Close previous session optionally — skip for rapid switches; load new
    if (!this.sessions.has(threadId)) {
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
        cwd: project.path,
        slice: createEmptySessionSlice(),
        editorText: "",
        promptInFlight: false,
      };
      this.sessions.set(threadId, runtime);

      try {
        let sessionId = thread.agent_session_id;
        let configOptions: SessionConfigOption[] = [];
        try {
          const loaded = await this.sessionLoad(live, project.path, sessionId);
          sessionId = loaded.sessionId;
          configOptions = loaded.configOptions;
        } catch {
          // Agent restarted — try resume. A failed load may have streamed a
          // partial replay before erroring; drop it so the fallback path
          // doesn't append onto half a timeline.
          runtime.slice = createEmptySessionSlice();
          try {
            const resumed = await this.sessionResume(live, thread.agent_session_id, project.path);
            sessionId = resumed.sessionId;
            configOptions = resumed.configOptions;
            updateThreadAgentSessionId(threadId, sessionId);
          } catch {
            const created = await this.sessionNew(live, project.path);
            sessionId = created.sessionId;
            configOptions = created.configOptions;
            updateThreadAgentSessionId(threadId, sessionId);
          }
        }

        // Merge instead of replacing the slice: the replay already populated
        // entries/toolCalls, only the session identity and config are new.
        runtime.agentSessionId = sessionId;
        if (configOptions.length > 0 || runtime.slice.configOptions.length === 0) {
          runtime.slice = { ...runtime.slice, configOptions };
        }
      } catch (err) {
        // No session could be established — remove the placeholder so a
        // retry doesn't silently reuse a dead runtime.
        this.sessions.delete(threadId);
        throw err;
      }
    }

    touchThread(threadId);
    await updateLaunchSelection({ projectId: project.id, threadId });
    this.pushState(threadId);
  }

  async createThread(
    projectId: string,
    title: string | null,
    afterThreadId?: string | null,
    agentId?: string | null,
  ): Promise<Thread> {
    const project = getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const targetAgentId = agentId ?? this.preferredAgentId;
    const live = await this.ensureConnection(targetAgentId);
    const created = await this.sessionNew(live, project.path);

    let sortOrder: number | undefined;
    if (afterThreadId) {
      const afterOrder = getThreadSortOrder(afterThreadId);
      if (afterOrder != null) sortOrder = afterOrder + 1;
    }

    const thread = createThreadRow(projectId, title, live.agentId, created.sessionId, sortOrder);

    this.sessions.set(thread.id, {
      threadId: thread.id,
      agentSessionId: created.sessionId,
      agentId: live.agentId,
      projectId,
      cwd: project.path,
      slice: createEmptySessionSlice({ configOptions: created.configOptions }),
      editorText: "",
      promptInFlight: false,
    });

    this.activeProjectId = projectId;
    this.activeThreadId = thread.id;
    this.publishActiveAgentContext(live.agentId);
    setActiveProjectId(projectId);
    touchThread(thread.id);
    await updateLaunchSelection({ projectId, threadId: thread.id });

    this.captureAnalytics?.("thread_created", {
      project_id: projectId,
      thread_id: thread.id,
      agent_id: live.agentId,
      agent_name: getAgentDescriptor(live.agentId)?.name,
    } as AnalyticsProperties);

    this.pushState(thread.id);
    return thread;
  }

  async deleteThread(threadId: string): Promise<void> {
    const thread = getThread(threadId);
    if (!thread) return;

    const runtime = this.sessions.get(threadId);
    const sessionId = runtime?.agentSessionId ?? thread.agent_session_id;
    if (this.connection && sessionId) {
      try {
        await this.connection.agent.request(acp.methods.agent.session.delete, {
          sessionId,
        });
      } catch {
        // best effort
      }
    }
    this.sessions.delete(threadId);
    removeThreadRow(threadId);

    if (this.activeThreadId === threadId) {
      this.activeThreadId = null;
      const remaining = listThreads().filter((t) => t.project_id === thread.project_id);
      if (remaining[0]) {
        await this.switchThread(remaining[0].id);
      } else {
        this.pushState();
      }
    }
  }

  async closeThreadSession(threadId: string): Promise<void> {
    const runtime = this.sessions.get(threadId);
    if (!runtime || !this.connection) return;
    try {
      await this.connection.agent.request(acp.methods.agent.session.close, {
        sessionId: runtime.agentSessionId,
      });
    } catch {
      // best effort
    }
    this.sessions.delete(threadId);
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
    const threadId = input.threadId ?? this.activeThreadId;
    if (!threadId) throw new Error("No active thread");
    if (!this.sessions.has(threadId)) {
      await this.switchThread(threadId);
    }
    const runtime = this.sessions.get(threadId);
    const live = this.connection;
    if (!runtime || !live) throw new Error("No session for thread");

    const caps = live.agentCapabilities.promptCapabilities;
    const blocks = assemblePromptBlocks({
      message: input.message,
      images: input.images,
      resources: input.resources,
      prompt: input.prompt,
      allowImage: caps?.image !== false,
      allowEmbeddedContext: Boolean(caps?.embeddedContext),
    });

    if (input.message) {
      runtime.slice = appendLocalUserMessage(runtime.slice, input.message);
      this.pushState(threadId);
    }

    runtime.promptInFlight = true;
    runtime.slice = { ...runtime.slice, isStreaming: true };
    this.pushState(threadId);
    touchThread(threadId);

    const agentProps = this.agentProps(live.agentId);
    this.captureAnalytics?.("prompt_submitted", {
      ...agentProps,
      project_id: runtime.projectId,
      thread_id: threadId,
      has_images: Boolean(input.images?.length),
      has_resources: Boolean(input.resources?.length),
    });
    const turnStartedAt = Date.now();
    const toolCallsBefore = Object.keys(runtime.slice.toolCalls).length;

    try {
      const result = await live.agent.request(acp.methods.agent.session.prompt, {
        sessionId: runtime.agentSessionId,
        prompt: blocks,
      });
      runtime.promptInFlight = false;
      runtime.slice = applyTurnStop(runtime.slice);
      this.captureAnalytics?.("turn_completed", {
        ...agentProps,
        thread_id: threadId,
        stop_reason: result.stopReason,
        turn_duration_ms: Date.now() - turnStartedAt,
        tool_call_count: Math.max(
          0,
          Object.keys(runtime.slice.toolCalls).length - toolCallsBefore,
        ),
      });
      this.reportTokens(runtime, agentProps, threadId);
      this.emit({
        type: "stop",
        sessionId: runtime.agentSessionId,
        threadId,
        stopReason: result.stopReason,
      });
      this.pushState(threadId);
    } catch (err) {
      runtime.promptInFlight = false;
      runtime.slice = applyTurnStop(runtime.slice);
      this.captureAnalytics?.("turn_failed", {
        ...agentProps,
        thread_id: threadId,
        turn_duration_ms: Date.now() - turnStartedAt,
        error_type: err instanceof Error ? err.name : undefined,
      });
      this.pushState(threadId);
      throw err;
    }
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
    const live = this.connection;
    if (!runtime || !live) throw new Error("No session for thread");

    runtime.promptInFlight = true;
    runtime.slice = appendLocalUserMessage(runtime.slice, input.text);
    runtime.slice = { ...runtime.slice, isStreaming: true };
    this.pushState(threadId);

    try {
      // Custom extension method
      await live.agent.request("_pipper/replace_prompt", {
        sessionId: runtime.agentSessionId,
        promptId: input.promptId,
        text: input.text,
      });
      runtime.promptInFlight = false;
      runtime.slice = applyTurnStop(runtime.slice);
      this.pushState(threadId);
    } catch {
      runtime.promptInFlight = false;
      // Fallback: regular prompt
      await this.sendPrompt({
        threadId,
        message: input.text,
        images: input.images,
      });
    }
  }

  async abort(): Promise<void> {
    const threadId = this.activeThreadId;
    if (!threadId || !this.connection) return;
    const runtime = this.sessions.get(threadId);
    if (!runtime) return;
    await this.connection.agent.notify(acp.methods.agent.session.cancel, {
      sessionId: runtime.agentSessionId,
    });
    this.cancelPendingPermissions(runtime.agentSessionId);
    // Cascade cancel to subagent runs this session spawned.
    this.subagents.cancelRunsForParent(runtime.agentSessionId);
    // Cascade cancel to ACP agent terminals (session/cancel → terminal/kill).
    // Kill keeps terminalIds valid for final output queries; release is agent-owned.
    this.terminalManager.killRunning();
  }

  async setConfigOption(configId: string, value: string | boolean): Promise<SessionConfigOption[]> {
    const threadId = this.activeThreadId;
    if (!threadId || !this.connection) return [];
    const runtime = this.sessions.get(threadId);
    if (!runtime) return [];
    // Grok exposes its models via initialize `_meta.modelState` and switches them
    // with a custom `session/set_model` method — it doesn't implement the standard
    // `session/set_config_option`. Route the synthesized "model" option there and
    // update the local option optimistically (the agent acks via `_meta.model.Ok`).
    if (configId === "model" && this.connection.modelState) {
      await this.connection.agent.request("session/set_model" as never, {
        sessionId: runtime.agentSessionId,
        modelId: value,
      } as never);
      const options = runtime.slice.configOptions.map((o) =>
        o.id === "model" || o.category === "model"
          ? ({ ...o, currentValue: value } as SessionConfigOption)
          : o,
      );
      runtime.slice = { ...runtime.slice, configOptions: options };
      this.pushState(threadId);
      return options;
    }
    const result = await this.connection.agent.request(acp.methods.agent.session.setConfigOption, {
      sessionId: runtime.agentSessionId,
      configId,
      value: value as never,
    });
    const options =
      (result.configOptions as SessionConfigOption[] | null | undefined) ??
      runtime.slice.configOptions;
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

  getStats() {
    const usage = this.getState().usage;
    if (!usage) return null;
    return {
      used: usage.used,
      size: usage.size,
      cost: usage.cost,
    };
  }

  // ─── Editor / companion ───────────────────────────────────────────────────

  async activateEditor(): Promise<void> {
    if (this.editorSession) return;
    const live = await this.ensureConnection(this.preferredAgentId);
    const cwd = getActivePath();
    const created = await this.sessionNew(live, cwd);
    this.editorAgentSessionId = created.sessionId;
    this.editorSession = {
      threadId: "__editor__",
      agentSessionId: created.sessionId,
      agentId: live.agentId,
      projectId: "__omni_editor__",
      cwd,
      slice: createEmptySessionSlice({ configOptions: created.configOptions }),
      editorText: this.currentEditorText,
      promptInFlight: false,
    };
    this.emitEditor({ type: "session-state", state: this.getEditorState() });
  }

  getEditorState(): AcpSessionState {
    const runtime = this.editorSession;
    if (!runtime) {
      return {
        ...emptySessionState(),
        title: "Visual Editor",
        editorText: this.currentEditorText,
      };
    }
    return {
      projectId: runtime.projectId,
      threadId: runtime.threadId,
      agentId: runtime.agentId,
      agentSessionId: runtime.agentSessionId,
      cwd: runtime.cwd,
      title: runtime.slice.title ?? "Visual Editor",
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
      authRequiredMessage: null,
      switchingAgent: false,
    };
  }

  async sendEditorPrompt(input: {
    message: string;
    images?: Array<{ data: string; mimeType: string }>;
    streamingBehavior?: "followUp" | "steer";
  }): Promise<void> {
    type EditorPromptQueue = {
      promptChain?: Promise<void>;
      pendingPromptCount?: number;
      abortEpoch?: number;
    };
    if (!this.editorSession) await this.activateEditor();
    const runtime = this.editorSession as (typeof this.editorSession & EditorPromptQueue) | null;
    if (!runtime) throw new Error("Editor session unavailable");
    const live = this.connections.get(runtime.agentId);
    if (!live) {
      // The agent process that owned this session is gone (crashed/respawned
      // under the same agentId) — its session state can't be recovered.
      this.editorSession = null;
      this.editorAgentSessionId = null;
      throw new Error("Editor session unavailable");
    }

    const blocks = assemblePromptBlocks({
      message: input.message,
      images: input.images,
      allowImage: true,
    });
    // Surface the user message immediately, even when it has to wait for an
    // in-flight turn — the companion renders it as a queued follow-up.
    runtime.slice = appendLocalUserMessage(runtime.slice, input.message);
    runtime.slice = { ...runtime.slice, isStreaming: true };
    runtime.pendingPromptCount = (runtime.pendingPromptCount ?? 0) + 1;
    this.emitEditor({ type: "session-state", state: this.getEditorState() });

    const settle = () => {
      if (this.editorSession !== runtime) return;
      runtime.pendingPromptCount = Math.max(0, (runtime.pendingPromptCount ?? 1) - 1);
      // Only settle the turn once no follow-up prompt is queued behind this
      // one — otherwise the companion flashes idle (and shows accept/reject)
      // between serialized prompts. Always runs, including on prompt errors,
      // so the editor can never be stuck in a streaming state.
      if (runtime.pendingPromptCount === 0) {
        runtime.slice = applyTurnStop(runtime.slice);
      }
      this.emitEditor({ type: "session-state", state: this.getEditorState() });
    };
    const epoch = runtime.abortEpoch ?? 0;
    const run = async () => {
      // Session disposed while this prompt was queued.
      if (this.editorSession !== runtime) return;
      // User aborted while this prompt was queued — drop it.
      if ((runtime.abortEpoch ?? 0) !== epoch) {
        settle();
        return;
      }
      try {
        await live.agent.request(acp.methods.agent.session.prompt, {
          sessionId: runtime.agentSessionId,
          prompt: blocks,
        });
      } finally {
        settle();
      }
    };

    // Serialize prompts: the editor session can only run one turn at a time,
    // so a prompt sent while streaming becomes a follow-up turn instead of a
    // concurrent session/prompt request racing the in-flight one.
    const chain = (runtime.promptChain ?? Promise.resolve()).then(run, run);
    runtime.promptChain = chain.then(
      () => undefined,
      () => undefined,
    );
    await chain;
  }

  async abortEditor(): Promise<void> {
    if (!this.editorSession) return;
    const live = this.connections.get(this.editorSession.agentId);
    if (!live) {
      this.editorSession = null;
      this.editorAgentSessionId = null;
      return;
    }
    // Bump the abort epoch so prompts queued behind the in-flight turn are
    // dropped instead of firing after the user pressed stop.
    const runtime = this.editorSession as typeof this.editorSession & { abortEpoch?: number };
    runtime.abortEpoch = (runtime.abortEpoch ?? 0) + 1;
    await live.agent.notify(acp.methods.agent.session.cancel, {
      sessionId: this.editorSession.agentSessionId,
    });
    this.cancelPendingPermissions(this.editorSession.agentSessionId);
    this.subagents.cancelRunsForParent(this.editorSession.agentSessionId);
    this.terminalManager.killRunning();
  }

  async setEditorModel(model: { provider?: string; modelId: string }): Promise<boolean> {
    if (!this.editorSession) return false;
    const live = this.connections.get(this.editorSession.agentId);
    if (!live) {
      this.editorSession = null;
      this.editorAgentSessionId = null;
      return false;
    }
    // Prefer config option id "model" when present
    const modelOpt = this.editorSession.slice.configOptions.find(
      (o) => o.category === "model" || o.id === "model",
    );
    if (!modelOpt) return false;
    try {
      // Grok-style agents switch models via the custom `session/set_model` method
      // rather than `session/set_config_option` (see setConfigOption).
      if (live.modelState) {
        await live.agent.request("session/set_model" as never, {
          sessionId: this.editorSession.agentSessionId,
          modelId: model.modelId,
        } as never);
      } else {
        await live.agent.request(acp.methods.agent.session.setConfigOption, {
          sessionId: this.editorSession.agentSessionId,
          configId: modelOpt.id,
          value: model.modelId as never,
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  async disposeEditor(): Promise<void> {
    if (!this.editorSession) return;
    const live = this.connections.get(this.editorSession.agentId);
    if (live) {
      try {
        await live.agent.request(acp.methods.agent.session.close, {
          sessionId: this.editorSession.agentSessionId,
        });
      } catch {
        // ignore
      }
    }
    this.editorSession = null;
    this.editorAgentSessionId = null;
  }

  async setEditorText(text: string): Promise<void> {
    this.currentEditorText = text;
    if (this.editorSession) this.editorSession.editorText = text;
    const active = this.activeThreadId ? this.sessions.get(this.activeThreadId) : null;
    if (active) active.editorText = text;
    this.emit({ type: "editor-text", text });
    this.emitEditor({ type: "editor-text", text });
  }

  async pasteToEditor(text: string): Promise<void> {
    await this.setEditorText(this.currentEditorText + text);
  }

  getEditorText(): string {
    return this.currentEditorText;
  }

  reportEditorText(text: string): void {
    this.currentEditorText = text;
    if (this.editorSession) this.editorSession.editorText = text;
  }

  // ─── Updater one-shot session ─────────────────────────────────────────────

  setUpdaterEventHandler(handler: ((payload: AcpBridgeEvent) => void) | null): void {
    this.updaterEventHandler = handler;
  }

  getUpdaterSnapshot(): AcpSessionState {
    return this.getUpdaterState();
  }

  getUpdaterState(): AcpSessionState {
    if (!this.updaterSession) return emptySessionState();
    const runtime = this.updaterSession;
    return {
      projectId: runtime.projectId,
      threadId: runtime.threadId,
      agentId: runtime.agentId,
      agentSessionId: runtime.agentSessionId,
      cwd: runtime.cwd,
      title: "Updater",
      configOptions: runtime.slice.configOptions,
      commands: runtime.slice.commands,
      entries: runtime.slice.entries,
      toolCalls: runtime.slice.toolCalls,
      plan: runtime.slice.plan,
      usage: runtime.slice.usage,
      currentModeId: runtime.slice.currentModeId,
      isStreaming: runtime.slice.isStreaming,
      isCompacting: false,
      editorText: "",
      authRequiredMessage: null,
      switchingAgent: false,
    };
  }

  isEditorActive(): boolean {
    return this.editorSession != null;
  }

  isEditorBusy(): boolean {
    return Boolean(this.editorSession?.slice.isStreaming);
  }

  async activateUpdater(cwd?: string): Promise<void> {
    if (this.updaterSession) return;
    const live = await this.ensureConnection(this.preferredAgentId);
    const workdir = cwd ?? getActivePath();
    const created = await this.sessionNew(live, workdir);
    this.updaterSession = {
      threadId: "__updater__",
      agentSessionId: created.sessionId,
      agentId: live.agentId,
      projectId: "__updater__",
      cwd: workdir,
      slice: createEmptySessionSlice({ configOptions: created.configOptions }),
      editorText: "",
      promptInFlight: false,
    };
    this.emitUpdater({ type: "session-state", state: this.getUpdaterState() });
  }

  async sendUpdaterPrompt(message: string): Promise<string> {
    if (!this.updaterSession) {
      await this.activateUpdater();
    }
    const runtime = this.updaterSession;
    if (!runtime) throw new Error("Updater session unavailable");
    const live = this.connections.get(runtime.agentId);
    if (!live) {
      this.updaterSession = null;
      throw new Error("Updater session unavailable");
    }

    runtime.slice = appendLocalUserMessage(runtime.slice, message);
    runtime.slice = { ...runtime.slice, isStreaming: true };
    this.emitUpdater({ type: "session-state", state: this.getUpdaterState() });

    try {
      await live.agent.request(acp.methods.agent.session.prompt, {
        sessionId: runtime.agentSessionId,
        prompt: [{ type: "text", text: message } as ContentBlock],
      });
      runtime.slice = applyTurnStop(runtime.slice);
      this.emitUpdater({ type: "session-state", state: this.getUpdaterState() });
      const texts = runtime.slice.entries
        .filter((entry) => entry.type === "agent_text")
        .map((entry) => entry.text)
        .join("\n");
      return texts.trim() || "Update complete";
    } catch (err) {
      runtime.slice = applyTurnStop(runtime.slice);
      this.emitUpdater({ type: "session-state", state: this.getUpdaterState() });
      throw err;
    }
  }

  async abortUpdater(): Promise<void> {
    if (!this.updaterSession) return;
    const live = this.connections.get(this.updaterSession.agentId);
    if (!live) {
      this.updaterSession = null;
      return;
    }
    await live.agent.notify(acp.methods.agent.session.cancel, {
      sessionId: this.updaterSession.agentSessionId,
    });
    this.cancelPendingPermissions(this.updaterSession.agentSessionId);
    this.subagents.cancelRunsForParent(this.updaterSession.agentSessionId);
  }

  async disposeUpdater(): Promise<void> {
    if (!this.updaterSession) return;
    const live = this.connections.get(this.updaterSession.agentId);
    if (live) {
      try {
        await live.agent.request(acp.methods.agent.session.close, {
          sessionId: this.updaterSession.agentSessionId,
        });
      } catch {
        // ignore
      }
    }
    this.updaterSession = null;
    this.updaterCompletion = null;
  }

  async runUpdaterPrompt(message: string, cwd?: string): Promise<string> {
    await this.activateUpdater(cwd);
    try {
      return await this.sendUpdaterPrompt(message);
    } finally {
      await this.disposeUpdater();
    }
  }

  async activateFromLaunchState(): Promise<void> {
    const state = await readLaunchState();
    if (!state.projectId) return;
    await this.activateProject(state.projectId, state.threadId);
  }

  /**
   * Stop all user-facing agent activity before an update snapshots and
   * promotes the workspace: cancel every in-flight turn, resolve pending
   * permission requests as cancelled, dispose the editor session, kill
   * agent-owned terminals, and shut down agent processes so nothing writes
   * to the active workspace mid-promotion. The updater re-establishes its
   * own connection afterwards via activateUpdater() → ensureConnection().
   */
  async quiesceForUpdate(): Promise<void> {
    const live = this.connection;
    if (live) {
      for (const runtime of this.sessions.values()) {
        if (!runtime.slice.isStreaming) continue;
        try {
          await live.agent.notify(acp.methods.agent.session.cancel, {
            sessionId: runtime.agentSessionId,
          });
        } catch {
          // Connection may already be down; process kill below still applies.
        }
        this.cancelPendingPermissions(runtime.agentSessionId);
        runtime.promptInFlight = false;
        runtime.slice = applyTurnStop(runtime.slice);
      }
    }
    await this.disposeEditor().catch(() => {});
    await this.closeConnection().catch(() => {});
  }

  dispose(): Promise<void> {
    this.terminalManager.killAll();
    this.subagents.dispose();
    return Promise.allSettled([this.disposeEditor(), this.closeConnection()]).then(() => undefined);
  }

  /** @deprecated Compact is agent-owned; no-op. */
  async compact(_customInstructions?: string): Promise<void> {
    // Dropped explicit UI compact — agent decides when to compact.
  }
}

/** Back-compat alias used by main.ts during migration. */
export { AgentConnectionManager as AgentManager };
