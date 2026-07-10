import { create } from "zustand";
import type {
  AcpBridgeEvent,
  AcpPermissionRequest,
  AcpPromptInput,
  AcpReplacePromptInput,
  AcpSessionState,
  AgentCapabilities,
  AvailableCommand,
  SessionConfigOption,
} from "../../contracts/acp.ts";
import type { Thread } from "../../contracts/threads.ts";
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

interface AgentState {
  state: AcpSessionState | null;
  /** @deprecated Prefer `state`; panel compatibility view model. */
  snapshot: AgentPanelSnapshot | null;
  /** Incremental slice for the active session (mirrors main; applied optimistically). */
  slice: AcpSessionSlice;
  agentCapabilities: AgentCapabilities | null;
  authMethods: Array<{ id: string; name?: string | null }>;
  permissionRequest: AcpPermissionRequest | null;
  /** Permission UI mapped from ACP request_permission. */
  uiRequest: {
    id: string;
    kind: "select" | "confirm";
    title: string;
    message?: string;
    options?: string[];
    timeoutMs?: number;
    sessionId: string;
    optionIds?: string[];
  } | null;
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
  messageEntryRefs: Array<{ entryId: string; parentId: string | null }>;
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
 * Build MessageBody-compatible content parts from ACP chat messages + toolCalls.
 * MessageBody only renders thinking/toolCall traces from array content parts.
 */
export function toPanelMessageContent(
  message: AcpSessionState["messages"][number],
  toolCalls: AcpSessionState["toolCalls"],
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  if (message.role === "user") {
    if (message.text) parts.push({ type: "text", text: message.text });
    return parts;
  }

  if (message.thought) {
    parts.push({ type: "thinking", thinking: message.thought });
  }

  for (const toolCallId of message.toolCallIds) {
    const tc = toolCalls[toolCallId];
    if (!tc) {
      parts.push({
        type: "toolCall",
        id: toolCallId,
        name: "Tool",
        arguments: {},
        status: "pending",
      });
      continue;
    }
    const args =
      tc.rawInput && typeof tc.rawInput === "object" && !Array.isArray(tc.rawInput)
        ? (tc.rawInput as Record<string, unknown>)
        : tc.rawInput !== undefined
          ? { input: tc.rawInput }
          : {};
    parts.push({
      type: "toolCall",
      id: tc.toolCallId,
      name: tc.title || tc.kind || "Tool",
      kind: tc.kind,
      arguments: args,
      args,
      status: tc.status,
      content: tc.content,
      rawOutput: tc.rawOutput,
    });
  }

  if (message.text) {
    parts.push({ type: "text", text: message.text });
  }
  return parts;
}

/** Synthetic toolResult messages so AssistantTraceDeck can resolve completed tools. */
export function toPanelToolResultMessages(
  toolCalls: AcpSessionState["toolCalls"],
): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];
  for (const tc of Object.values(toolCalls)) {
    if (tc.status !== "completed" && tc.status !== "failed") continue;
    const textParts: string[] = [];
    const terminalIds: string[] = [];
    for (const block of tc.content ?? []) {
      const typed = block as {
        type?: string;
        content?: { type?: string; text?: string };
        terminalId?: string;
        text?: string;
      };
      if (typed.type === "terminal" && typed.terminalId) {
        terminalIds.push(typed.terminalId);
        textParts.push(`[terminal:${typed.terminalId}]`);
      } else if (typed.type === "content" && typed.content?.type === "text") {
        textParts.push(typed.content.text ?? "");
      } else if (typed.type === "diff") {
        textParts.push("[diff]");
      } else if (typeof typed.text === "string") {
        textParts.push(typed.text);
      }
    }
    if (tc.rawOutput != null && textParts.length === 0) {
      textParts.push(
        typeof tc.rawOutput === "string" ? tc.rawOutput : JSON.stringify(tc.rawOutput),
      );
    }
    results.push({
      id: `tool-result-${tc.toolCallId}`,
      role: "toolResult",
      toolCallId: tc.toolCallId,
      isError: tc.status === "failed",
      content: textParts.join("\n") || (tc.status === "failed" ? "Tool failed" : "OK"),
      terminalIds,
    });
  }
  return results;
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
  const mappedChat = state.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: toPanelMessageContent(m, state.toolCalls),
    thought: m.thought,
    toolCallIds: m.toolCallIds,
    streaming: m.streaming,
  }));
  const streamingChat = mappedChat.find((m) => m.streaming && m.role === "assistant") ?? null;
  // Keep streaming assistant only in streamingMessage (legacy panel grouping path).
  const settledChat = mappedChat.filter((m) => !(m.streaming && m.role === "assistant"));
  const toolResultMessages = toPanelToolResultMessages(state.toolCalls);
  const messages = [...settledChat, ...toolResultMessages] as AgentPanelSnapshot["messages"];
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
    messageEntryRefs: state.messages
      .filter((m) => m.role === "user")
      .map((m) => ({ entryId: m.id, parentId: null })),
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
    messages: [],
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
    "state" | "slice" | "permissionRequest" | "error" | "agentCapabilities" | "authMethods"
  >,
  payload: AcpBridgeEvent,
): Partial<AgentState> {
  if (
    pendingThreadTarget &&
    payload.type !== "session-state" &&
    payload.type !== "permission-request" &&
    payload.type !== "permission-resolved" &&
    payload.type !== "connection"
  ) {
    // Ignore stale session updates while switching threads
    if (payload.type === "session-update" && payload.threadId !== pendingThreadTarget) {
      return {};
    }
    if (payload.type !== "session-update") {
      return {};
    }
  }

  switch (payload.type) {
    case "session-state": {
      if (pendingThreadTarget && payload.state.threadId !== pendingThreadTarget) {
        return {};
      }
      if (pendingThreadTarget && payload.state.threadId === pendingThreadTarget) {
        pendingThreadTarget = null;
      }
      return {
        state: payload.state,
        slice: createEmptySessionSlice({
          messages: payload.state.messages,
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
      if (pendingThreadTarget && payload.threadId !== pendingThreadTarget) {
        return {};
      }
      const nextSlice = applySessionUpdate(state.slice, payload.update);
      const base = state.state ?? emptyState();
      return {
        slice: nextSlice,
        state: {
          ...base,
          messages: nextSlice.messages,
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
      const nextSlice = applyTurnStop(state.slice);
      const base = state.state ?? emptyState();
      return {
        slice: nextSlice,
        state: {
          ...base,
          messages: nextSlice.messages,
          isStreaming: false,
          plan: null, // plan popover auto-closes on turn complete
        },
      };
    }
    case "permission-request": {
      const options = payload.request.options ?? [];
      return {
        permissionRequest: payload.request,
        uiRequest: {
          id: payload.request.sessionId,
          kind: "select",
          title: "Permission required",
          message:
            (payload.request.toolCall as { title?: string })?.title ?? "Allow this tool call?",
          options: options.map((o) => o.name),
          sessionId: payload.request.sessionId,
          optionIds: options.map((o) => o.optionId),
        },
      };
    }
    case "permission-resolved":
      return {
        permissionRequest:
          state.permissionRequest?.sessionId === payload.sessionId ? null : state.permissionRequest,
        uiRequest: state.uiRequest?.sessionId === payload.sessionId ? null : state.uiRequest,
      };
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
  permissionRequest: null,
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
      }
      // Single writer for ACP terminal-output (no second onEvent subscription).
      const rawCleanup = window.omni.agent.onEvent((payload: AcpBridgeEvent) => {
        if (payload.type === "terminal-output") {
          useAgentTerminalStore
            .getState()
            .applyTerminalOutput(payload.terminalId, payload.output, payload.append);
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
            messages: state.messages,
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
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to connect to agent runtime",
        isConnecting: false,
      });
    }
  },

  refresh: async () => {
    try {
      const state = await window.omni.agent.getState();
      set(() => {
        if (pendingThreadTarget && state.threadId !== pendingThreadTarget) {
          return {};
        }
        if (pendingThreadTarget && state.threadId === pendingThreadTarget) {
          pendingThreadTarget = null;
        }
        return withSnapshot({
          state,
          slice: createEmptySessionSlice({
            messages: state.messages,
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
      set({
        error: err instanceof Error ? err.message : "Failed to refresh agent state",
      });
    }
  },

  respondToPermission: async (response) => {
    await window.omni.agent.respondToPermission(response);
    set((s) => ({
      permissionRequest:
        s.permissionRequest?.sessionId === response.sessionId ? null : s.permissionRequest,
      uiRequest: s.uiRequest?.sessionId === response.sessionId ? null : s.uiRequest,
    }));
  },

  respondToUiRequest: async (response) => {
    const ui = get().uiRequest;
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
            messages: nextSlice.messages,
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
                messages: state.messages,
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
