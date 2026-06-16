import { create } from "zustand";
import type { Thread } from "../../contracts/threads.ts";

const THREAD_PAGE_SIZE = 10;

interface ProjectThreadPageState {
  nextOffset: number;
  hasMore: boolean;
  isLoading: boolean;
}

interface ThreadState {
  threads: Thread[];
  pagesByProject: Record<string, ProjectThreadPageState>;
  /** IDs of threads that have been explicitly deleted — used to close open tabs. */
  deletedThreadIds: Set<string>;
  isLoading: boolean;
  error: string | null;
  loadThreads: () => Promise<void>;
  loadProjectThreads: (projectId: string, options?: { reset?: boolean }) => Promise<void>;
  createThread: (projectId: string, title: string) => Promise<Thread | null>;
  renameThread: (id: string, title: string) => Promise<Thread | null>;
  deleteThread: (id: string) => Promise<void>;
  addThread: (thread: Thread) => void;
}

export const useThreadStore = create<ThreadState>((set) => ({
  threads: [],
  pagesByProject: {},
  deletedThreadIds: new Set<string>(),
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
  loadProjectThreads: async (projectId, options) => {
    const reset = options?.reset ?? false;
    let offset = 0;
    let shouldLoad = true;

    set((state) => {
      const current = state.pagesByProject[projectId];
      offset = reset ? 0 : (current?.nextOffset ?? 0);
      shouldLoad = reset || current == null || current.hasMore;

      if (!shouldLoad || current?.isLoading) {
        shouldLoad = false;
        return {};
      }

      return {
        error: null,
        pagesByProject: {
          ...state.pagesByProject,
          [projectId]: {
            nextOffset: offset,
            hasMore: current?.hasMore ?? true,
            isLoading: true,
          },
        },
      };
    });

    if (!shouldLoad) return;

    try {
      const page = await window.omni.threads.listProject({
        projectId,
        limit: THREAD_PAGE_SIZE,
        offset,
      });

      set((state) => {
        const remainingThreads = reset
          ? state.threads.filter((thread) => thread.project_id !== projectId)
          : state.threads.filter((thread) => !page.threads.some((item) => item.id === thread.id));
        return {
          threads: [...remainingThreads, ...page.threads],
          pagesByProject: {
            ...state.pagesByProject,
            [projectId]: {
              nextOffset: page.nextOffset,
              hasMore: page.hasMore,
              isLoading: false,
            },
          },
        };
      });
    } catch (err) {
      set((state) => ({
        error: err instanceof Error ? err.message : "Failed to load threads",
        pagesByProject: {
          ...state.pagesByProject,
          [projectId]: {
            nextOffset: offset,
            hasMore: true,
            isLoading: false,
          },
        },
      }));
    }
  },
  createThread: async (projectId, title) => {
    try {
      const thread = await window.omni.threads.create(projectId, title);
      set((state) => ({
        threads: [thread, ...state.threads.filter((item) => item.id !== thread.id)],
        pagesByProject: {
          ...state.pagesByProject,
          [projectId]: {
            nextOffset: (state.pagesByProject[projectId]?.nextOffset ?? 0) + 1,
            hasMore: state.pagesByProject[projectId]?.hasMore ?? false,
            isLoading: false,
          },
        },
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
      set((state) => ({
        threads: state.threads.filter((t) => t.id !== id),
        // Track deleted IDs so open tabs can be closed correctly
        deletedThreadIds: new Set([...state.deletedThreadIds, id]),
      }));
    } catch (err) {
      console.error("Failed to delete thread:", err);
    }
  },
  addThread: (thread) => {
    set((state) => ({
      threads: [thread, ...state.threads.filter((t) => t.id !== thread.id)],
      pagesByProject: {
        ...state.pagesByProject,
        [thread.project_id]: {
          nextOffset: (state.pagesByProject[thread.project_id]?.nextOffset ?? 0) + 1,
          hasMore: state.pagesByProject[thread.project_id]?.hasMore ?? false,
          isLoading: false,
        },
      },
    }));
  },
}));
