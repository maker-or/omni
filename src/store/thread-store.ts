import { create } from "zustand";
import type { Thread } from "../../contracts/threads.ts";

interface ThreadState {
  threads: Thread[];
  isLoading: boolean;
  error: string | null;
  loadThreads: () => Promise<void>;
  createThread: (projectId: string, title: string) => Promise<Thread | null>;
  renameThread: (id: string, title: string) => Promise<Thread | null>;
  deleteThread: (id: string) => Promise<void>;
}

export const useThreadStore = create<ThreadState>((set) => ({
  threads: [],
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
  createThread: async (projectId, title) => {
    try {
      const thread = await window.omni.threads.create(projectId, title);
      set((state) => ({
        threads: [...state.threads, thread],
      }));
      return thread;
    } catch (err) {
      console.error("Failed to create thread:", err);
      return null;
    }
  },
  renameThread: async (id, title) => {
    try {
      const thread = await window.omni.threads.rename(id, title);
      set((state) => ({
        threads: state.threads.map((item) => (item.id === id ? thread : item)),
      }));
      return thread;
    } catch (err) {
      console.error("Failed to rename thread:", err);
      return null;
    }
  },
  deleteThread: async (id) => {
    try {
      await window.omni.threads.delete(id);
      set((state) => {
        const nextThreads = state.threads.filter((t) => t.id !== id);
        return {
          threads: nextThreads,
        };
      });
    } catch (err) {
      console.error("Failed to delete thread:", err);
    }
  },
}));
