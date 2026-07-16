import { useAgentStore } from "@/store/agent-store";
import { useWorkspaceViewStore } from "@/store/workspace-view-store";

/**
 * Switch the active agent thread and make the agent view the visible mode.
 *
 * Callable from anywhere (header tab strip, orchestration flow) — it reads
 * live store state via `getState()` rather than closing over React state, so
 * there is a single implementation of the optimistic-switch handshake:
 * `requestedThreadId` is set immediately, then cleared by the header once the
 * agent snapshot catches up (see `GlobalTabBar`).
 */
export async function selectThread(id: string): Promise<void> {
  const view = useWorkspaceViewStore.getState();
  view.showAgent();
  if (id === useAgentStore.getState().snapshot?.threadId) {
    view.requestThread(null);
    return;
  }
  view.requestThread(id);
  try {
    await useAgentStore.getState().switchThread(id);
  } catch (err) {
    // Clear the optimistic requestedThreadId only if it still matches the current request
    const currentRequestedId = useWorkspaceViewStore.getState().requestedThreadId;
    if (currentRequestedId === id) {
      view.requestThread(null);
    }
    throw err;
  }
}
