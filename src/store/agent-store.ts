import { create } from "zustand";
import type {
  AgentBridgeEvent,
  AgentModelSummary,
  AgentRuntimeSnapshot,
  AgentUiRequest,
  AgentUiResponse,
  AgentPromptInput,
  AgentReplacePromptInput,
} from "../../contracts/agent.ts";
import type { Thread } from "../../contracts/threads.ts";
import type { SlashCommandInfo, SessionStats } from "@earendil-works/pi-coding-agent";
import { toast } from "../components/ui/toast";
import { Warning, Info } from "@phosphor-icons/react";
import React from "react";

interface AgentState {
  snapshot: AgentRuntimeSnapshot | null;
  uiRequest: AgentUiRequest | null;
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  refresh: () => Promise<void>;
  respondToUiRequest: (response: AgentUiResponse) => Promise<void>;
  sendPrompt: (input: AgentPromptInput) => Promise<void>;
  replacePrompt: (input: AgentReplacePromptInput) => Promise<void>;
  abort: () => Promise<void>;
  switchThread: (threadId: string) => Promise<void>;
  createThread: (
    projectId: string,
    title: string,
    afterThreadId?: string | null,
  ) => Promise<Thread>;
  cycleModel: (direction?: "forward" | "backward") => Promise<AgentModelSummary | null>;
  setModel: (model: { provider: string; modelId: string }) => Promise<boolean>;
  cycleThinkingLevel: () => Promise<string | null>;
  setThinkingLevel: (level: ThinkingLevel) => Promise<void>;
  compact: (customInstructions?: string) => Promise<void>;
  setEditorText: (text: string) => Promise<void>;
  pasteToEditor: (text: string) => Promise<void>;
  reportEditorText: (text: string) => void;
  getState: () => AgentRuntimeSnapshot | null;
  getCommands: () => SlashCommandInfo[];
  getModels: () => AgentModelSummary[];
  getStats: () => SessionStats | null;
}

let unsubscribeBridge: (() => void) | null = null;
let latestThreadSwitchId = 0;
let threadSwitchQueue: Promise<void> = Promise.resolve();
let pendingThreadTarget: string | null = null;

function mergeSnapshot(
  snapshot: AgentRuntimeSnapshot | null,
  patch: Partial<AgentRuntimeSnapshot>,
): AgentRuntimeSnapshot | null {
  if (!snapshot) return snapshot;
  return { ...snapshot, ...patch };
}

function applyBridgeEvent(
  state: Pick<AgentState, "snapshot" | "uiRequest" | "error">,
  payload: AgentBridgeEvent,
): Pick<AgentState, "snapshot" | "uiRequest" | "error"> {
  if (
    pendingThreadTarget &&
    payload.type !== "snapshot" &&
    payload.type !== "ui-request" &&
    payload.type !== "ui-response"
  ) {
    return state;
  }

  switch (payload.type) {
    case "snapshot":
      if (pendingThreadTarget && payload.snapshot.threadId !== pendingThreadTarget) {
        return state;
      }
      if (pendingThreadTarget && payload.snapshot.threadId === pendingThreadTarget) {
        pendingThreadTarget = null;
      }
      return {
        snapshot: payload.snapshot,
        uiRequest: state.uiRequest,
        error: null,
      };
    case "ui-request":
      return { ...state, uiRequest: payload.request };
    case "ui-response":
      return {
        ...state,
        uiRequest: state.uiRequest?.id === payload.requestId ? null : state.uiRequest,
      };
    case "status":
      return {
        ...state,
        snapshot: mergeSnapshot(state.snapshot, {
          status: { ...state.snapshot?.status, [payload.key]: payload.text },
        }),
      };
    case "working-message":
      return {
        ...state,
        snapshot: mergeSnapshot(state.snapshot, { workingMessage: payload.message ?? null }),
      };
    case "working-visible":
      return {
        ...state,
        snapshot: mergeSnapshot(state.snapshot, { workingVisible: payload.visible }),
      };
    case "title":
      return {
        ...state,
        snapshot: mergeSnapshot(state.snapshot, { title: payload.title ?? null }),
      };
    case "editor-text":
      return {
        ...state,
        snapshot: mergeSnapshot(state.snapshot, { editorText: payload.text }),
      };
    case "notification":
      return state;
    case "event":
      return state;
  }
}

export const useAgentStore = create<AgentState>((set, get) => ({
  snapshot: null,
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
      const rawCleanup = window.omni.agent.onEvent((payload) => {
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
        set((state) => applyBridgeEvent(state, payload));
      });
      unsubscribeBridge = () => {
        rawCleanup();
        unsubscribeBridge = null;
      };
      const snapshot = await window.omni.agent.getState();
      set({ snapshot, isConnecting: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to connect to agent runtime",
        isConnecting: false,
      });
    }
  },
  refresh: async () => {
    try {
      const snapshot = await window.omni.agent.getState();
      set(() => {
        if (pendingThreadTarget && snapshot.threadId !== pendingThreadTarget) {
          return {};
        }
        if (pendingThreadTarget && snapshot.threadId === pendingThreadTarget) {
          pendingThreadTarget = null;
        }
        return {
          snapshot,
        };
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to refresh agent state",
      });
    }
  },
  respondToUiRequest: async (response) => {
    await window.omni.agent.respondToUiRequest(response);
    set((state) => ({
      uiRequest: state.uiRequest?.id === response.requestId ? null : state.uiRequest,
    }));
  },
  sendPrompt: async (input) => {
    await window.omni.agent.sendPrompt(input);
  },
  replacePrompt: async (input) => {
    await window.omni.agent.replacePrompt(input);
  },
  abort: async () => {
    await window.omni.agent.abort();
  },
  switchThread: async (threadId) => {
    if (get().snapshot?.threadId === threadId && pendingThreadTarget == null) return;

    const switchId = ++latestThreadSwitchId;
    pendingThreadTarget = threadId;
    set({ error: null });

    threadSwitchQueue = threadSwitchQueue
      .catch(() => undefined)
      .then(async () => {
        if (switchId !== latestThreadSwitchId) return;

        await window.omni.agent.switchThread(threadId);
        const snapshot = await window.omni.agent.getState();

        set(() => {
          if (switchId !== latestThreadSwitchId) return {};
          if (pendingThreadTarget && snapshot.threadId !== pendingThreadTarget) return {};
          if (pendingThreadTarget && snapshot.threadId === pendingThreadTarget) {
            pendingThreadTarget = null;
          }
          return {
            snapshot,
            error: null,
          };
        });
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
  createThread: async (projectId, title, afterThreadId) => {
    const thread = await window.omni.agent.createThread(projectId, title, afterThreadId ?? null);
    await get().refresh();
    return thread;
  },
  cycleModel: async (direction) => {
    const model = await window.omni.agent.cycleModel(direction);
    await get().refresh();
    return model;
  },
  setModel: async (model) => {
    const success = await window.omni.agent.setModel(model);
    await get().refresh();
    return success;
  },
  cycleThinkingLevel: async () => {
    const nextLevel = await window.omni.agent.cycleThinkingLevel();
    await get().refresh();
    return nextLevel;
  },
  setThinkingLevel: async (level) => {
    await window.omni.agent.setThinkingLevel(level);
    await get().refresh();
  },
  compact: async (customInstructions) => {
    await window.omni.agent.compact(customInstructions);
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
  getState: () => get().snapshot,
  getCommands: () => get().snapshot?.commands ?? [],
  getModels: () => get().snapshot?.models ?? [],
  getStats: () => get().snapshot?.stats ?? null,
}));
