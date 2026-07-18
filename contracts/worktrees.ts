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
