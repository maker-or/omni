/**
 * First-party git state for the advanced workspace UI. One workspace =
 * one worktree, so every query is scoped to a worktree path.
 */

export interface WorkspaceGitFile {
  path: string;
  staged: boolean;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
}

export interface WorkspaceGitStatus {
  /** False when the path is not inside a git repo (or git is missing). */
  isRepo: boolean;
  branch: string | null;
  /** Upstream of the current branch, e.g. "origin/pipper/foo". */
  upstream: string | null;
  /**
   * Commits not yet published. With an upstream this is the usual
   * ahead-of-@{u} count; without one it is the count beyond the base branch
   * (what a first push would publish).
   */
  ahead: number;
  behind: number;
  /**
   * Commits on this branch beyond the base branch (origin default, else
   * main). Distinguishes "pushed, nothing to do yet" from "pushed, ready
   * for a PR" — `ahead` alone reads 0 for both once in sync.
   */
  aheadOfBase: number;
  staged: number;
  unstaged: number;
  untracked: number;
  /** Capped file list for the panel (newest/significant first). */
  files: WorkspaceGitFile[];
  truncated: boolean;
  /** Remote URL host (github.com, …) when a remote exists. */
  remoteHost: string | null;
  /** True when the `gh` CLI is available for PR operations. */
  ghAvailable: boolean;
  /** Existing open PR number for the branch, when known. */
  openPrNumber: number | null;
  openPrUrl: string | null;
  /** True when the open PR is a draft. */
  isDraftPr: boolean;
  /**
   * Most recent merged PR for the branch, only reported when no PR is open.
   * Drives the "merged — archive or continue" state.
   */
  mergedPrNumber: number | null;
  mergedPrUrl: string | null;
  /** Aggregate CI state for the open PR. `none` = no check runs reported. */
  checksState: "unknown" | "none" | "pending" | "passing" | "failing";
  /** Per-check detail for the open PR's head commit (deduped by name, latest run). */
  checks: WorkspacePrCheck[];
  /** Rich detail for the open PR, or the merged one when nothing is open. */
  pr: WorkspacePr | null;
}

export type WorkspacePrCheckState = "pending" | "passing" | "failing" | "skipped";

export interface WorkspacePrCheck {
  name: string;
  state: WorkspacePrCheckState;
  /** Run length when the check has both timestamps. */
  durationMs: number | null;
  url: string | null;
}

export interface WorkspacePrDeployment {
  environment: string;
  state: "pending" | "success" | "failure" | "inactive";
  url: string | null;
}

export interface WorkspacePrComment {
  id: string;
  author: string;
  avatarUrl: string | null;
  /** Full body, capped; the panel shows a one-line preview. */
  body: string;
  url: string | null;
  createdAt: string;
  /** Set for inline review comments. */
  path: string | null;
  line: number | null;
}

/** What the panel shows for a filed (draft or ready) or merged PR. */
export interface WorkspacePr {
  number: number;
  url: string;
  title: string;
  body: string;
  isDraft: boolean;
  state: "open" | "merged";
  deployments: WorkspacePrDeployment[];
  /** Issue comments then review-thread openers, oldest first, capped. */
  comments: WorkspacePrComment[];
}

export interface WorkspaceGitActionResult {
  ok: boolean;
  message: string;
  /** PR URL for create-pr. */
  url?: string | null;
}
