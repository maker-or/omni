import { create } from "zustand";
import type { OpenTabsState, Thread } from "../../contracts/threads.ts";

interface OpenTabState extends OpenTabsState {
  openThreads: Thread[];
  isLoading: boolean;
  error: string | null;
  restoreOpenTabs: () => Promise<void>;
  openThread: (threadId: string) => Promise<void>;
  closeThread: (threadId: string) => Promise<OpenTabsState>;
  setActiveThread: (threadId: string | null) => Promise<void>;
  recordExternalState: (state: OpenTabsState) => Promise<void>;
  updateThread: (thread: Thread) => void;
  removeThread: (threadId: string) => void;
}

let unsubscribeTabsChanged: (() => void) | null = null;

async function hydrateOpenThreads(openThreadIds: string[]): Promise<Thread[]> {
  if (openThreadIds.length === 0) return [];
  return window.omni.threads.listByIds(openThreadIds);
}

export const useOpenTabStore = create<OpenTabState>((set, get) => ({
  openThreadIds: [],
  openThreads: [],
  activeThreadId: null,
  threadSwitchHistory: [],
  isLoading: false,
  error: null,

  restoreOpenTabs: async () => {
    set({ isLoading: true, error: null });
    try {
      if (!unsubscribeTabsChanged) {
        unsubscribeTabsChanged = window.omni.tabs.onChanged((state) => {
          void get().recordExternalState(state);
        });
      }

      const state = await window.omni.tabs.listOpen();
      const openThreads = await hydrateOpenThreads(state.openThreadIds);
      const existingIds = new Set(openThreads.map((thread) => thread.id));
      const openThreadIds = state.openThreadIds.filter((id) => existingIds.has(id));
      set({
        ...state,
        openThreadIds,
        activeThreadId:
          state.activeThreadId && existingIds.has(state.activeThreadId)
            ? state.activeThreadId
            : (openThreadIds[0] ?? null),
        openThreads,
        isLoading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to restore open tabs",
        isLoading: false,
      });
    }
  },

  openThread: async (threadId) => {
    const state = await window.omni.tabs.open(threadId);
    await get().recordExternalState(state);
  },

  closeThread: async (threadId) => {
    const state = await window.omni.tabs.close(threadId);
    await get().recordExternalState(state);
    return state;
  },

  setActiveThread: async (threadId) => {
    const state = await window.omni.tabs.setActive(threadId);
    await get().recordExternalState(state);
  },

  recordExternalState: async (state) => {
    const openThreads = await hydrateOpenThreads(state.openThreadIds);
    const existingIds = new Set(openThreads.map((thread) => thread.id));
    const openThreadIds = state.openThreadIds.filter((id) => existingIds.has(id));
    set({
      ...state,
      openThreadIds,
      activeThreadId:
        state.activeThreadId && existingIds.has(state.activeThreadId)
          ? state.activeThreadId
          : (openThreadIds[0] ?? null),
      openThreads,
      isLoading: false,
      error: null,
    });
  },

  updateThread: (thread) => {
    set((state) => ({
      openThreads: state.openThreads.map((item) => (item.id === thread.id ? thread : item)),
    }));
  },

  removeThread: (threadId) => {
    set((state) => {
      const openThreadIds = state.openThreadIds.filter((id) => id !== threadId);
      return {
        openThreadIds,
        openThreads: state.openThreads.filter((thread) => thread.id !== threadId),
        activeThreadId:
          state.activeThreadId === threadId ? (openThreadIds[0] ?? null) : state.activeThreadId,
      };
    });
  },
}));
