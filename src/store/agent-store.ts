import { create } from "zustand";
import type {
  AgentBridgeEvent,
  AgentModelSummary,
  AgentRuntimeSnapshot,
  AgentUiRequest,
  AgentUiResponse,
  AgentPromptInput,
} from "../../contracts/agent.ts";
import type { Thread } from "../../contracts/threads.ts";
import type { SlashCommandInfo, SessionStats } from "@earendil-works/pi-coding-agent";

interface AgentState {
  snapshot: AgentRuntimeSnapshot | null;
  pendingThreadId: string | null;
  uiRequest: AgentUiRequest | null;
  events: AgentBridgeEvent[];
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  refresh: () => Promise<void>;
  respondToUiRequest: (response: AgentUiResponse) => Promise<void>;
  sendPrompt: (input: AgentPromptInput) => Promise<void>;
  abort: () => Promise<void>;
  switchThread: (threadId: string) => Promise<void>;
  createThread: (projectId: string, title: string) => Promise<Thread>;
  cycleModel: (direction?: "forward" | "backward") => Promise<AgentModelSummary | null>;
  setModel: (model: { provider: string; modelId: string }) => Promise<boolean>;
  compact: (customInstructions?: string) => Promise<void>;
  setEditorText: (text: string) => Promise<void>;
  pasteToEditor: (text: string) => Promise<void>;
  reportEditorText: (text: string) => Promise<void>;
  getState: () => AgentRuntimeSnapshot | null;
  getCommands: () => SlashCommandInfo[];
  getModels: () => AgentModelSummary[];
  getStats: () => SessionStats | null;
}

let unsubscribeBridge: (() => void) | null = null;
let latestThreadSwitchId = 0;
let threadSwitchQueue: Promise<void> = Promise.resolve();

function mergeSnapshot(
  snapshot: AgentRuntimeSnapshot | null,
  patch: Partial<AgentRuntimeSnapshot>,
): AgentRuntimeSnapshot | null {
  if (!snapshot) return snapshot;
  return { ...snapshot, ...patch };
}

function applyBridgeEvent(
  state: Pick<AgentState, "snapshot" | "pendingThreadId" | "uiRequest" | "events">,
  payload: AgentBridgeEvent,
): Pick<AgentState, "snapshot" | "pendingThreadId" | "uiRequest" | "events"> {
  const events = [...state.events, payload].slice(-200);

  switch (payload.type) {
    case "snapshot":
      if (state.pendingThreadId && payload.snapshot.threadId !== state.pendingThreadId) {
        return { ...state, events };
      }
      return {
        snapshot: payload.snapshot,
        pendingThreadId:
          state.pendingThreadId === payload.snapshot.threadId ? null : state.pendingThreadId,
        uiRequest: state.uiRequest,
        events,
      };
    case "ui-request":
      return { ...state, uiRequest: payload.request, events };
    case "ui-response":
      return {
        ...state,
        uiRequest: state.uiRequest?.id === payload.requestId ? null : state.uiRequest,
        events,
      };
    case "status":
      return {
        ...state,
        snapshot: mergeSnapshot(state.snapshot, {
          status: { ...state.snapshot?.status, [payload.key]: payload.text },
        }),
        events,
      };
    case "working-message":
      return {
        ...state,
        snapshot: mergeSnapshot(state.snapshot, { workingMessage: payload.message ?? null }),
        events,
      };
    case "working-visible":
      return {
        ...state,
        snapshot: mergeSnapshot(state.snapshot, { workingVisible: payload.visible }),
        events,
      };
    case "title":
      return {
        ...state,
        snapshot: mergeSnapshot(state.snapshot, { title: payload.title ?? null }),
        events,
      };
    case "editor-text":
      return {
        ...state,
        snapshot: mergeSnapshot(state.snapshot, { editorText: payload.text }),
        events,
      };
    case "notification":
      return { ...state, events };
    case "event":
      return { ...state, events };
  }
}

export const useAgentStore = create<AgentState>((set, get) => ({
  snapshot: null,
  pendingThreadId: null,
  uiRequest: null,
  events: [],
  isConnecting: false,
  error: null,
  connect: async () => {
    if (!window.omni?.agent) return;
    set({ isConnecting: true, error: null });
    try {
      if (!unsubscribeBridge) {
        unsubscribeBridge = window.omni.agent.onEvent((payload) => {
          set((state) => applyBridgeEvent(state, payload));
        });
      }
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
      set((state) => {
        if (state.pendingThreadId && snapshot.threadId !== state.pendingThreadId) {
          return {};
        }
        return {
          snapshot,
          pendingThreadId:
            state.pendingThreadId === snapshot.threadId ? null : state.pendingThreadId,
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
  abort: async () => {
    await window.omni.agent.abort();
  },
  switchThread: async (threadId) => {
    if (get().snapshot?.threadId === threadId && !get().pendingThreadId) return;

    const switchId = ++latestThreadSwitchId;
    set({ pendingThreadId: threadId, error: null });

    threadSwitchQueue = threadSwitchQueue
      .catch(() => undefined)
      .then(async () => {
        if (switchId !== latestThreadSwitchId) return;

        await window.omni.agent.switchThread(threadId);
        const snapshot = await window.omni.agent.getState();

        set(() => {
          if (switchId !== latestThreadSwitchId) return {};
          return {
            snapshot,
            pendingThreadId: snapshot.threadId === threadId ? null : threadId,
            error: null,
          };
        });
      })
      .catch((err) => {
        set(() => {
          if (switchId !== latestThreadSwitchId) return {};
          return {
            error: err instanceof Error ? err.message : "Failed to switch thread",
            pendingThreadId: null,
          };
        });
      });

    await threadSwitchQueue;
  },
  createThread: async (projectId, title) => {
    const thread = await window.omni.agent.createThread(projectId, title);
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
  compact: async (customInstructions) => {
    await window.omni.agent.compact(customInstructions);
  },
  setEditorText: async (text) => {
    await window.omni.agent.setEditorText(text);
  },
  pasteToEditor: async (text) => {
    await window.omni.agent.pasteToEditor(text);
  },
  reportEditorText: async (text) => {
    await window.omni.agent.reportEditorText(text);
  },
  getState: () => get().snapshot,
  getCommands: () => get().snapshot?.commands ?? [],
  getModels: () => get().snapshot?.models ?? [],
  getStats: () => get().snapshot?.stats ?? null,
}));
