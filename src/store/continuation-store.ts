import { create } from "zustand";

/**
 * Holds the carry-over transcript for a `/continue`-created thread until the
 * user sends their first message (or dismisses it). Keyed by the new thread's
 * id. In-memory only: an abandoned continuation simply reopens as an ordinary
 * empty thread after a restart. Cleared on send, chip dismissal, and thread
 * deletion so no stale entry survives.
 */
interface ContinuationState {
  pendingByThreadId: Record<string, string>;
  setPending: (threadId: string, transcript: string) => void;
  clearPending: (threadId: string) => void;
  getPending: (threadId: string) => string | null;
}

export const useContinuationStore = create<ContinuationState>((set, get) => ({
  pendingByThreadId: {},
  setPending: (threadId, transcript) =>
    set((state) => ({
      pendingByThreadId: { ...state.pendingByThreadId, [threadId]: transcript },
    })),
  clearPending: (threadId) =>
    set((state) => {
      if (!(threadId in state.pendingByThreadId)) return state;
      const next = { ...state.pendingByThreadId };
      delete next[threadId];
      return { pendingByThreadId: next };
    }),
  getPending: (threadId) => get().pendingByThreadId[threadId] ?? null,
}));
