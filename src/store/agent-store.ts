import { create } from "zustand";
import type {
  AcpBridgeEvent,
  AcpChatMessage,
  AcpPermissionRequest,
  AcpPromptInput,
  AcpReplacePromptInput,
  AcpSessionState,
  AgentCapabilities,
  AvailableCommand,
  SessionConfigOption,
  SubagentRunSnapshot,
} from "../../contracts/acp.ts";
import { projectChatMessages, projectToolResultMessages } from "../lib/acp-entries";
import type { OpenTabsState, Thread, ThreadPage } from "../../contracts/threads.ts";
import {
  applySessionUpdate,
  applyTurnStop,
  appendLocalUserMessage,
  createEmptySessionSlice,
  type AcpSessionSlice,
} from "../lib/acp-session-reducer";
import { useAgentTerminalStore } from "./agent-terminal-store";
import { toast } from "../components/ui/toast";
import { Warning, Info } from "@phosphor-icons/react";
import React from "react";
import { queryClient } from "../lib/query-client";
import { OPEN_TABS_QUERY_KEY } from "../lib/thread-queries";
import { useThreadStore } from "./thread-store";

/**
 * An agent naming a session ("title" bridge event) is the source of truth
 * for a thread's title, but the tab strip reads from the open-tabs query and
 * the thread store, neither of which this store owns. Patch both caches in
 * place — cheaper than a refetch and keeps the tab label in sync the moment
 * the agent names the session.
 */
function applyThreadTitleUpdate(threadId: string, title: string): void {
  queryClient.setQueryData<(OpenTabsState & { openThreads: Thread[] }) | undefined>(
    OPEN_TABS_QUERY_KEY,
    (current) =>
      current
        ? {
            ...current,
            openThreads: current.openThreads.map((thread) =>
              thread.id === threadId ? { ...thread, title } : thread,
            ),
          }
        : current,
  );

  queryClient.setQueriesData<ThreadPage | undefined>({ queryKey: ["project-threads"] }, (current) =>
    current
      ? {
          ...current,
          threads: current.threads.map((thread) =>
            thread.id === threadId ? { ...thread, title } : thread,
          ),
        }
      : current,
  );

  useThreadStore.setState((state) => ({
    threads: state.threads.map((thread) =>
      thread.id === threadId ? { ...thread, title } : thread,
    ),
  }));
}

/** A question surfaced to the user, mapped from an ACP permission request. */
export interface UiRequest {
  id: string;
  kind: "select" | "confirm";
  title: string;
  message?: string;
  options?: string[];
  timeoutMs?: number;
  sessionId: string;
  /** Thread that raised the question; drives inline-vs-dock routing in the UI.
   *  Null when the owning session isn't bound to a thread. */
  threadId: string | null;
  optionIds?: string[];
}

interface AgentState {
  state: AcpSessionState | null;
  /** @deprecated Prefer `state`; panel compatibility view model. */
  snapshot: AgentPanelSnapshot | null;
  /** Incremental slice for the active session (mirrors main; applied optimistically). */
  slice: AcpSessionSlice;
  agentCapabilities: AgentCapabilities | null;
  authMethods: Array<{ id: string; name?: string | null }>;
  /** Thread IDs whose agent is currently streaming, across all open threads. */
  runningThreadIds: string[];
  /** Subagent runs spawned via the client-hosted spawn_subagent tool. */
  subagentRuns: SubagentRunSnapshot[];
  permissionRequest: AcpPermissionRequest | null;
  /** Pending questions from agents (mapped from ACP request_permission),
   *  in arrival order. Multiple background threads can each raise a question;
   *  they queue here instead of overwriting one another and are answered one
   *  by one. `uiRequest` mirrors the head for back-compat. */
  uiRequestQueue: UiRequest[];
  /** Head of `uiRequestQueue` (or null). Kept for existing call sites. */
  uiRequest: UiRequest | null;
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  refresh: () => Promise<void>;
  respondToPermission: (response: {
    sessionId: string;
    optionId?: string;
    cancelled?: boolean;
  }) => Promise<void>;
  sendPrompt: (input: AcpPromptInput) => Promise<void>;
  replacePrompt: (input: AcpReplacePromptInput) => Promise<void>;
  abort: () => Promise<void>;
  switchThread: (threadId: string) => Promise<void>;
  createThread: (
    projectId: string,
    title: string | null,
    afterThreadId?: string | null,
    agentId?: string | null,
  ) => Promise<Thread>;
  setConfigOption: (configId: string, value: string | boolean) => Promise<void>;
  setModel: (model: { provider?: string; modelId: string }) => Promise<boolean>;
  cycleThinkingLevel: () => Promise<string | null>;
  respondToUiRequest: (response: {
    requestId: string;
    value: string | boolean | undefined;
  }) => Promise<void>;
  compact: (customInstructions?: string) => Promise<void>;
  listAgents: () => Promise<
    Array<{ id: string; name: string; displayName: string; version?: string }>
  >;
  switchAgent: (agentId: string) => Promise<void>;
  setEditorText: (text: string) => Promise<void>;
  pasteToEditor: (text: string) => Promise<void>;
  reportEditorText: (text: string) => void;
  getState: () => AcpSessionState | null;
  getCommands: () => AvailableCommand[];
  getConfigOptions: () => SessionConfigOption[];
  getUsage: () => AcpSessionState["usage"];
  /** Capability helpers for UI gates. */
  canAttachImage: () => boolean;
  canEmbeddedContext: () => boolean;
  canAttachAudio: () => boolean;
}

let unsubscribeBridge: (() => void) | null = null;
let latestThreadSwitchId = 0;
let threadSwitchQueue: Promise<void> = Promise.resolve();
let pendingThreadTarget: string | null = null;
let latestRefreshId = 0;

function selectConfigOption(
  options: SessionConfigOption[],
  category: string,
): SessionConfigOption | undefined {
  return (
    options.find((o) => o.category === category) ??
    options.find((o) => o.id === category) ??
    options.find((o) => o.id.includes(category))
  );
}

function currentSelectValue(option: SessionConfigOption | undefined): string | null {
  if (!option || option.type !== "select") return null;
  return (option as { currentValue?: string }).currentValue ?? null;
}

function selectOptionsList(
  option: SessionConfigOption | undefined,
): Array<{ value: string; name: string }> {
  if (!option || option.type !== "select") return [];
  const raw = (option as { options?: unknown }).options;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ value: string; name: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    if ("value" in item && "name" in item) {
      out.push({ value: String((item as any).value), name: String((item as any).name) });
    } else if ("options" in item && Array.isArray((item as any).options)) {
      for (const nested of (item as any).options) {
        if (nested && typeof nested === "object" && "value" in nested) {
          out.push({ value: String(nested.value), name: String(nested.name ?? nested.value) });
        }
      }
    }
  }
  return out;
}

/** Panel-facing view model kept close to the old snapshot shape for UI continuity. */
export interface AgentPanelSnapshot {
  projectId: string | null;
  threadId: string | null;
  agentId: string | null;
  agentSessionId: string | null;
  sessionId: string | null;
  cwd: string | null;
  title: string | null;
  model: { provider: string; modelId: string; name: string } | null;
  thinkingLevel: string | null;
  isStreaming: boolean;
  isCompacting: boolean;
  isRetrying: boolean;
  autoCompactionEnabled: boolean;
  autoRetryEnabled: boolean;
  messages: Array<{
    id: string;
    role: string;
    content: string | Array<Record<string, unknown>>;
    thought?: string;
    toolCallIds?: string[];
    streaming?: boolean;
    toolCallId?: string;
    isError?: boolean;
    terminalIds?: string[];
  }>;
  /** Aligned with `messages` indices; null for non-user rows. */
  messageEntryRefs: Array<{ entryId: string; parentId: string | null } | null>;
  streamingMessage: {
    id: string;
    role: string;
    content: string | Array<Record<string, unknown>>;
    thought?: string;
  } | null;
  queue: { steering: string[]; followUp: string[] };
  commands: AvailableCommand[];
  models: Array<{ provider: string; modelId: string; name: string }>;
  configOptions: SessionConfigOption[];
  plan: AcpSessionState["plan"];
  usage: AcpSessionState["usage"];
  toolCalls: AcpSessionState["toolCalls"];
  stats: { used: number; size: number; cost?: { amount: number; currency: string } } | null;
  status: Record<string, string | undefined>;
  workingMessage: string | null;
  workingVisible: boolean;
  hiddenThinkingLabel: string | null;
  editorText: string;
  authRequiredMessage: string | null;
  switchingAgent: boolean;
}

/**
 * Memoized projection of the entry timeline into panel messages.
 * Reused wholesale when entries/toolCalls/isStreaming are referentially
 * unchanged (e.g. usage/plan/config updates), so the panel's message array
 * identity — and therefore memoized rows — survive unrelated bridge events.
 */
let lastPanelProjection: {
  entries: AcpSessionState["entries"];
  toolCalls: AcpSessionState["toolCalls"];
  isStreaming: boolean;
  streamingChat: AcpChatMessage | null;
  messages: AgentPanelSnapshot["messages"];
  messageEntryRefs: AgentPanelSnapshot["messageEntryRefs"];
} | null = null;

function projectPanelMessages(state: AcpSessionState): NonNullable<typeof lastPanelProjection> {
  if (
    lastPanelProjection &&
    lastPanelProjection.entries === state.entries &&
    lastPanelProjection.toolCalls === state.toolCalls &&
    lastPanelProjection.isStreaming === state.isStreaming
  ) {
    return lastPanelProjection;
  }
  const chat = projectChatMessages(state.entries, state.toolCalls, state.isStreaming);
  const streamingChat = chat.find((m) => m.streaming && m.role === "assistant") ?? null;
  // Keep streaming assistant only in streamingMessage (legacy panel grouping path).
  const settledChat = chat.filter((m) => !(m.streaming && m.role === "assistant"));
  const toolResultMessages = projectToolResultMessages(state.toolCalls);
  const messages = [...settledChat, ...toolResultMessages] as AgentPanelSnapshot["messages"];
  // Aligned with `messages` indices; non-user slots are null.
  const messageEntryRefs = messages.map((m) =>
    m.role === "user" ? { entryId: m.id, parentId: null } : null,
  );
  lastPanelProjection = {
    entries: state.entries,
    toolCalls: state.toolCalls,
    isStreaming: state.isStreaming,
    streamingChat,
    messages,
    messageEntryRefs,
  };
  return lastPanelProjection;
}

export function toPanelSnapshot(state: AcpSessionState | null): AgentPanelSnapshot | null {
  if (!state) return null;
  const modelOpt = selectConfigOption(state.configOptions, "model");
  const thoughtOpt = selectConfigOption(state.configOptions, "thought_level");
  const modelValue = currentSelectValue(modelOpt);
  const modelName =
    selectOptionsList(modelOpt).find((o) => o.value === modelValue)?.name ?? modelValue;
  const models = selectOptionsList(modelOpt).map((o) => ({
    provider: state.agentId ?? "agent",
    modelId: o.value,
    name: o.name,
  }));
  const { streamingChat, messages, messageEntryRefs } = projectPanelMessages(state);
  return {
    projectId: state.projectId,
    threadId: state.threadId,
    agentId: state.agentId,
    agentSessionId: state.agentSessionId,
    sessionId: state.agentSessionId,
    cwd: state.cwd,
    title: state.title,
    model: modelValue
      ? {
          provider: state.agentId ?? "agent",
          modelId: modelValue,
          name: modelName ?? modelValue,
        }
      : null,
    thinkingLevel: currentSelectValue(thoughtOpt),
    isStreaming: state.isStreaming,
    isCompacting: state.isCompacting,
    isRetrying: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    messages,
    messageEntryRefs,
    streamingMessage: streamingChat
      ? {
          id: streamingChat.id,
          role: streamingChat.role,
          content: streamingChat.content,
          thought: streamingChat.thought,
        }
      : null,
    queue: { steering: [], followUp: [] },
    commands: state.commands,
    models,
    configOptions: state.configOptions,
    plan: state.plan,
    usage: state.usage,
    toolCalls: state.toolCalls,
    stats: state.usage
      ? { used: state.usage.used, size: state.usage.size, cost: state.usage.cost }
      : null,
    status: {},
    workingMessage: null,
    workingVisible: false,
    hiddenThinkingLabel: null,
    editorText: state.editorText,
    authRequiredMessage: state.authRequiredMessage,
    switchingAgent: state.switchingAgent,
  };
}

function emptyState(): AcpSessionState {
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

function applyBridgeEvent(
  state: Pick<
    AgentState,
    | "state"
    | "slice"
    | "permissionRequest"
    | "uiRequestQueue"
    | "error"
    | "agentCapabilities"
    | "authMethods"
  >,
  payload: AcpBridgeEvent,
): Partial<AgentState> {
  if (payload.type === "running-threads") {
    return { runningThreadIds: payload.threadIds };
  }

  // Subagent activity is global (not per-thread); apply regardless of which
  // thread is displayed or being switched into.
  if (payload.type === "subagent-runs") {
    return { subagentRuns: payload.runs };
  }

  if (
    pendingThreadTarget &&
    payload.type !== "session-state" &&
    payload.type !== "session-update" &&
    payload.type !== "stop" &&
    payload.type !== "permission-request" &&
    payload.type !== "permission-resolved" &&
    payload.type !== "connection"
  ) {
    return {};
  }

  switch (payload.type) {
    case "session-state": {
      if (pendingThreadTarget && payload.state.threadId !== pendingThreadTarget) {
        return {};
      }
      const isResolvingSwitch = pendingThreadTarget === payload.state.threadId;
      if (isResolvingSwitch) {
        pendingThreadTarget = null;
      }
      // Same reasoning as "session-update"/"stop": a background thread's own
      // pushState (e.g. its turn starting or ending) must never clobber the
      // state of whichever thread the user is actually looking at.
      if (
        !isResolvingSwitch &&
        state.state?.threadId &&
        payload.state.threadId !== state.state.threadId
      ) {
        return {};
      }
      return {
        state: payload.state,
        slice: createEmptySessionSlice({
          entries: payload.state.entries,
          toolCalls: payload.state.toolCalls,
          plan: payload.state.plan,
          usage: payload.state.usage,
          configOptions: payload.state.configOptions,
          commands: payload.state.commands,
          currentModeId: payload.state.currentModeId,
          isStreaming: payload.state.isStreaming,
          title: payload.state.title,
        }),
        error: null,
      };
    }
    case "session-update": {
      // Events from a thread running in the background must never be applied
      // to whichever thread happens to be displayed right now — only to the
      // thread currently shown (or the one we're switching into).
      const displayedThreadId = pendingThreadTarget ?? state.state?.threadId ?? null;
      if (payload.threadId !== displayedThreadId) {
        return {};
      }
      const nextSlice = applySessionUpdate(state.slice, payload.update);
      const base = state.state ?? emptyState();
      return {
        slice: nextSlice,
        state: {
          ...base,
          entries: nextSlice.entries,
          toolCalls: nextSlice.toolCalls,
          plan: nextSlice.plan,
          usage: nextSlice.usage,
          configOptions: nextSlice.configOptions,
          commands: nextSlice.commands,
          currentModeId: nextSlice.currentModeId,
          isStreaming: nextSlice.isStreaming,
          title: nextSlice.titleChanged ? nextSlice.title : base.title,
        },
      };
    }
    case "stop": {
      // Same reasoning as "session-update": a background thread finishing its
      // turn must not stop (or fail to stop) the streaming indicator for the
      // thread the user is actually looking at.
      const displayedThreadId = pendingThreadTarget ?? state.state?.threadId ?? null;
      if (payload.threadId !== displayedThreadId) {
        return {};
      }
      const nextSlice = applyTurnStop(state.slice);
      const base = state.state ?? emptyState();
      return {
        slice: nextSlice,
        state: {
          ...base,
          entries: nextSlice.entries,
          isStreaming: false,
          plan: null, // plan popover auto-closes on turn complete
        },
      };
    }
    case "permission-request": {
      const options = payload.request.options ?? [];
      const next: UiRequest = {
        id: payload.request.sessionId,
        kind: "select",
        title: "Permission required",
        message: (payload.request.toolCall as { title?: string })?.title ?? "Allow this tool call?",
        options: options.map((o) => o.name),
        sessionId: payload.request.sessionId,
        threadId: payload.request.threadId ?? null,
        optionIds: options.map((o) => o.optionId),
      };
      // Enqueue rather than overwrite, so a question from a background thread
      // doesn't clobber one already awaiting an answer. Replace in place if the
      // same session re-asks (dedupe by sessionId).
      const withoutDup = state.uiRequestQueue.filter((r) => r.sessionId !== next.sessionId);
      const uiRequestQueue = [...withoutDup, next];
      return {
        permissionRequest: payload.request,
        uiRequestQueue,
        uiRequest: uiRequestQueue[0] ?? null,
      };
    }
    case "permission-resolved": {
      const uiRequestQueue = state.uiRequestQueue.filter((r) => r.sessionId !== payload.sessionId);
      return {
        permissionRequest:
          state.permissionRequest?.sessionId === payload.sessionId ? null : state.permissionRequest,
        uiRequestQueue,
        uiRequest: uiRequestQueue[0] ?? null,
      };
    }
    case "connection":
      return {
        agentCapabilities: payload.agentCapabilities,
        authMethods: payload.authMethods ?? [],
        state: state.state
          ? {
              ...state.state,
              agentId: payload.agentId,
              authRequiredMessage:
                (payload.authMethods?.length ?? 0) > 0
                  ? `This agent requires authentication. Please authenticate the agent in your terminal first.`
                  : null,
            }
          : state.state,
      };
    case "title": {
      if (!state.state || state.state.threadId !== payload.threadId) return {};
      return {
        state: { ...state.state, title: payload.title },
        slice: { ...state.slice, title: payload.title, titleChanged: false },
      };
    }
    case "editor-text": {
      if (!state.state) return {};
      return { state: { ...state.state, editorText: payload.text } };
    }
    case "notification":
      return {};
    case "terminal-output":
      // Handled by agent-terminal-store via connect() bridge
      return {};
    default:
      return {};
  }
}

function withSnapshot(
  partial: Partial<AgentState> & { state?: AcpSessionState | null },
): Partial<AgentState> {
  if ("state" in partial) {
    return { ...partial, snapshot: toPanelSnapshot(partial.state ?? null) };
  }
  return partial;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  state: null,
  snapshot: null,
  slice: createEmptySessionSlice(),
  agentCapabilities: null,
  authMethods: [],
  runningThreadIds: [],
  subagentRuns: [],
  permissionRequest: null,
  uiRequestQueue: [],
  uiRequest: null,
  isConnecting: false,
  error: null,

  connect: async () => {
    if (!window.omni?.agent) return;
    set({ isConnecting: true, error: null });
    try {
      if (unsubscribeBridge) {
        try {
          unsubscribeBridge();
        } catch (err) {
          console.error("Failed to unsubscribe previous bridge listener:", err);
        }
        unsubscribeBridge = null;
        // Terminals belong to the previous connection's agent processes; their
        // ids can never receive output again, so drop them to bound the
        // outputs record's key count across reconnects.
        useAgentTerminalStore.getState().reset();
      }
      // Single writer for ACP terminal-output (no second onEvent subscription).
      const rawCleanup = window.omni.agent.onEvent((payload: AcpBridgeEvent) => {
        if (payload.type === "terminal-output") {
          useAgentTerminalStore
            .getState()
            .applyTerminalOutput(payload.terminalId, payload.output, payload.append);
        }
        if (payload.type === "title") {
          applyThreadTitleUpdate(payload.threadId, payload.title);
        }
        if (payload.type === "notification") {
          let icon = React.createElement(Info, { className: "size-5 text-blue-500" });
          if (payload.level === "error") {
            icon = React.createElement(Warning, { className: "size-5 text-red-500" });
          } else if (payload.level === "warning") {
            icon = React.createElement(Warning, { className: "size-5 text-yellow-500" });
          }
          toast({
            icon,
            title: payload.level.toUpperCase(),
            description: payload.message,
          });
        }
        set((s) => {
          const patch = applyBridgeEvent(s, payload) as Partial<AgentState>;
          return withSnapshot(patch) as Partial<AgentState>;
        });
      });
      unsubscribeBridge = () => {
        rawCleanup();
        unsubscribeBridge = null;
      };
      const state = await window.omni.agent.getState();
      set(
        withSnapshot({
          state,
          slice: createEmptySessionSlice({
            entries: state.entries,
            toolCalls: state.toolCalls,
            plan: state.plan,
            usage: state.usage,
            configOptions: state.configOptions,
            commands: state.commands,
            currentModeId: state.currentModeId,
            isStreaming: state.isStreaming,
            title: state.title,
          }),
          isConnecting: false,
        }) as Partial<AgentState>,
      );
      // Load capabilities if API exposes them
      if (window.omni.agent.getCapabilities) {
        const caps = await window.omni.agent.getCapabilities();
        if (caps) set({ agentCapabilities: caps });
      }
      // Sync running-thread set so tabs reflect in-flight background runs after a reconnect.
      if (window.omni.agent.getRunningThreads) {
        const runningThreadIds = await window.omni.agent.getRunningThreads();
        set({ runningThreadIds });
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to connect to agent runtime",
        isConnecting: false,
      });
    }
  },

  refresh: async () => {
    const refreshId = ++latestRefreshId;
    try {
      const state = await window.omni.agent.getState();
      set(() => {
        if (refreshId !== latestRefreshId) return {};
        if (pendingThreadTarget && state.threadId !== pendingThreadTarget) {
          return {};
        }
        if (pendingThreadTarget && state.threadId === pendingThreadTarget) {
          pendingThreadTarget = null;
        }
        return withSnapshot({
          state,
          slice: createEmptySessionSlice({
            entries: state.entries,
            toolCalls: state.toolCalls,
            plan: state.plan,
            usage: state.usage,
            configOptions: state.configOptions,
            commands: state.commands,
            currentModeId: state.currentModeId,
            isStreaming: state.isStreaming,
            title: state.title,
          }),
        });
      });
    } catch (err) {
      if (refreshId === latestRefreshId) {
        set({
          error: err instanceof Error ? err.message : "Failed to refresh agent state",
        });
      }
    }
  },

  respondToPermission: async (response) => {
    await window.omni.agent.respondToPermission(response);
    set((s) => {
      const uiRequestQueue = s.uiRequestQueue.filter((r) => r.sessionId !== response.sessionId);
      return {
        permissionRequest:
          s.permissionRequest?.sessionId === response.sessionId ? null : s.permissionRequest,
        uiRequestQueue,
        uiRequest: uiRequestQueue[0] ?? null,
      };
    });
  },

  respondToUiRequest: async (response) => {
    // Answer a specific queued request by id (its sessionId). Falls back to the
    // head so existing single-request call sites keep working.
    const queue = get().uiRequestQueue;
    const ui = queue.find((r) => r.id === response.requestId) ?? queue[0];
    if (!ui) return;
    const optionId =
      typeof response.value === "string" && ui.optionIds && ui.options
        ? (ui.optionIds[ui.options.indexOf(response.value)] ?? ui.optionIds[0])
        : ui.optionIds?.[0];
    await get().respondToPermission({
      sessionId: ui.sessionId,
      optionId: response.value === false || response.value === undefined ? undefined : optionId,
      cancelled: response.value === false || response.value === undefined,
    });
  },

  setModel: async (model) => {
    const opts = get().getConfigOptions();
    const modelOpt = selectConfigOption(opts, "model");
    if (!modelOpt) return false;
    await get().setConfigOption(modelOpt.id, model.modelId);
    return true;
  },

  cycleThinkingLevel: async () => {
    const opts = get().getConfigOptions();
    const thoughtOpt = selectConfigOption(opts, "thought_level");
    if (!thoughtOpt || thoughtOpt.type !== "select") return null;
    const values = selectOptionsList(thoughtOpt);
    if (values.length === 0) return null;
    const current = currentSelectValue(thoughtOpt);
    const idx = Math.max(
      0,
      values.findIndex((v) => v.value === current),
    );
    const next = values[(idx + 1) % values.length]!;
    await get().setConfigOption(thoughtOpt.id, next.value);
    return next.value;
  },

  compact: async (_customInstructions?: string) => {
    // Explicit compact UI dropped — agent-owned compaction.
  },

  sendPrompt: async (input) => {
    // Optimistic local user message
    if (input.message) {
      set((s) => {
        const nextSlice = appendLocalUserMessage(s.slice, input.message!);
        const base = s.state ?? emptyState();
        return withSnapshot({
          slice: nextSlice,
          state: {
            ...base,
            entries: nextSlice.entries,
            isStreaming: true,
          },
        });
      });
    }
    await window.omni.agent.sendPrompt(input);
  },

  replacePrompt: async (input) => {
    await window.omni.agent.replacePrompt(input);
  },

  abort: async () => {
    const sessionId = get().state?.agentSessionId;
    await window.omni.agent.abort();
    if (sessionId) {
      await get()
        .respondToPermission({ sessionId, cancelled: true })
        .catch(() => {});
    }
  },

  switchThread: async (threadId) => {
    if (get().state?.threadId === threadId && pendingThreadTarget == null) return;

    const switchId = ++latestThreadSwitchId;
    pendingThreadTarget = threadId;
    set({ error: null });

    threadSwitchQueue = threadSwitchQueue
      .catch(() => undefined)
      .then(async () => {
        if (switchId !== latestThreadSwitchId) return;

        await window.omni.agent.switchThread(threadId);
        // `agent:switchThread` emits the complete target snapshot before its
        // IPC promise resolves. Avoid a second renderer→main→renderer trip.
        // Keep fallback for older ACP bridges that do not emit that snapshot.
        if (get().state?.threadId !== threadId) {
          const state = await window.omni.agent.getState();
          set(() => {
            if (switchId !== latestThreadSwitchId || state.threadId !== threadId) return {};
            pendingThreadTarget = null;
            return withSnapshot({
              state,
              slice: createEmptySessionSlice({
                entries: state.entries,
                toolCalls: state.toolCalls,
                plan: state.plan,
                usage: state.usage,
                configOptions: state.configOptions,
                commands: state.commands,
                currentModeId: state.currentModeId,
                isStreaming: state.isStreaming,
                title: state.title,
              }),
              error: null,
            });
          });
        } else {
          pendingThreadTarget = null;
          set({ error: null });
        }
      })
      .catch((err) => {
        set(() => {
          if (switchId !== latestThreadSwitchId) return {};
          if (pendingThreadTarget === threadId) {
            pendingThreadTarget = null;
          }
          return {
            error: err instanceof Error ? err.message : "Failed to switch thread",
          };
        });
      });

    await threadSwitchQueue;
  },

  createThread: async (projectId, title, afterThreadId, agentId) => {
    const thread = await window.omni.agent.createThread(
      projectId,
      title ?? null,
      afterThreadId ?? null,
      agentId ?? null,
    );
    await get().refresh();
    return thread;
  },

  setConfigOption: async (configId, value) => {
    await window.omni.agent.setConfigOption(configId, value);
    await get().refresh();
  },

  listAgents: async () => {
    if (!window.omni.agent.listAgents) return [];
    return window.omni.agent.listAgents();
  },

  switchAgent: async (agentId) => {
    if (!window.omni.agent.switchAgent) return;
    set((s) => ({
      state: s.state ? { ...s.state, switchingAgent: true } : s.state,
    }));
    await window.omni.agent.switchAgent(agentId);
    await get().refresh();
  },

  setEditorText: async (text) => {
    await window.omni.agent.setEditorText(text);
  },
  pasteToEditor: async (text) => {
    await window.omni.agent.pasteToEditor(text);
  },
  reportEditorText: (text) => {
    window.omni.agent.reportEditorText(text);
  },

  getState: () => get().state,
  getCommands: () => get().state?.commands ?? get().slice.commands,
  getConfigOptions: () => get().state?.configOptions ?? get().slice.configOptions,
  getUsage: () => get().state?.usage ?? get().slice.usage,
  canAttachImage: () => Boolean(get().agentCapabilities?.promptCapabilities?.image),
  canEmbeddedContext: () => Boolean(get().agentCapabilities?.promptCapabilities?.embeddedContext),
  canAttachAudio: () => Boolean(get().agentCapabilities?.promptCapabilities?.audio),
}));

// Legacy alias helpers for gradual UI migration
export type { AcpSessionState as AgentRuntimeSnapshot };
