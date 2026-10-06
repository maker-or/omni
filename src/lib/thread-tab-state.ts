import type { Thread } from "../../contracts/threads.ts";
import { isThreadInWorkspace } from "../../contracts/workspace-scope.ts";

/** Keep the displayed tab present while the persisted workspace mirror catches up. */
export function visibleWorkspaceThreadTabs(
  threads: Thread[],
  projectId: string | null,
  workspacePath: string | null,
  displayedThreadId: string | null,
  requestedThreadId: string | null,
): Thread[] {
  if (!projectId) return [];
  return threads.filter(
    (thread) =>
      thread.project_id === projectId &&
      (thread.id === displayedThreadId ||
        thread.id === requestedThreadId ||
        isThreadInWorkspace(thread, workspacePath)),
  );
}
