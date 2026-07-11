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
import type { Project } from "../contracts/projects.ts";
import type { Thread } from "../contracts/threads.ts";
import { getProject } from "./projects.ts";
import { getActiveProjectId, setActiveProjectId } from "./session.ts";
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
import { TerminalManager } from "./terminal-manager.ts";
import {
  applySessionUpdate,
  applyTurnStop,
  appendLocalUserMessage,
  assemblePromptBlocks,
  createEmptySessionSlice,
  type AcpSessionSlice,
} from "../src/lib/acp-session-reducer.ts";
import type { AnalyticsProperties } from "./analytics-schema.ts";

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
  closed: Promise<void>;
}

interface ThreadSessionRuntime {
  threadId: string;
  agentSessionId: string;
  projectId: string;
  cwd: string;
  slice: AcpSessionSlice;
  editorText: string;
}

interface PendingPermission {
  resolve: (response: acp.RequestPermissionResponse) => void;
  request: AcpPermissionRequest;
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
    name: "mutation_started" | "mutation_completed" | "thread_created",
    properties: AnalyticsProperties,
  ) => void;

  private connection: LiveConnection | null = null;
  private connecting: Promise<LiveConnection> | null = null;
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
  /** Dedup key for the last broadcast running-threads set. */
  private lastRunningThreadsKey = "";

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
    captureAnalytics?: (
      name: "mutation_started" | "mutation_completed" | "thread_created",
      properties: AnalyticsProperties,
    ) => void;
  }) {
    this.sendToRenderer = options.sendToRenderer;
    this.setWindowTitle = options.setWindowTitle;
    this.sendToFlyout = options.sendToFlyout ?? (() => {});
    this.broadcastActiveProject = options.broadcastActiveProject;
    this.reloadMainWindow = options.reloadMainWindow;
    this.captureAnalytics = options.captureAnalytics;
    this.terminalManager = new TerminalManager({
      onOutput: (terminalId, chunk) => {
        this.emit({ type: "terminal-output", terminalId, output: chunk, append: true });
      },
    });
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
    const methods = this.connection?.authMethods ?? [];
    if (methods.length === 0) return null;
    const names = methods.map((m) => m.name ?? m.id).join(", ");
    return `This agent requires authentication (${names}). Please authenticate the agent in your terminal first.`;
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

  async switchAgent(agentId: string): Promise<LiveConnection> {
    const descriptor = getAgentDescriptor(agentId);
    if (!descriptor) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    this.emit({
      type: "session-state",
      state: { ...this.getState(), switchingAgent: true },
    });

    const live = this.connections.get(agentId) ?? (await this.spawnAndInitialize(descriptor));
    this.connections.set(agentId, live);
    this.connection = live;
    this.preferredAgentId = agentId;

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
    if (this.editorSession && this.connection?.agentId === agentId) {
      this.editorSession = null;
      this.editorAgentSessionId = null;
    }
    if (this.updaterSession && this.connection?.agentId === agentId) {
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

    runtime.slice = applySessionUpdate(runtime.slice, update);
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

  private async sessionNew(
    live: LiveConnection,
    cwd: string,
  ): Promise<{ sessionId: string; configOptions: SessionConfigOption[] }> {
    const mcpServers = this.mcpServersForConnection(live);
    const result = await live.agent.request(acp.methods.agent.session.new, {
      cwd,
      mcpServers: mcpServers as never,
    });
    return {
      sessionId: result.sessionId,
      configOptions: (result.configOptions as SessionConfigOption[] | null | undefined) ?? [],
    };
  }

  private async sessionLoad(
    live: LiveConnection,
    cwd: string,
    sessionId: string,
  ): Promise<{ sessionId: string; configOptions: SessionConfigOption[] }> {
    const mcpServers = this.mcpServersForConnection(live);
    const result = await live.agent.request(acp.methods.agent.session.load, {
      cwd,
      sessionId,
      mcpServers: mcpServers as never,
    });
    return {
      sessionId: (result as { sessionId?: string })?.sessionId ?? sessionId,
      configOptions:
        ((result as { configOptions?: SessionConfigOption[] | null })?.configOptions as
          | SessionConfigOption[]
          | null
          | undefined) ?? [],
    };
  }

  private async sessionResume(
    live: LiveConnection,
    prevSessionId: string,
    cwd: string,
  ): Promise<{ sessionId: string; configOptions: SessionConfigOption[] }> {
    const mcpServers = this.mcpServersForConnection(live);
    const result = await live.agent.request(acp.methods.agent.session.resume, {
      prevSessionId,
      cwd,
      mcpServers: mcpServers as never,
    } as never);
    return {
      sessionId: result.sessionId,
      configOptions: (result.configOptions as SessionConfigOption[] | null | undefined) ?? [],
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
    this.activeProjectId = project.id;
    this.activeThreadId = threadId;
    setActiveProjectId(project.id);

    // Close previous session optionally — skip for rapid switches; load new
    if (!this.sessions.has(threadId)) {
      let sessionId = thread.agent_session_id;
      let configOptions: SessionConfigOption[] = [];
      try {
        const loaded = await this.sessionLoad(live, project.path, sessionId);
        sessionId = loaded.sessionId;
        configOptions = loaded.configOptions;
      } catch {
        // Agent restarted — try resume
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

      this.sessions.set(threadId, {
        threadId,
        agentSessionId: sessionId,
        projectId: project.id,
        cwd: project.path,
        slice: createEmptySessionSlice({ configOptions }),
        editorText: "",
      });
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
      projectId,
      cwd: project.path,
      slice: createEmptySessionSlice({ configOptions: created.configOptions }),
      editorText: "",
    });

    this.activeProjectId = projectId;
    this.activeThreadId = thread.id;
    setActiveProjectId(projectId);
    touchThread(thread.id);
    await updateLaunchSelection({ projectId, threadId: thread.id });

    this.captureAnalytics?.("thread_created", {
      project_id: projectId,
      thread_id: thread.id,
      agent_id: live.agentId,
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

    runtime.slice = { ...runtime.slice, isStreaming: true };
    this.pushState(threadId);
    touchThread(threadId);

    try {
      const result = await live.agent.request(acp.methods.agent.session.prompt, {
        sessionId: runtime.agentSessionId,
        prompt: blocks,
      });
      runtime.slice = applyTurnStop(runtime.slice);
      this.emit({
        type: "stop",
        sessionId: runtime.agentSessionId,
        threadId,
        stopReason: result.stopReason,
      });
      this.pushState(threadId);
    } catch (err) {
      runtime.slice = applyTurnStop(runtime.slice);
      this.pushState(threadId);
      throw err;
    }
  }

  async replacePrompt(input: AcpReplacePromptInput): Promise<void> {
    const threadId = input.threadId;
    if (!this.sessions.has(threadId)) {
      await this.switchThread(threadId);
    }
    const runtime = this.sessions.get(threadId);
    const live = this.connection;
    if (!runtime || !live) throw new Error("No session for thread");

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
      runtime.slice = applyTurnStop(runtime.slice);
      this.pushState(threadId);
    } catch {
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
    // Cascade cancel to ACP agent terminals (session/cancel → terminal/kill).
    // Kill keeps terminalIds valid for final output queries; release is agent-owned.
    this.terminalManager.killRunning();
  }

  async setConfigOption(configId: string, value: string | boolean): Promise<SessionConfigOption[]> {
    const threadId = this.activeThreadId;
    if (!threadId || !this.connection) return [];
    const runtime = this.sessions.get(threadId);
    if (!runtime) return [];
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
      projectId: "__omni_editor__",
      cwd,
      slice: createEmptySessionSlice({ configOptions: created.configOptions }),
      editorText: this.currentEditorText,
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
      agentId: this.connection?.agentId ?? null,
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
  }): Promise<void> {
    if (!this.editorSession) await this.activateEditor();
    const runtime = this.editorSession;
    const live = this.connection;
    if (!runtime || !live) throw new Error("Editor session unavailable");

    const blocks = assemblePromptBlocks({
      message: input.message,
      images: input.images,
      allowImage: true,
    });
    runtime.slice = appendLocalUserMessage(runtime.slice, input.message);
    runtime.slice = { ...runtime.slice, isStreaming: true };
    this.emitEditor({ type: "session-state", state: this.getEditorState() });

    try {
      await live.agent.request(acp.methods.agent.session.prompt, {
        sessionId: runtime.agentSessionId,
        prompt: blocks,
      });
      runtime.slice = applyTurnStop(runtime.slice);
    } finally {
      this.emitEditor({ type: "session-state", state: this.getEditorState() });
    }
  }

  async abortEditor(): Promise<void> {
    if (!this.editorSession || !this.connection) return;
    await this.connection.agent.notify(acp.methods.agent.session.cancel, {
      sessionId: this.editorSession.agentSessionId,
    });
    this.cancelPendingPermissions(this.editorSession.agentSessionId);
    this.terminalManager.killRunning();
  }

  async setEditorModel(model: { provider?: string; modelId: string }): Promise<boolean> {
    if (!this.editorSession || !this.connection) return false;
    // Prefer config option id "model" when present
    const modelOpt = this.editorSession.slice.configOptions.find(
      (o) => o.category === "model" || o.id === "model",
    );
    if (!modelOpt) return false;
    try {
      await this.connection.agent.request(acp.methods.agent.session.setConfigOption, {
        sessionId: this.editorSession.agentSessionId,
        configId: modelOpt.id,
        value: model.modelId as never,
      });
      return true;
    } catch {
      return false;
    }
  }

  async disposeEditor(): Promise<void> {
    if (!this.editorSession) return;
    if (this.connection) {
      try {
        await this.connection.agent.request(acp.methods.agent.session.close, {
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
      agentId: this.connection?.agentId ?? null,
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
      projectId: "__updater__",
      cwd: workdir,
      slice: createEmptySessionSlice({ configOptions: created.configOptions }),
      editorText: "",
    };
    this.emitUpdater({ type: "session-state", state: this.getUpdaterState() });
  }

  async sendUpdaterPrompt(message: string): Promise<string> {
    if (!this.updaterSession) {
      await this.activateUpdater();
    }
    const live = this.connection;
    const runtime = this.updaterSession;
    if (!live || !runtime) throw new Error("Updater session unavailable");

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
    if (!this.updaterSession || !this.connection) return;
    await this.connection.agent.notify(acp.methods.agent.session.cancel, {
      sessionId: this.updaterSession.agentSessionId,
    });
    this.cancelPendingPermissions(this.updaterSession.agentSessionId);
  }

  async disposeUpdater(): Promise<void> {
    if (!this.updaterSession) return;
    if (this.connection) {
      try {
        await this.connection.agent.request(acp.methods.agent.session.close, {
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

  dispose(): Promise<void> {
    this.terminalManager.killAll();
    return Promise.allSettled([this.disposeEditor(), this.closeConnection()]).then(() => undefined);
  }

  /** @deprecated Compact is agent-owned; no-op. */
  async compact(_customInstructions?: string): Promise<void> {
    // Dropped explicit UI compact — agent decides when to compact.
  }
}

/** Back-compat alias used by main.ts during migration. */
export { AgentConnectionManager as AgentManager };
