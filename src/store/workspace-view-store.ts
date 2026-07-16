import { create } from "zustand";

/**
 * Which primary ("global") view fills the workspace area.
 *
 * - `agent` — the active agent thread's conversation (owned by the agent
 *   store / open-tabs machinery). When the thread has diffs open it renders
 *   as a 40:60 conversation | diff split; otherwise it fills 100% width.
 * - `terminal` — a single terminal session, filling 100% width.
 *
 * Agent threads and terminals share one tab strip in the header. Only the
 * mode + which terminal is active live here; the active *thread* identity
 * stays owned by `useAgentStore`/open-tabs so its optimistic-switch logic is
 * unchanged.
 */
export type WorkspaceMode = "agent" | "terminal";

interface WorkspaceViewState {
  mode: WorkspaceMode;
  activeTerminalId: string | null;
  /**
   * Optimistic switch target while `switchThread` is in flight. The header
   * sets it the instant a tab is clicked so the conversation can show a
   * switching veil before the agent snapshot catches up; the header clears
   * it once `snapshot.threadId` matches (or the switch errors).
   */
  requestedThreadId: string | null;
  showAgent: () => void;
  showTerminal: (sessionId: string) => void;
  requestThread: (threadId: string | null) => void;
}

export const useWorkspaceViewStore = create<WorkspaceViewState>((set) => ({
  mode: "agent",
  activeTerminalId: null,
  requestedThreadId: null,
  showAgent: () => set({ mode: "agent" }),
  showTerminal: (sessionId) => set({ mode: "terminal", activeTerminalId: sessionId }),
  requestThread: (threadId) => set({ requestedThreadId: threadId }),
}));
