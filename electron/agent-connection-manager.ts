import { readFile, writeFile, mkdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname } from "node:path";
import * as acp from "@agentclientprotocol/sdk";
import type {
  AgentCapabilities,
  ContentBlock,
  SessionConfigOption,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
import type {
  AcpAgentDescriptor,
  AcpBridgeEvent,
  AcpPromptInput,
  AcpReplacePromptInput,
  AcpSessionState,
  AcpToolCallState,
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
import { getAgentDescriptor, getDefaultAgentId, listRegisteredAgents } from "./agents/registry.ts";
import {
  ACP_SWITCH_PHASE_TIMEOUT_MS,
  ConnectionLifecycle,
  requestWithTimeout,
  type AgentMonitorObserver,
  type LiveConnection,
} from "./connection-lifecycle.ts";
import { listMcpServers, toAcpMcpServers } from "./mcp-servers.ts";
import { SubagentManager } from "./subagents/subagent-manager.ts";
import { TerminalManager } from "./terminal-manager.ts";
import type { AgentOsNotification, OsNotifier } from "./os-notifications.ts";
import type { WindowAttentionSource, WindowVisibilitySource } from "./window-visibility.ts";
import { WorkspaceGuard } from "./workspace-guard.ts";
import { ThreadSessionRegistry, type ThreadSessionRuntime } from "./thread-session-registry.ts";
import { ThreadSnapshotStore, type LoadedThreadSnapshot } from "./thread-snapshot-store.ts";
import {
  ActivationSupersededError,
  isActivationSuperseded,
  raceActivation,
  throwIfSuperseded,
} from "./activation.ts";
import { PermissionCoordinator } from "./permission-coordinator.ts";
import { ACP_PROMPT_TIMEOUT_MS, PromptScheduler } from "./prompt-scheduler.ts";
import { RendererBroadcaster } from "./renderer-broadcaster.ts";
import {
  applySessionUpdate,
  applySessionUpdateInPlace,
  applyTurnStop,
  appendLocalUserMessage,
  assemblePromptBlocks,
  createEmptySessionSlice,
  trimSessionSlice,
  type AcpSessionSlice,
} from "../src/lib/acp-session-reducer.ts";
import {
  SessionRetentionTracker,
  captureRetentionTail,
  estimateJsonBytes,
} from "../src/lib/session-retention.ts";
import {
  hydrateToolCalls,
  mergeToolCallPayload,
  payloadFromSessionUpdate,
  stripToolPayloadFromSessionUpdate,
  type ToolCallPayload,
} from "../src/lib/tool-call-payload.ts";
import type { AnalyticsEventName, AnalyticsProperties } from "./analytics-schema.ts";
import type {
  MonitorProcessDescriptor,
  MonitorSwitchPhase,
  MonitorSwitchRecord,
} from "../contracts/monitor.ts";

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

type SendToRenderer = (channel: string, payload: unknown) => void;
type EventSendToRenderer = (event: AcpBridgeEvent) => void;
type SetWindowTitle = (title: string) => void;
function jsonBytes(value: unknown): number {
  return estimateJsonBytes(value);
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

/** Constant per platform; hoisted so agent fs requests don't rebuild them. */
const READ_FILE_OPTIONS: { encoding: "utf8"; flag?: number } = NO_FOLLOW
  ? { encoding: "utf8", flag: fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW }
  : { encoding: "utf8" };

/** Constant per platform; hoisted so agent fs requests don't rebuild them. */
const WRITE_FILE_OPTIONS: { encoding: "utf8"; flag?: number } = NO_FOLLOW
  ? {
      encoding: "utf8",
      flag:
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW,
    }
  : { encoding: "utf8" };

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
  private readonly onRunningThreadsChanged?: (threadIds: string[]) => void;

  private connecting: Promise<LiveConnection> | null = null;
  private activeProjectId: string | null = null;
  private activeThreadId: string | null = null;
  private preferredAgentId: string = getDefaultAgentId();
  private readonly sessions = new ThreadSessionRegistry();
  /**
   * Session replay is delivered as session/update notifications while
   * session/load is still in flight. Keep those notifications in the main
   * process until the activation can publish one complete authoritative state.
   */
  private readonly loadingSessionThreads = new Set<string>();
  /** Resolves callers waiting to submit while a cached display restores ACP. */
  private readonly sessionReadyWaiters = new Map<
    string,
    { promise: Promise<void>; resolve: () => void }
  >();
  private readonly snapshotStore = new ThreadSnapshotStore();
  private readonly snapshotTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly snapshotWriteChains = new Map<string, Promise<void>>();
  private readonly backgroundToolCallTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private snapshotPreloadTask: ReturnType<typeof setImmediate> | null = null;
  private snapshotWritesDisabled = false;
  /** Per-session filesystem containment for agent reads/writes/terminals. */
  private readonly workspaceGuard = new WorkspaceGuard();
  private readonly permissions = new PermissionCoordinator({
    autoResponse: (params) => this.subagents.autoPermissionResponse(params),
    findThreadBySessionId: (sessionId) => this.findThreadBySessionId(sessionId),
    emit: (event) => this.emit(event),
    notifyIfHidden: (notification) => this.notifyIfHidden(notification),
    threadDisplayTitle: (threadId) => this.threadDisplayTitle(threadId),
  });
  private readonly prompts = new PromptScheduler();
  private readonly terminalManager: TerminalManager;
  private broadcaster!: RendererBroadcaster;
  private lifecycle!: ConnectionLifecycle;
  /** Client-hosted subagent tool: lets any session spawn sibling agent sessions. */
  private readonly subagents: SubagentManager;
  /** Dedup key for the last broadcast running-threads set. */
  private lastRunningThreadsKey = "";
  /** Per tool-call start timestamps for `tool_call_finished` timing, keyed `${sessionId}:${toolCallId}`. */
  private readonly toolCallStarts = new Map<string, { startedAt: number; kind?: string }>();
  private monitorObserver: AgentMonitorObserver | null = null;
  private threadActivationQueue: Promise<unknown> = Promise.resolve();
  /** Aborts the currently running (or queued) activation; nulled when it settles. */
  private activationAbort: AbortController | null = null;
  private activationGeneration = 0;
  private readonly threadActivationGenerations = new Map<string, number>();

  private currentEditorText = "";
  private turnSequence = 0;

  constructor(options: {
    sendToRenderer: SendToRenderer | EventSendToRenderer;
    setWindowTitle: SetWindowTitle;
    broadcastActiveProject?: (projectId: string) => void;
    captureAnalytics?: (name: AnalyticsEventName, properties: AnalyticsProperties) => void;
    onRunningThreadsChanged?: (threadIds: string[]) => void;
    setAgentContext?: (
      ctx: { agentId?: string | null; agentName?: string | null; modelId?: string | null } | null,
    ) => void;
    visibility?: WindowVisibilitySource;
    attention?: WindowAttentionSource;
    notify?: OsNotifier;
    /** App version for ACP `clientInfo`; defaults when unset (tests). */
    clientVersion?: string;
  }) {
    this.sendToRenderer =
      options.sendToRenderer.length <= 1
        ? (_channel, payload) =>
            (options.sendToRenderer as EventSendToRenderer)(payload as AcpBridgeEvent)
        : (options.sendToRenderer as SendToRenderer);
    this.setWindowTitle = options.setWindowTitle;
    this.broadcastActiveProject = options.broadcastActiveProject;
    this.captureAnalytics = options.captureAnalytics;
    this.onRunningThreadsChanged = options.onRunningThreadsChanged;
    this.setAgentContext = options.setAgentContext;
    this.broadcaster = new RendererBroadcaster({
      send: this.sendToRenderer,
      visibility: options.visibility,
      attention: options.attention,
      notify: options.notify,
      getActiveThreadId: () => this.activeThreadId,
      getBridgeEventObserver: () => this.monitorObserver?.onBridgeEvent,
      flushAfterHiddenPeriod: () => this.flushCoalescedStateToRenderer(),
    });
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
    this.lifecycle = new ConnectionLifecycle({
      terminal: this.terminalManager,
      clientVersion: options.clientVersion ?? "0.0.0",
      hooks: {
        onSessionUpdate: (sessionId, update) => this.handleSessionUpdate(sessionId, update),
        onRequestPermission: (params, requestId) => this.handlePermissionRequest(params, requestId),
        onReadTextFile: (params) => this.handleReadTextFile(params),
        onWriteTextFile: (params) => this.handleWriteTextFile(params),
        assertWithinWorkspace: (sessionId, targetPath) =>
          this.workspaceGuard.assertWithin(sessionId, targetPath),
      },
      getMonitorObserver: () => this.monitorObserver,
      getActiveThreadId: () => this.activeThreadId,
      getRunningThreadIds: () => this.getRunningThreadIds(),
      getSessionsByAgent: (agentId) =>
        [...this.sessions.values()]
          .filter((session) => session.agentId === agentId)
          .map((session) => ({
            threadId: session.threadId,
            agentSessionId: session.agentSessionId,
          })),
      invalidateAgentSessions: (agentId) => this.invalidateAgentSessions(agentId),
      onConnected: (agentId, connectDurationMs, installKind) =>
        this.captureAnalytics?.("agent_connected", {
          ...this.agentProps(agentId),
          connect_duration_ms: connectDurationMs,
          install_kind: installKind,
        } as AnalyticsProperties),
      onConnectFailed: (agentId, errorName) =>
        this.captureAnalytics?.("agent_connection_failed", {
          ...this.agentProps(agentId),
          error_type: errorName,
        } as AnalyticsProperties),
    });
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
    for (const live of this.lifecycle.all()) {
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
        const live = this.lifecycle.getCached(agentId);
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

  async getToolCalls(
    threadId: string,
    requestedIds?: readonly string[],
  ): Promise<Record<string, AcpToolCallState>> {
    const runtime = this.sessions.get(threadId);
    if (!runtime) return {};
    const ids = requestedIds?.length
      ? requestedIds.filter((id) => Boolean(runtime.slice.toolCalls[id]))
      : Object.keys(runtime.slice.toolCalls);
    const payloads = this.payloadsFor(runtime);
    const missingIds = ids.filter(
      (id) => runtime.slice.toolCalls[id]?.hasPayload && !payloads.has(id),
    );
    if (missingIds.length > 0 && runtime.snapshotPayloadSource) {
      try {
        const restored = await this.snapshotStore.loadPayloads(
          runtime.snapshotPayloadSource,
          missingIds,
        );
        if (this.sessions.get(threadId) === runtime) {
          for (const [id, payload] of restored) {
            if (!payloads.has(id)) payloads.set(id, payload);
          }
        }
      } catch (error) {
        console.warn(`[thread-snapshot] selective payload restore failed for ${threadId}:`, error);
        runtime.snapshotPayloadSource = undefined;
        void this.deletePersistedSnapshot(threadId);
      }
    }
    const selected = Object.fromEntries(
      ids.map((id) => [id, runtime.slice.toolCalls[id]]).filter(([, toolCall]) => toolCall),
    ) as Record<string, AcpToolCallState>;
    return hydrateToolCalls(selected, payloads);
  }

  private payloadsFor(runtime: ThreadSessionRuntime): Map<string, ToolCallPayload> {
    if (!runtime.toolPayloads) runtime.toolPayloads = new Map();
    return runtime.toolPayloads;
  }

  private beginThreadLoad(threadId: string): void {
    this.loadingSessionThreads.add(threadId);
    if (this.sessionReadyWaiters.has(threadId)) return;
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    this.sessionReadyWaiters.set(threadId, { promise, resolve });
  }

  private endThreadLoad(threadId: string): void {
    this.loadingSessionThreads.delete(threadId);
    const waiter = this.sessionReadyWaiters.get(threadId);
    this.sessionReadyWaiters.delete(threadId);
    waiter?.resolve();
  }

  private async waitForThreadReady(threadId: string): Promise<void> {
    await this.sessionReadyWaiters.get(threadId)?.promise;
    const runtime = this.sessions.get(threadId);
    if (!runtime || runtime.agentReady === false) {
      throw new Error("The agent session is not ready for this thread.");
    }
  }

  private retentionFor(runtime: ThreadSessionRuntime): SessionRetentionTracker {
    if (!runtime.retention) runtime.retention = new SessionRetentionTracker();
    return runtime.retention;
  }

  private syncPayloadsFor(
    slice: AcpSessionSlice,
    payloads: Map<string, ToolCallPayload>,
    update: SessionUpdate,
  ): void {
    const extracted = payloadFromSessionUpdate(update);
    if (extracted) {
      payloads.set(
        extracted.toolCallId,
        mergeToolCallPayload(payloads.get(extracted.toolCallId), extracted.payload),
      );
    }
    // Orphans can only appear when the reducer replaced the record with a
    // smaller one (trim). Chunk-heavy streams keep the record reference-equal,
    // so this scan runs per tool-call mutation instead of per streamed chunk.
    for (const id of payloads.keys()) {
      if (!slice.toolCalls[id]) payloads.delete(id);
    }
  }

  private syncToolPayloads(runtime: ThreadSessionRuntime, update: SessionUpdate): void {
    const previous = runtime.lastSyncedToolCalls;
    const extracted = payloadFromSessionUpdate(update);
    if (runtime.slice.toolCalls === previous && !extracted) return;
    this.syncPayloadsFor(runtime.slice, this.payloadsFor(runtime), update);
    runtime.lastSyncedToolCalls = runtime.slice.toolCalls;
    if (extracted) runtime.payloadRevision = (runtime.payloadRevision ?? 0) + 1;
  }

  private evictOrphanToolPayloads(runtime: ThreadSessionRuntime): void {
    const payloads = this.payloadsFor(runtime);
    for (const id of payloads.keys()) {
      if (!runtime.slice.toolCalls[id]) payloads.delete(id);
    }
  }

  private scheduleSnapshot(runtime: ThreadSessionRuntime): void {
    if (
      !this.snapshotStore.enabled ||
      this.snapshotWritesDisabled ||
      runtime.snapshotDirty === false
    ) {
      return;
    }
    const existing = this.snapshotTimers.get(runtime.threadId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.snapshotTimers.delete(runtime.threadId);
      void this.queueSnapshotWrite(runtime);
    }, 2_000);
    timer.unref?.();
    this.snapshotTimers.set(runtime.threadId, timer);
  }

  private queueSnapshotWrite(runtime: ThreadSessionRuntime): Promise<void> {
    if (
      !this.snapshotStore.enabled ||
      this.snapshotWritesDisabled ||
      runtime.slice.isStreaming ||
      runtime.promptInFlight ||
      this.loadingSessionThreads.has(runtime.threadId) ||
      runtime.agentReady === false
    ) {
      return Promise.resolve();
    }
    const input = {
      threadId: runtime.threadId,
      agentSessionId: runtime.agentSessionId,
      agentId: runtime.agentId,
      slice: runtime.slice,
      payloads: new Map(this.payloadsFor(runtime)),
    };
    const payloadRevision = runtime.payloadRevision ?? 0;
    const previous = this.snapshotWriteChains.get(runtime.threadId) ?? Promise.resolve();
    const write = previous
      .catch(() => undefined)
      .then(() =>
        this.snapshotStore.write({
          ...input,
          // Resolve the base generation only after the prior per-thread write
          // settles; that write may have atomically replaced and unlinked it.
          baseSnapshot: runtime.snapshotPayloadSource,
        }),
      )
      .then((snapshot) => {
        if (!snapshot || this.sessions.get(runtime.threadId) !== runtime) return;
        runtime.snapshotPayloadSource = snapshot;
        if ((runtime.payloadRevision ?? 0) === payloadRevision) {
          // The immutable sidecar is now the backing store. Keep the main
          // process lean; individual trace/diff payloads reload on demand.
          this.payloadsFor(runtime).clear();
          runtime.snapshotDirty = false;
        }
      })
      .catch((error) => {
        if (!this.snapshotWritesDisabled) {
          console.warn("[thread-snapshot] disabling writes for this app session:", error);
        }
        this.snapshotWritesDisabled = true;
      })
      .finally(() => {
        if (this.snapshotWriteChains.get(runtime.threadId) === write) {
          this.snapshotWriteChains.delete(runtime.threadId);
        }
      });
    this.snapshotWriteChains.set(runtime.threadId, write);
    return write;
  }

  private async flushRuntimeSnapshot(runtime: ThreadSessionRuntime): Promise<void> {
    const timer = this.snapshotTimers.get(runtime.threadId);
    if (timer) clearTimeout(timer);
    this.snapshotTimers.delete(runtime.threadId);
    await this.queueSnapshotWrite(runtime);
  }

  /** Force a settled snapshot to disk (used by benchmark setup and shutdown). */
  async flushThreadSnapshot(threadId: string): Promise<boolean> {
    const runtime = this.sessions.get(threadId);
    if (!runtime || runtime.agentReady === false || this.loadingSessionThreads.has(threadId)) {
      return false;
    }
    await this.flushRuntimeSnapshot(runtime);
    return !this.snapshotWritesDisabled;
  }

  private async flushAllSnapshots(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map((runtime) => this.flushRuntimeSnapshot(runtime)),
    );
    await Promise.all(this.snapshotWriteChains.values());
  }

  private async deletePersistedSnapshot(threadId: string): Promise<void> {
    const timer = this.snapshotTimers.get(threadId);
    if (timer) clearTimeout(timer);
    this.snapshotTimers.delete(threadId);
    await this.snapshotWriteChains.get(threadId)?.catch(() => undefined);
    await this.snapshotStore.delete(threadId).catch((error) => {
      console.warn(`[thread-snapshot] delete failed for ${threadId}:`, error);
    });
  }

  private settleRuntime(runtime: ThreadSessionRuntime): void {
    runtime.slice = applyTurnStop(runtime.slice);
    this.flushBackgroundToolCalls(runtime);
    this.scheduleSnapshot(runtime);
  }

  private scheduleBackgroundToolCalls(runtime: ThreadSessionRuntime): void {
    runtime.backgroundToolCallsDirty = true;
    if (this.backgroundToolCallTimers.has(runtime.threadId)) return;
    const timer = setTimeout(() => {
      this.backgroundToolCallTimers.delete(runtime.threadId);
      this.flushBackgroundToolCalls(runtime);
    }, 100);
    timer.unref?.();
    this.backgroundToolCallTimers.set(runtime.threadId, timer);
  }

  private flushBackgroundToolCalls(runtime: ThreadSessionRuntime): void {
    const timer = this.backgroundToolCallTimers.get(runtime.threadId);
    if (timer) clearTimeout(timer);
    this.backgroundToolCallTimers.delete(runtime.threadId);
    if (!runtime.backgroundToolCallsDirty || this.sessions.get(runtime.threadId) !== runtime) {
      return;
    }
    runtime.backgroundToolCallsDirty = false;
    runtime.emittedToolCalls = runtime.slice.toolCalls;
    this.emit({
      type: "thread-tool-calls",
      threadId: runtime.threadId,
      toolCalls: runtime.slice.toolCalls,
    });
  }

  private async yieldAfterBackgroundWork(
    runtime: ThreadSessionRuntime,
    loading: boolean,
  ): Promise<void> {
    if (!loading && runtime.threadId === this.activeThreadId) return;
    const now = performance.now();
    runtime.backgroundWorkStartedAt ??= now;
    runtime.backgroundUpdatesSinceYield = (runtime.backgroundUpdatesSinceYield ?? 0) + 1;
    if (runtime.backgroundUpdatesSinceYield < 32 && now - runtime.backgroundWorkStartedAt < 4) {
      return;
    }
    runtime.backgroundUpdatesSinceYield = 0;
    runtime.backgroundWorkStartedAt = performance.now();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  private scheduleAdjacentSnapshotPreload(activeThread: Thread): void {
    if (!this.snapshotStore.enabled) return;
    if (this.snapshotPreloadTask) clearImmediate(this.snapshotPreloadTask);
    const candidates = listThreads()
      .filter(
        (thread) =>
          thread.id !== activeThread.id &&
          thread.project_id === activeThread.project_id &&
          (thread.worktree_path ?? null) === (activeThread.worktree_path ?? null) &&
          !this.sessions.has(thread.id),
      )
      .slice(0, 2);
    if (candidates.length === 0) return;
    this.snapshotPreloadTask = setImmediate(() => {
      this.snapshotPreloadTask = null;
      try {
        this.snapshotStore.preload(candidates);
      } catch (error) {
        console.warn("[thread-snapshot] adjacent preload failed:", error);
      }
    });
  }

  private mergePendingLocalEntries(
    runtime: ThreadSessionRuntime,
    slice: AcpSessionSlice,
  ): AcpSessionSlice {
    const pending = runtime.pendingLocalEntries ?? [];
    runtime.pendingLocalEntries = [];
    if (pending.length === 0) return applyTurnStop(slice);
    const settled = applyTurnStop(slice);
    return trimSessionSlice({
      ...settled,
      entries: [...settled.entries, ...pending],
      isStreaming: true,
    });
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

  /** Bridge-event output goes through RendererBroadcaster (see that module). */
  private emit(payload: AcpBridgeEvent): void {
    this.broadcaster.emit(payload);
  }

  /**
   * Catch the renderer up after a hidden period without replaying the delta
   * storm: one authoritative session-state for the displayed thread, plus any
   * tool-call records that drifted from their emission watermark (the same
   * reference-equality guard handleSessionUpdate uses per update).
   */
  private flushCoalescedStateToRenderer(): void {
    this.pushState(this.activeThreadId);
    for (const runtime of this.sessions.values()) {
      if (!this.sessions.has(runtime.threadId)) continue;
      if (runtime.slice.toolCalls === runtime.emittedToolCalls) continue;
      runtime.emittedToolCalls = runtime.slice.toolCalls;
      this.emit({
        type: "thread-tool-calls",
        threadId: runtime.threadId,
        toolCalls: runtime.slice.toolCalls,
      });
    }
  }

  private threadDisplayTitle(threadId: string | null | undefined): string | null {
    if (!threadId) return null;
    const runtime = this.sessions.get(threadId);
    if (runtime?.slice.title) return runtime.slice.title;
    return getThread(threadId)?.title ?? null;
  }

  private notifyIfHidden(notification: AgentOsNotification): void {
    this.broadcaster.notifyIfHidden(notification);
  }

  getState(): AcpSessionState {
    const threadId = this.activeThreadId;
    if (!threadId) {
      return {
        ...emptySessionState(),
        projectId: this.activeProjectId,
        agentId: this.lifecycle.active?.agentId ?? this.preferredAgentId,
        authRequiredMessage: this.authMessage(),
      };
    }
    return this.buildSessionState(threadId);
  }

  isThreadLoading(threadId: string): boolean {
    return this.loadingSessionThreads.has(threadId);
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
    return this.lifecycle.active?.authRequiredMessage ?? null;
  }

  private buildSessionState(threadId: string): AcpSessionState {
    const runtime = this.sessions.get(threadId);
    const thread = getThread(threadId);
    if (!runtime) {
      return {
        ...emptySessionState(),
        projectId: thread?.project_id ?? this.activeProjectId,
        threadId,
        agentId: thread?.agent_id ?? this.lifecycle.active?.agentId ?? null,
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
    // Activation publishes one session-state. That snapshot already includes
    // toolCalls and the renderer copies them into threadToolCalls. Live
    // background watermarks still go through handleSessionUpdate's
    // thread-tool-calls event.
    if (!id) {
      this.emit({ type: "session-state", state: this.getState() });
    } else {
      this.emit({ type: "session-state", state: this.buildSessionState(id) });
      // The snapshot carries toolCalls and the renderer adopts them, so the
      // per-update thread-tool-calls guard can treat them as already sent.
      const runtime = this.sessions.get(id);
      if (runtime) runtime.emittedToolCalls = runtime.slice.toolCalls;
    }
    this.emitRunningThreads();
  }

  setMonitorObserver(observer: AgentMonitorObserver | null): void {
    this.monitorObserver = observer;
  }

  getMonitorProcessDescriptors(): MonitorProcessDescriptor[] {
    const running = new Set(this.getRunningThreadIds());
    const entries: MonitorProcessDescriptor[] = [];

    for (const live of this.lifecycle.all()) {
      const agentId = live.agentId;
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
    for (const [threadId, runtime] of this.sessions.entries()) {
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
    this.onRunningThreadsChanged?.(running);
    this.emit({ type: "running-threads", threadIds: running });
  }

  async ensureConnection(agentId?: string): Promise<LiveConnection> {
    const targetId = agentId ?? this.preferredAgentId;
    const active = this.lifecycle.active;
    if (active && active.agentId === targetId) {
      return active;
    }
    const cached = this.lifecycle.getCached(targetId);
    if (cached) {
      this.lifecycle.setActive(cached);
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
    // Spawn dedup + registration + connect analytics live in ConnectionLifecycle.
    return this.lifecycle.acquire(descriptor);
  }

  async switchAgent(agentId: string): Promise<LiveConnection> {
    this.emit({
      type: "session-state",
      state: { ...this.getState(), switchingAgent: true },
    });

    const previousAgentId = this.lifecycle.active?.agentId ?? null;
    const live = await this.acquireConnection(agentId);
    this.lifecycle.setActive(live);
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

  private async closeConnection(): Promise<void> {
    this.lifecycle.setActive(null);
    this.permissions.cancelAll();
    this.prompts.abortAll();
    this.toolCallStarts.clear();
    for (const [threadId, runtime] of this.sessions.entries()) {
      this.endThreadLoad(threadId);
      this.monitorObserver?.onSessionCacheEvent?.({
        timestamp: Date.now(),
        action: "clear_all",
        threadId,
        agentSessionId: runtime.agentSessionId,
        agentId: runtime.agentId,
        trigger: "app_shutdown",
        cachedSessionCount: 0,
        openTabCount: 0,
        cachedThreadIds: [],
        reason: "Connection closed / app shutdown",
      });
    }
    this.sessions.clear();
    this.workspaceGuard.clear();
    this.terminalManager.killAll();
    await this.lifecycle.terminateAll();
  }

  private invalidateAgentSessions(agentId: string): void {
    let activeInvalidated = false;
    for (const [threadId, runtime] of this.sessions.entries()) {
      if (runtime.agentId === agentId) {
        activeInvalidated ||= this.activeThreadId === threadId;
        this.permissions.cancelForSession(runtime.agentSessionId);
        this.prompts.cancelInFlight(threadId, "agent connection closed");
        this.prompts.rejectQueued(threadId, "agent connection closed");
        this.clearToolCallTiming(runtime.agentSessionId);
        this.terminalManager.releaseSession(runtime.agentSessionId);
        this.subagents.releaseSessionMcp(runtime.agentSessionId);
        this.releaseWorkspaceRoot(runtime.agentSessionId);
        this.endThreadLoad(threadId);
        this.sessions.remove(threadId);
        this.monitorObserver?.onSessionCacheEvent?.({
          timestamp: Date.now(),
          action: "invalidate_agent",
          threadId,
          agentSessionId: runtime.agentSessionId,
          agentId,
          trigger: "process_exit",
          cachedSessionCount: this.sessions.size,
          openTabCount: 0,
          cachedThreadIds: [...this.sessions.keys()],
          reason: `Agent ${agentId} connection closed / process exited`,
        });
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
    return this.sessions.threadIdForSession(sessionId);
  }

  private connectionForAgent(agentId: string): LiveConnection | null {
    return this.lifecycle.connectionFor(agentId);
  }

  private async handleSessionUpdate(sessionId: string, update: SessionUpdate): Promise<void> {
    const startedAt = performance.now();
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

    // Running-threads emission depends solely on per-runtime isStreaming
    // flags, and this handler mutates exactly one runtime's slice — so emit
    // only when THIS runtime's flag flipped, not on every streamed chunk.
    const wasStreaming = runtime.slice.isStreaming;
    const loading = this.loadingSessionThreads.has(runtime.threadId);
    const replayingSnapshot = loading && runtime.replaySlice != null;
    const targetSlice = replayingSnapshot ? runtime.replaySlice! : runtime.slice;
    const updateToolCallId =
      update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update"
        ? update.toolCallId
        : null;
    const payloadAlreadyPersisted = Boolean(
      replayingSnapshot &&
      updateToolCallId &&
      runtime.snapshotPayloadSource?.slice.toolCalls[updateToolCallId],
    );
    const targetPayloads = replayingSnapshot
      ? payloadAlreadyPersisted
        ? null
        : (runtime.replayToolPayloads ??= new Map())
      : this.payloadsFor(runtime);
    // Capture the observer method once: the null/undefined check must survive
    // to the call below, and `this.monitorObserver` alone doesn't narrow.
    const acpObserver = this.monitorObserver?.onAcpUpdate;
    if (!acpObserver) {
      if (loading) {
        applySessionUpdateInPlace(targetSlice, update);
        if (targetPayloads) this.syncPayloadsFor(targetSlice, targetPayloads, update);
      } else {
        runtime.slice = applySessionUpdate(runtime.slice, update);
        this.syncToolPayloads(runtime, update);
      }
    } else {
      runtime.monitorUpdateCount += 1;
      const sampledRetention =
        runtime.monitorUpdateCount % 10 === 0 || update.sessionUpdate.startsWith("tool_");
      const tracker = this.retentionFor(runtime);
      let retained;
      if (loading) {
        const before = sampledRetention ? captureRetentionTail(targetSlice) : null;
        applySessionUpdateInPlace(targetSlice, update);
        if (targetPayloads) this.syncPayloadsFor(targetSlice, targetPayloads, update);
        retained = before
          ? tracker.observeAfterMutation(before, targetSlice, update)
          : {
              entryCount: targetSlice.entries.length,
              toolCallCount: tracker.snapshot(targetSlice).toolCallCount,
              textBytes: 0,
              thoughtBytes: 0,
              toolPayloadBytes: 0,
              largestToolPayloadBytes: 0,
              sessionSnapshotBytes: 0,
            };
      } else {
        const previousSlice = runtime.slice;
        runtime.slice = applySessionUpdate(runtime.slice, update);
        this.syncToolPayloads(runtime, update);
        retained = sampledRetention
          ? tracker.observe(previousSlice, runtime.slice, update)
          : {
              entryCount: runtime.slice.entries.length,
              toolCallCount: Object.keys(runtime.slice.toolCalls).length,
              textBytes: 0,
              thoughtBytes: 0,
              toolPayloadBytes: 0,
              largestToolPayloadBytes: 0,
              sessionSnapshotBytes: 0,
            };
      }
      acpObserver({
        timestamp: Date.now(),
        agentId: runtime.agentId,
        connectionId: this.connectionForAgent(runtime.agentId)?.connectionId ?? null,
        sessionId,
        threadId: runtime.threadId,
        threadRole: runtime.threadId === this.activeThreadId ? "active" : "background",
        turnId: runtime.activeTurnId,
        updateType: update.sessionUpdate,
        updateBytes: jsonBytes(update),
        handlerDurationMs: performance.now() - startedAt,
        isStreaming: targetSlice.isStreaming,
        ...retained,
      });
    }
    if (loading) {
      if (!replayingSnapshot || (updateToolCallId != null && !payloadAlreadyPersisted)) {
        runtime.snapshotDirty = true;
        if (payloadFromSessionUpdate(update)) {
          runtime.payloadRevision = (runtime.payloadRevision ?? 0) + 1;
        }
      }
      await this.yieldAfterBackgroundWork(runtime, true);
      return;
    }
    runtime.snapshotDirty = true;
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
    // A background thread's streaming can flip via updates without a pushState; keep
    // tabs in sync — but only signal an actual streaming transition.
    if (wasStreaming !== runtime.slice.isStreaming) {
      if (runtime.threadId !== this.activeThreadId && !runtime.slice.isStreaming) {
        this.flushBackgroundToolCalls(runtime);
      }
      this.emitRunningThreads();
    }

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
      update: stripToolPayloadFromSessionUpdate(update),
    };

    const isActiveThread = runtime.threadId === this.activeThreadId;
    // The renderer discards background session-update deltas. Do not pay IPC,
    // structured-clone, and store-dispatch cost for events it cannot use.
    if (isActiveThread) this.emit(event);
    // Message-chunk updates leave the tool-call record untouched; only
    // re-broadcast the full record when the reducer actually replaced it.
    // Resending it per chunk made live streaming O(total tool payload) per
    // update across IPC, structured clone, and renderer store spreads.
    if (runtime.slice.toolCalls !== runtime.emittedToolCalls) {
      if (isActiveThread) {
        runtime.emittedToolCalls = runtime.slice.toolCalls;
        const changedToolCall = updateToolCallId
          ? runtime.slice.toolCalls[updateToolCallId]
          : undefined;
        this.emit({
          type: "thread-tool-calls",
          threadId: runtime.threadId,
          toolCalls: changedToolCall
            ? { [updateToolCallId]: changedToolCall }
            : runtime.slice.toolCalls,
          replace: !changedToolCall,
        });
      } else {
        this.scheduleBackgroundToolCalls(runtime);
      }
    }
    // The renderer applies the same pure reducer to session-update. Sending a
    // full session-state snapshot for every chunk needlessly rebuilds the panel
    // projection and forces all snapshot subscribers to render again. The next
    // turn stop and activation still publish an authoritative snapshot.
    if (!runtime.promptInFlight && runtime.threadId === this.activeThreadId) {
      this.pushState(runtime.threadId);
    }
    await this.yieldAfterBackgroundWork(runtime, false);
  }

  private handlePermissionRequest(
    params: acp.RequestPermissionRequest,
    requestId?: string | number | null,
  ): Promise<acp.RequestPermissionResponse> {
    return this.permissions.handle(params, requestId ?? null);
  }

  respondToPermission(response: {
    sessionId: string;
    requestId?: string | number;
    optionId?: string;
    cancelled?: boolean;
  }): Promise<void> {
    return this.permissions.respond(response);
  }

  /**
   * Kept as the single seam for prompt dispatch so tests can stub it; the
   * queue/cancel/timeout mechanics live in PromptScheduler.
   */
  private requestPrompt(
    live: LiveConnection,
    runtime: ThreadSessionRuntime,
    blocks: ContentBlock[],
    streamingBehavior?: "followUp" | "steer",
  ): Promise<any> {
    return this.prompts.send(
      live.agent,
      { threadId: runtime.threadId, agentSessionId: runtime.agentSessionId },
      blocks,
      streamingBehavior,
    );
  }

  private drainPromptQueue(runtime: ThreadSessionRuntime, live: LiveConnection): void {
    if (runtime.promptInFlight) return;
    const prompt = this.prompts.dequeue(runtime.threadId);
    if (!prompt) return;

    runtime.promptInFlight = true;
    const turnStartedAt = Date.now();
    runtime.activeTurnId = `${runtime.threadId}:${turnStartedAt}:${++this.turnSequence}`;
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
        this.settleRuntime(runtime);
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
        // The user walked away: surface the settled turn at the OS level.
        this.notifyIfHidden({
          kind: "turn-completed",
          threadTitle: this.threadDisplayTitle(runtime.threadId),
          detail:
            result.stopReason && result.stopReason !== "end_turn"
              ? `stopped: ${result.stopReason}`
              : undefined,
        });
        prompt.resolve(result);
      })
      .catch((error) => {
        this.settleRuntime(runtime);
        this.captureAnalytics?.("turn_failed", {
          ...agentProps,
          thread_id: runtime.threadId,
          turn_duration_ms: Date.now() - turnStartedAt,
          error_type: error instanceof Error ? error.name : undefined,
        });
        if (error instanceof Error && /timed out/i.test(error.message)) {
          this.captureAnalytics?.("prompt_timeout", {
            ...agentProps,
            project_id: runtime.projectId,
            thread_id: runtime.threadId,
            turn_duration_ms: Date.now() - turnStartedAt,
            error_type: "session_prompt_timeout",
          });
        }
        // If ACP timed out or was cancelled, its underlying request may still
        // be alive. Do not start another prompt against the same session.
        if (error instanceof Error && /timed out|cancelled/i.test(error.message)) {
          this.prompts.rejectQueued(runtime.threadId, error.message);
        }
        this.notifyIfHidden({
          kind: "turn-failed",
          threadTitle: this.threadDisplayTitle(runtime.threadId),
          detail: error instanceof Error ? error.message.slice(0, 140) : undefined,
        });
        prompt.reject(error);
      })
      .finally(() => {
        runtime.promptInFlight = false;
        runtime.activeTurnId = null;
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
    this.workspaceGuard.assertWithin(params.sessionId, params.path);
    const content = await readFile(params.path, READ_FILE_OPTIONS);
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
    this.workspaceGuard.assertWithin(params.sessionId, params.path);
    await mkdir(dirname(params.path), { recursive: true });
    await writeFile(params.path, params.content, WRITE_FILE_OPTIONS);
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
        let choices = (opt as { options?: Record<string, unknown>[] }).options;
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
    this.workspaceGuard.register(agentSessionId, cwd);
  }

  private releaseWorkspaceRoot(agentSessionId: string | null | undefined): void {
    this.workspaceGuard.release(agentSessionId);
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

  private enqueueThreadActivation<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    // A newly requested activation supersedes the slow prepare running ahead
    // of it: cancellable operations (switch/restore) abandon their in-flight
    // session phases instead of making every later request wait out full phase
    // timeouts. Durable operations (create/delete/close) receive the signal
    // but deliberately ignore it — their effect must complete.
    this.activationAbort?.abort(new ActivationSupersededError());
    const controller = new AbortController();
    this.activationAbort = controller;
    const result = this.threadActivationQueue.then(
      () => task(controller.signal),
      () => task(controller.signal),
    );
    this.threadActivationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    void result
      .catch(() => {
        // Rejection is the caller's concern; this chain only clears the abort handle.
      })
      .finally(() => {
        if (this.activationAbort === controller) this.activationAbort = null;
      });
    return result;
  }

  async activateProject(projectId: string, preferredThreadId?: string | null): Promise<void> {
    return this.enqueueThreadActivation((signal) =>
      this.activateProjectInternal(projectId, preferredThreadId, signal),
    );
  }

  private async activateProjectInternal(
    projectId: string,
    preferredThreadId?: string | null,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfSuperseded(signal);
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
    await this.switchThreadInternal(thread.id, "restore", signal);

    await updateLaunchSelection({ projectId, threadId: thread.id });
  }

  async switchThread(threadId: string): Promise<OpenTabsState> {
    return this.enqueueThreadActivation((signal) =>
      this.switchThreadInternal(threadId, "tab", signal),
    );
  }

  private async switchThreadInternal(
    threadId: string,
    source: MonitorSwitchRecord["source"] = "tab",
    signal?: AbortSignal,
  ): Promise<OpenTabsState> {
    throwIfSuperseded(signal);
    const startedAt = Date.now();
    const previousThreadId = this.activeThreadId;
    const wasResidentInMemory = this.sessions.has(threadId);
    const cachedSessionCount = this.sessions.size;
    const agentIdBefore = this.lifecycle.active?.agentId ?? null;
    const workspaceCwdBefore = this.getActiveCwd();
    let phase: MonitorSwitchPhase = wasResidentInMemory ? "cache_hit" : "session_load";
    let openTabCount = 0;
    const record = (success: boolean, error?: string) => {
      const thread = getThread(threadId);
      const agentIdTarget = thread?.agent_id ?? null;
      const workspaceCwdTarget = this.getActiveCwd();
      this.monitorObserver?.onSwitchRecord?.({
        timestamp: Date.now(),
        threadId,
        agentId: this.lifecycle.active?.agentId ?? null,
        projectId: this.activeProjectId,
        source,
        phase,
        durationMs: Date.now() - startedAt,
        success,
        error,
        openTabCount,
        previousThreadId,
        cachedSessionCount,
        wasResidentInMemory,
        agentIdBefore,
        agentIdTarget,
        agentSwitched:
          agentIdBefore !== null && agentIdTarget !== null && agentIdBefore !== agentIdTarget,
        workspaceCwdBefore,
        workspaceCwdTarget,
        workspaceCwdChanged:
          workspaceCwdBefore !== null &&
          workspaceCwdTarget !== null &&
          workspaceCwdBefore !== workspaceCwdTarget,
      });
    };
    try {
      const state = await this.switchThreadCore(
        threadId,
        (nextPhase) => {
          phase = nextPhase;
        },
        signal,
      );
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
    signal?: AbortSignal,
  ): Promise<OpenTabsState> {
    const restoreStartedAt = performance.now();
    let openAnalyticsCaptured = false;
    const thread = getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    const project = getProject(thread.project_id);
    if (!project) throw new Error(`Project not found: ${thread.project_id}`);

    // Bind the session to its worktree (validated), else the project root.
    const cwd = this.resolveThreadCwd(thread.worktree_path, project.path);
    const projectChanged = this.activeProjectId !== project.id;
    this.activeProjectId = project.id;
    this.activeThreadId = threadId;
    setActiveProjectId(project.id);
    if (projectChanged) this.broadcastActiveProject?.(project.id);

    const generation = ++this.activationGeneration;
    this.threadActivationGenerations.set(threadId, generation);
    let runtime = this.sessions.get(threadId);
    const runtimeWasResident = runtime?.agentReady !== false && runtime != null;
    let restoredSnapshot: LoadedThreadSnapshot | null = null;

    // The display cache is intentionally restored before spawning or switching
    // an agent. Reading a thread must never wait for a CLI handshake.
    if (!runtime) {
      try {
        restoredSnapshot = this.snapshotStore.load(thread);
      } catch (error) {
        console.warn(`[thread-snapshot] restore failed for ${threadId}:`, error);
      }
      if (restoredSnapshot) {
        onPhase("snapshot_restore");
        runtime = {
          threadId,
          agentSessionId: thread.agent_session_id,
          agentId: thread.agent_id,
          projectId: project.id,
          cwd,
          slice: restoredSnapshot.slice,
          editorText: "",
          promptInFlight: false,
          activeTurnId: null,
          monitorUpdateCount: 0,
          toolPayloads: new Map(),
          retention: new SessionRetentionTracker(),
          emittedToolCalls: null,
          agentReady: false,
          snapshotRestored: true,
          replaySlice: createEmptySessionSlice(),
          replayToolPayloads: new Map(),
          pendingLocalEntries: [],
          payloadsReady: true,
          snapshotPayloadSource: restoredSnapshot,
          snapshotDirty: false,
          payloadRevision: 0,
        };
        this.sessions.register(runtime);
        this.beginThreadLoad(threadId);
        this.monitorObserver?.onSessionCacheEvent?.({
          timestamp: Date.now(),
          action: "insert",
          threadId,
          agentSessionId: thread.agent_session_id,
          agentId: thread.agent_id,
          trigger: "switch_snapshot",
          cachedSessionCount: this.sessions.size,
          openTabCount: 0,
          cachedThreadIds: [...this.sessions.keys()],
        });
        this.pushState(threadId);
        this.captureAnalytics?.("thread_opened", {
          project_id: project.id,
          thread_id: threadId,
          agent_id: thread.agent_id,
          thread_open_source: "snapshot",
          restore_duration_ms: performance.now() - restoreStartedAt,
        });
        openAnalyticsCaptured = true;
        this.scheduleAdjacentSnapshotPreload(thread);
      }
    }

    // Agent restoration is the non-paint-critical phase. Cold spawns can take
    // seconds, but a snapshot-restored timeline above is already interactive.
    try {
      if (thread.agent_id && thread.agent_id !== this.lifecycle.active?.agentId) {
        try {
          await raceActivation(this.switchAgent(thread.agent_id), signal);
        } catch (err) {
          if (isActivationSuperseded(err)) throw err;
          await raceActivation(this.ensureConnection(this.preferredAgentId), signal);
        }
      } else {
        await raceActivation(
          this.ensureConnection(thread.agent_id || this.preferredAgentId),
          signal,
        );
      }
    } catch (error) {
      if (runtime?.agentReady === false) {
        this.sessions.remove(threadId);
        this.endThreadLoad(threadId);
      }
      throw error;
    }

    const live = this.lifecycle.active!;
    this.publishActiveAgentContext(live.agentId);

    // Close previous session optionally — skip for rapid switches; load new
    if (!runtime || runtime.agentReady === false) {
      if (!restoredSnapshot) onPhase("session_load");
      // Register the runtime BEFORE awaiting session/load: agents stream the
      // conversation replay as session/update notifications while the load
      // request is still in flight, and handleSessionUpdate can only route
      // them into this slice if the sessionId is already known here. Without
      // this, a reloaded thread renders with an empty timeline.
      if (!runtime) {
        runtime = {
          threadId,
          agentSessionId: thread.agent_session_id,
          agentId: live.agentId,
          projectId: project.id,
          cwd,
          slice: createEmptySessionSlice(),
          editorText: "",
          promptInFlight: false,
          activeTurnId: null,
          monitorUpdateCount: 0,
          toolPayloads: new Map(),
          retention: new SessionRetentionTracker(),
          emittedToolCalls: null,
          agentReady: false,
          snapshotRestored: false,
          payloadsReady: true,
          snapshotDirty: true,
          payloadRevision: 0,
        };
        this.sessions.register(runtime);
        this.beginThreadLoad(threadId);
        this.monitorObserver?.onSessionCacheEvent?.({
          timestamp: Date.now(),
          action: "insert",
          threadId,
          agentSessionId: thread.agent_session_id,
          agentId: live.agentId,
          trigger: "switch_load",
          cachedSessionCount: this.sessions.size,
          openTabCount: 0,
          cachedThreadIds: [...this.sessions.keys()],
        });
      } else if (!this.loadingSessionThreads.has(threadId)) {
        runtime.replaySlice = createEmptySessionSlice();
        runtime.replayToolPayloads = new Map();
        this.beginThreadLoad(threadId);
      }

      try {
        let sessionId = thread.agent_session_id;
        let configOptions: SessionConfigOption[] = [];
        try {
          const loaded = await raceActivation(this.sessionLoad(live, cwd, sessionId), signal);
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
          // Same rule when superseded: nobody is waiting on this thread, so
          // abandon instead of establishing sessions behind the newer request.
          if (isActivationSuperseded(err)) throw err;
          // Agent restarted — try resume. A failed load may have streamed a
          // partial replay before erroring; drop it so the fallback path
          // doesn't append onto half a timeline.
          runtime.slice = createEmptySessionSlice();
          runtime.snapshotRestored = false;
          runtime.snapshotPayloadSource = undefined;
          runtime.snapshotDirty = true;
          runtime.replaySlice = undefined;
          runtime.replayToolPayloads = undefined;
          this.retentionFor(runtime).reset();
          this.payloadsFor(runtime).clear();
          if (runtime.threadId === this.activeThreadId) this.pushState(runtime.threadId);
          try {
            const resumed = await raceActivation(
              this.sessionResume(live, thread.agent_session_id, cwd),
              signal,
            );
            onPhase("session_resume");
            sessionId = resumed.sessionId;
            configOptions = resumed.configOptions;
            updateThreadAgentSessionId(threadId, sessionId);
          } catch (err) {
            if (isActivationSuperseded(err)) throw err;
            const created = await raceActivation(this.sessionNew(live, cwd), signal);
            onPhase("session_new");
            sessionId = created.sessionId;
            configOptions = created.configOptions;
            updateThreadAgentSessionId(threadId, sessionId);
          }
        }

        // Merge instead of replacing the slice: the replay already populated
        // entries/toolCalls, only the session identity and config are new.
        // Rebind also updates the session-id index so streaming keeps routing
        // here under the session's NEW id.
        this.sessions.rebindSession(threadId, sessionId);
        this.registerWorkspaceRoot(sessionId, cwd);
        if (runtime.replaySlice) {
          runtime.slice = this.mergePendingLocalEntries(runtime, runtime.replaySlice);
          for (const [id, payload] of runtime.replayToolPayloads ?? []) {
            this.payloadsFor(runtime).set(id, payload);
          }
          runtime.replaySlice = undefined;
          runtime.replayToolPayloads = undefined;
          runtime.snapshotRestored = false;
          runtime.payloadsReady = true;
        } else {
          // Resume/new fallback may also have accumulated a prompt locally
          // while the agent was reconnecting. Preserve it across the swap.
          runtime.slice = this.mergePendingLocalEntries(runtime, runtime.slice);
        }
        if (configOptions.length > 0 || runtime.slice.configOptions.length === 0) {
          runtime.slice = { ...runtime.slice, configOptions };
        }
        // A session/load replay describes settled history, not a live turn.
        // Individual chunks set isStreaming while they are reduced; clear it
        // once the load request has delivered the complete replay. Trim was
        // deferred during replay so the cap still applies exactly once here.
        this.evictOrphanToolPayloads(runtime);
        this.retentionFor(runtime).recompute(runtime.slice);
        runtime.agentReady = true;
        if (!runtime.slice.isStreaming) this.scheduleSnapshot(runtime);
      } catch (err) {
        // No session could be established — remove the placeholder so a
        // retry doesn't silently reuse a dead runtime.
        this.sessions.remove(threadId);
        this.monitorObserver?.onSessionCacheEvent?.({
          timestamp: Date.now(),
          action: "evict",
          threadId,
          agentSessionId: runtime.agentSessionId,
          agentId: runtime.agentId,
          trigger: "switch_load",
          cachedSessionCount: this.sessions.size,
          openTabCount: 0,
          cachedThreadIds: [...this.sessions.keys()],
          reason: "Session establishment failed",
        });
        this.threadActivationGenerations.delete(threadId);
        throw err;
      } finally {
        this.endThreadLoad(threadId);
      }
    }

    touchThread(threadId);
    // Publish BEFORE persisting: the renderer paints the switched view without
    // waiting on disk. Durability is unchanged — the writes still run (and are
    // awaited before this returns), they stay serialized in the launch-state /
    // open-tabs queues, and FIFO order across activations preserves the
    // single-writer selection invariant.
    this.pushState(threadId);
    this.scheduleAdjacentSnapshotPreload(thread);
    if (!openAnalyticsCaptured) {
      this.captureAnalytics?.("thread_opened", {
        project_id: project.id,
        thread_id: threadId,
        agent_id: runtime.agentId,
        thread_open_source: runtimeWasResident ? "resident" : "replay",
        restore_duration_ms: performance.now() - restoreStartedAt,
      });
    }
    // Every thread activation reconciles the persisted workspace to the
    // session's actual cwd — the main process is the single writer for the
    // canonical selection, and the renderer only mirrors it. This keeps
    // header, tab scoping, and terminals coherent for tab clicks, close
    // fallbacks, and orchestration switches alike.
    const selectionsSettled = Promise.all([
      updateWorkspaceSelection(project.id, cwd),
      updateLaunchSelection({ projectId: project.id, threadId }),
    ]);
    // Return the state produced by the same queued mutation. Callers that need
    // to broadcast the tab state can use this result without performing a
    // second read-modify-write for the same switch.
    const openTabsState = await recordThreadSwitch(threadId);
    await selectionsSettled;
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

    this.sessions.register({
      threadId: thread.id,
      agentSessionId: created.sessionId,
      agentId: live.agentId,
      projectId,
      cwd,
      slice: createEmptySessionSlice({ configOptions: created.configOptions }),
      editorText: "",
      promptInFlight: false,
      activeTurnId: null,
      monitorUpdateCount: 0,
      toolPayloads: new Map(),
      retention: new SessionRetentionTracker(),
      emittedToolCalls: null,
      agentReady: true,
      snapshotRestored: false,
      payloadsReady: true,
    });
    this.monitorObserver?.onSessionCacheEvent?.({
      timestamp: Date.now(),
      action: "insert",
      threadId: thread.id,
      agentSessionId: created.sessionId,
      agentId: live.agentId,
      trigger: "thread_created",
      cachedSessionCount: this.sessions.size,
      openTabCount: 0,
      cachedThreadIds: [...this.sessions.keys()],
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

    this.captureAnalytics?.("thread_created", {
      project_id: projectId,
      thread_id: thread.id,
      agent_id: live.agentId,
      agent_name: getAgentDescriptor(live.agentId)?.name,
      is_main: boundWorktree === null,
    } as AnalyticsProperties);

    // Same publish-before-persist ordering as switches: the new thread's view
    // renders immediately while the durable selections settle below.
    this.pushState(thread.id);
    const selectionsSettled = Promise.all([
      updateWorkspaceSelection(projectId, cwd),
      updateLaunchSelection({ projectId, threadId: thread.id }),
    ]);
    await selectionsSettled;

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
    this.permissions.cancelForSession(sessionId);
    this.prompts.cancelInFlight(threadId, "thread deleted");
    this.prompts.rejectQueued(threadId, "thread deleted");
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
    this.endThreadLoad(threadId);
    await this.deletePersistedSnapshot(threadId);
    this.sessions.remove(threadId);
    this.monitorObserver?.onSessionCacheEvent?.({
      timestamp: Date.now(),
      action: "evict",
      threadId,
      agentSessionId: sessionId,
      agentId: runtime?.agentId ?? thread.agent_id,
      trigger: "tab_closed",
      cachedSessionCount: this.sessions.size,
      openTabCount: 0,
      cachedThreadIds: [...this.sessions.keys()],
      reason: "Thread deleted",
    });
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
    this.permissions.cancelForSession(runtime.agentSessionId);
    this.prompts.cancelInFlight(threadId, "thread session closed");
    this.prompts.rejectQueued(threadId, "thread session closed");
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
    await this.flushRuntimeSnapshot(runtime);
    this.endThreadLoad(threadId);
    this.sessions.remove(threadId);
    this.monitorObserver?.onSessionCacheEvent?.({
      timestamp: Date.now(),
      action: "close_session",
      threadId,
      agentSessionId: runtime.agentSessionId,
      agentId: runtime.agentId,
      trigger: "tab_closed",
      cachedSessionCount: this.sessions.size,
      openTabCount: 0,
      cachedThreadIds: [...this.sessions.keys()],
      reason: "Tab session closed",
    });
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
      try {
        await this.switchThread(threadId);
      } catch (err) {
        // Our prepare lost a supersede race with a newer activation. The
        // winner has finished by now, so one retry runs unqueued and fast.
        if (!isActivationSuperseded(err)) throw err;
        await this.switchThread(threadId);
      }
    }
    let runtime = this.sessions.get(threadId);
    if (!runtime) throw new Error("No session for thread");
    let appendedWhileLoading = false;
    if (runtime.agentReady === false || this.loadingSessionThreads.has(threadId)) {
      if (appendUserMessage && (input.message || input.images?.length)) {
        const nextSlice = appendLocalUserMessage(
          runtime.slice,
          input.message ?? "",
          undefined,
          input.images,
        );
        const localEntry = nextSlice.entries.at(-1);
        runtime.slice = nextSlice;
        if (localEntry) (runtime.pendingLocalEntries ??= []).push(localEntry);
        appendedWhileLoading = true;
        this.pushState(threadId);
      }
      await this.waitForThreadReady(threadId);
      runtime = this.sessions.get(threadId);
      if (!runtime) throw new Error("No session for thread");
    }
    const live = this.connectionForAgent(runtime.agentId);
    if (!live || runtime.agentReady === false) throw new Error("No ready agent session for thread");

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

    if (!appendedWhileLoading && appendUserMessage && (input.message || input.images?.length)) {
      runtime.slice = appendLocalUserMessage(
        runtime.slice,
        input.message ?? "",
        undefined,
        input.images,
      );
      this.pushState(threadId);
    }

    // New turn: drop prior plan so the popover only reappears when this turn
    // emits a plan update (applyTurnStop also clears; this covers image-only prompts).
    runtime.slice = { ...runtime.slice, isStreaming: true, plan: null };
    this.pushState(threadId);
    touchThread(threadId);

    const queued = this.prompts.enqueue(threadId, {
      blocks,
      streamingBehavior: input.streamingBehavior,
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
      try {
        await this.switchThread(threadId);
      } catch (err) {
        if (!isActivationSuperseded(err)) throw err;
        await this.switchThread(threadId);
      }
    }
    const runtime = this.sessions.get(threadId);
    const live = runtime ? this.connectionForAgent(runtime.agentId) : null;
    if (!runtime || !live) throw new Error("No session for thread");

    runtime.promptInFlight = true;
    runtime.activeTurnId = `${runtime.threadId}:${Date.now()}:${++this.turnSequence}`;
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
      runtime.activeTurnId = null;
      this.settleRuntime(runtime);
      this.pushState(threadId);
    } catch {
      runtime.promptInFlight = false;
      runtime.activeTurnId = null;
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
    this.prompts.cancelInFlight(threadId, "user abort");
    this.prompts.rejectQueued(threadId, "agent prompt cancelled");
    this.clearToolCallTiming(runtime.agentSessionId);
    await owner.agent
      .notify(acp.methods.agent.session.cancel, { sessionId: runtime.agentSessionId })
      .catch(() => {});
    this.permissions.cancelForSession(runtime.agentSessionId);
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
    return this.lifecycle.active?.agentCapabilities ?? null;
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

  async dispose(): Promise<void> {
    this.terminalManager.killAll();
    this.subagents.dispose();
    await this.flushAllSnapshots();
    await this.closeConnection();
  }

  /** @deprecated Compact is agent-owned; no-op. */
  async compact(_customInstructions?: string): Promise<void> {
    // Dropped explicit UI compact — agent decides when to compact.
  }
}

/** Back-compat alias used by main.ts during migration. */
export { AgentConnectionManager as AgentManager };
