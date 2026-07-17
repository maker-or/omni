import type { Thread } from "./threads.ts";

/**
 * Workspace-first scoping helpers shared by the main process and renderer.
 *
 * A "workspace" is either the project root (canonical form: `null`) or a
 * linked git worktree (canonical form: its absolute path). Threads store the
 * same shape in `worktree_path`, and the persisted per-project selection
 * stores a raw path (the project root path when the user is on "main"), so
 * every comparison must normalize through here.
 */

/**
 * Canonical workspace identity for a selection path: `null` for the project
 * root ("main"), the worktree path otherwise. A missing selection means the
 * user never left main.
 */
export function normalizeWorkspacePath(
  selectedPath: string | null | undefined,
  projectPath: string | null | undefined,
): string | null {
  if (!selectedPath) return null;
  if (projectPath && selectedPath === projectPath) return null;
  return selectedPath;
}

/** Whether a thread belongs to the given canonical workspace. */
export function isThreadInWorkspace(
  thread: Pick<Thread, "worktree_path">,
  workspacePath: string | null,
): boolean {
  return (thread.worktree_path ?? null) === workspacePath;
}

/**
 * Pick the thread to activate when entering a workspace. Preference order:
 *  1. the most-recently-switched-to open tab in that workspace,
 *  2. any open tab in that workspace (open-tab order),
 *  3. the most recently used thread of that workspace from history
 *     (`threads` is expected in most-recently-used-first order),
 *  4. none — the caller creates a fresh thread.
 *
 * Entering a workspace is a context change, not a thread lottery: it restores
 * the workspace's own tab set instead of collapsing to one canonical thread.
 */
export function pickWorkspaceThread(input: {
  projectId: string;
  workspacePath: string | null;
  openThreadIds: string[];
  threadSwitchHistory: string[];
  threads: Thread[];
}): Thread | null {
  const { projectId, workspacePath, openThreadIds, threadSwitchHistory, threads } = input;
  const inWorkspace = (thread: Thread): boolean =>
    thread.project_id === projectId && isThreadInWorkspace(thread, workspacePath);

  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const openInWorkspace = openThreadIds
    .map((id) => byId.get(id))
    .filter((thread): thread is Thread => Boolean(thread && inWorkspace(thread)));
  if (openInWorkspace.length > 0) {
    const open = new Map(openInWorkspace.map((thread) => [thread.id, thread]));
    for (const id of threadSwitchHistory) {
      const mru = open.get(id);
      if (mru) return mru;
    }
    return openInWorkspace[0];
  }

  return threads.find(inWorkspace) ?? null;
}
