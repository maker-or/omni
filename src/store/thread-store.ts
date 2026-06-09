import { create } from "zustand";
import type { Thread } from "../../contracts/threads.ts";

interface ThreadState {
  threads: Thread[];
  activeThreadId: string | null;
  isLoading: boolean;
  error: string | null;
  loadThreads: () => Promise<void>;
  setActiveThreadId: (id: string | null) => void;
  createThread: (projectId: string, title: string) => Promise<Thread | null>;
  deleteThread: (id: string) => Promise<void>;
}

export const useThreadStore = create<ThreadState>((set) => ({
  threads: [],
  activeThreadId: null,
  isLoading: false,
  error: null,
  loadThreads: async () => {
    set({ isLoading: true, error: null });
    try {
      const list = await window.omni.threads.list();
      set({ threads: list, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to load threads",
        isLoading: false,
      });
    }
  },
  setActiveThreadId: (id) => set({ activeThreadId: id }),
  createThread: async (projectId, title) => {
    try {
      const thread = await window.omni.threads.create(projectId, title);
      set((state) => ({
        threads: [...state.threads, thread],
        activeThreadId: thread.id,
      }));
      return thread;
    } catch (err) {
      console.error("Failed to create thread:", err);
      return null;
    }
  },
  deleteThread: async (id) => {
    try {
      await window.omni.threads.delete(id);
      set((state) => {
        const nextThreads = state.threads.filter((t) => t.id !== id);
        let nextActiveId = state.activeThreadId;
        if (state.activeThreadId === id) {
          nextActiveId = nextThreads.length > 0 ? nextThreads[0].id : null;
        }
        return {
          threads: nextThreads,
          activeThreadId: nextActiveId,
        };
      });
    } catch (err) {
      console.error("Failed to delete thread:", err);
    }
  },
}));
