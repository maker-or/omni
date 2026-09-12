/**
 * A git worktree ("workspace") nested under a project — an isolated working
 * directory on its own branch, sharing the project's git history.
 *
 * Git owns identity via path/branch, so there is deliberately no `id`: a
 * worktree is the shape of a parsed `git worktree list --porcelain` entry.
 */
export interface Worktree {
  /** Absolute path to the worktree's working directory. */
  path: string;
  /** Short branch ref checked out in the worktree, or null when detached. */
  branch: string | null;
  /** HEAD commit SHA. */
  head: string;
  /** True when this entry is the project's configured root checkout. */
  isProjectRoot?: boolean;
  /** Git-derived label for this workspace (the default branch for the root). */
  workspaceName?: string;
  /**
   * Worktree directory creation time (ms). `git worktree list` emits readdir
   * order (effectively arbitrary), so UIs sort newest-first on this instead.
   * Absent for the project root and when the filesystem reports nothing.
   */
  createdAtMs?: number;
}

/**
 * A local Git branch (`refs/heads/*`) selectable in the title bar. Phase 1 is
 * local-only; remote branches are a later addition (they'd need checking out as
 * a tracking branch on selection, which `switchWorktreeBranch` doesn't do yet).
 */
export interface GitBranch {
  /** Display name, e.g. `feature/titlebar`. */
  name: string;
  /** The worktree currently holding this branch, if Git reports one. */
  worktreePath: string | null;
}

export interface CreateWorktreeInput {
  projectId: string;
  /** Human label; used to derive the on-disk dir name and default branch. */
  name: string;
}

/**
 * Newest-first for linked worktrees (project root always pins top).
 * `git worktree list` emits readdir order, so creation order must come from
 * `createdAtMs`; entries without it keep git's relative order at the end.
 */
export function orderWorktreesForDisplay(worktrees: Worktree[]): Worktree[] {
  const root = worktrees.filter((item) => item.isProjectRoot);
  const rest = worktrees
    .filter((item) => !item.isProjectRoot)
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const at = a.item.createdAtMs ?? -1;
      const bt = b.item.createdAtMs ?? -1;
      if (at !== bt) return bt - at;
      return a.index - b.index;
    })
    .map(({ item }) => item);
  return [...root, ...rest];
}

/**
 * Progress of the background dependency install that follows a worktree
 * create, broadcast to the renderer for toasts. `skipped` means the project
 * has no Node dependency manifest.
 */
export interface WorktreeSetupProgress {
  projectId: string;
  worktreePath: string;
  workspaceName: string;
  status: "installing" | "installed" | "failed" | "skipped";
  /** Package manager used (bun/pnpm/yarn/npm) when installing. */
  manager?: string;
  /** Failure detail (last lines of install output). */
  message?: string;
}
