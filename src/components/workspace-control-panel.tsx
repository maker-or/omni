import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowUpRight,
  ArrowsClockwise,
  CheckCircle,
  GitBranch,
  GitCommit,
  GitPullRequest,
  WarningCircle,
} from "@phosphor-icons/react";
import type { Project } from "../../contracts/projects.ts";
import type { WorkspaceGitStatus, WorkspacePrComment } from "../../contracts/git.ts";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  buildCommitPrompt,
  buildPrCommentsPrompt,
  sendWorkspaceAgentPrompt,
} from "@/lib/workspace-agent-prompt";
import { WorkspacePrDetail, type PrStatusItem } from "@/components/workspace-pr-detail";
import { SplitButton, type SplitMenuItem } from "@/components/workspace-split-button";

const POLL_MS = 15000;

function notify(kind: "ok" | "error", title: string, description?: string) {
  toast({
    icon:
      kind === "ok" ? (
        <CheckCircle className="size-5 text-emerald-500" weight="fill" />
      ) : (
        <WarningCircle className="size-5 text-destructive" weight="fill" />
      ),
    title,
    description,
  });
}

/** Human title for action toasts. */
function actionLabel(kind: string): string {
  switch (kind) {
    case "commit":
      return "Commit handed to agent";
    case "commitPush":
      return "Commit and push handed to agent";
    case "push":
      return "Pushed";
    case "pr":
      return "Pull request created";
    case "mergePr":
      return "Pull request merged";
    case "merge":
      return "Merged";
    case "ready":
      return "Ready for review";
    case "archive":
      return "Workspace archived";
    case "continue":
      return "New branch started";
    case "init":
      return "Repository initialized";
    default:
      return "Done";
  }
}

/**
 * Header tone is git truth:
 * - neutral: no PR yet (fresh worktree or work in progress)
 * - action:  PR open but something blocks merging (dirty tree, draft,
 *            checks running or failing)
 * - ready:   PR open, tree clean, checks green — merge is the next step
 * - merged:  the branch's PR landed — archive the workspace or continue on
 *            a fresh branch
 */
export type HeaderTone = "neutral" | "action" | "ready" | "merged";

function headerTone(status: WorkspaceGitStatus, dirtyCount: number): HeaderTone {
  if (!status.openPrNumber) return status.mergedPrNumber ? "merged" : "neutral";
  if (status.isDraftPr) return "action";
  if (dirtyCount > 0 || status.ahead > 0) return "action";
  if (status.checksState === "passing") return "ready";
  if (status.checksState === "none" || status.checksState === "unknown") return "ready";
  return "action";
}

/** One-line state caption shown in the header next to the action. */
function stateCaption(
  status: WorkspaceGitStatus,
  tone: HeaderTone,
  dirtyCount: number,
): string | null {
  if (tone === "merged") return "Merged";
  if (tone === "ready") return "Ready to merge";
  if (tone === "neutral") {
    if (dirtyCount > 0 || status.ahead > 0) return null;
    return status.aheadOfBase > 0 ? "Pushed — ready for a PR" : null;
  }
  if (dirtyCount > 0) return "Uncommitted changes";
  if (status.ahead > 0) return "Unpushed commits";
  if (status.isDraftPr) return "Draft PR";
  if (status.checksState === "pending") return "Checks running";
  if (status.checksState === "failing") return "Checks failing";
  return null;
}

function syncLabel(status: WorkspaceGitStatus): string | null {
  if (!status.upstream) return status.ahead > 0 ? `${status.ahead} unpushed` : "no upstream";
  const parts: string[] = [];
  if (status.ahead > 0) parts.push(`↑${status.ahead}`);
  if (status.behind > 0) parts.push(`↓${status.behind}`);
  if (parts.length === 0) return "in sync";
  return parts.join(" ");
}

/** Why PR creation is unavailable, or null when it is possible. */
function prBlocker(status: WorkspaceGitStatus): string | null {
  if (status.remoteHost !== "github.com") return "PRs need a GitHub remote";
  if (!status.ghAvailable) return "Install the GitHub CLI (gh) to create PRs";
  return null;
}

type PanelTab = "check" | "changes";

/** `#123 ↗` pill linking to the open (or just-merged) PR. */
function prPill(status: WorkspaceGitStatus) {
  const number = status.openPrNumber ?? status.mergedPrNumber;
  const url = status.openPrUrl ?? status.mergedPrUrl;
  if (!number || !url) return null;
  const suffix = status.openPrNumber ? (status.isDraftPr ? " · draft" : "") : " · merged";
  return (
    <button
      type="button"
      onClick={() => void window.omni.shell.openExternal(url)}
      title="Open pull request on GitHub"
      className="flex shrink-0 items-center overflow-hidden rounded-full bg-white/15 text-xs font-semibold text-white transition-colors hover:bg-white/25"
    >
      <span className="bg-white/20 px-2.5 py-1.5">
        #{number}
        {suffix}
      </span>
      <span className="px-2 py-1.5">
        <ArrowUpRight size={13} />
      </span>
    </button>
  );
}

export function WorkspaceControlPanel({
  project,
  worktreePath,
  workspaceName,
  onArchive,
  onContinued,
}: {
  project: Project | null;
  worktreePath: string | null;
  workspaceName: string | null;
  /** Archive the selected workspace (shell owns the archived flag). Absent for the root. */
  onArchive?: () => Promise<void> | void;
  /** Fired after "Continue" moved the worktree onto a new branch. */
  onContinued?: () => Promise<void> | void;
}) {
  const [status, setStatus] = useState<WorkspaceGitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [prTitle, setPrTitle] = useState("");
  const [showPrForm, setShowPrForm] = useState(false);
  const [prDraft, setPrDraft] = useState(false);
  const [pickedTab, setPickedTab] = useState<PanelTab | null>(null);
  /** Agent turn we handed a commit to; cleared when that turn settles. */
  const [agentTask, setAgentTask] = useState<"commit" | "commitPush" | null>(null);
  const agentTaskWorkspaceRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!project || !worktreePath) {
      setStatus(null);
      return;
    }
    if (!window.omni?.git?.status) {
      // Preload predates the git bridge (needs app restart, not just HMR).
      setStatus(null);
      setError("Git bridge missing — restart the app (bun run dev) to load it.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setStatus(await window.omni.git.status({ projectId: project.id, path: worktreePath }));
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Git status failed.");
    } finally {
      setLoading(false);
    }
  }, [project, worktreePath]);

  useEffect(() => {
    setError(null);
    setNotice(null);
    setAgentTask(null);
    setShowPrForm(false);
    setPrDraft(false);
    setPickedTab(null);
    setPrTitle(workspaceName ?? "");
    void refresh();
  }, [refresh, workspaceName]);

  useEffect(() => {
    if (!project || !worktreePath) return;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [project, worktreePath, refresh]);

  const runAction = useCallback(
    async (kind: string, fn: () => Promise<{ message: string; url?: string | null }>) => {
      if (!project || !worktreePath) return;
      setAction(kind);
      setError(null);
      setNotice(null);
      try {
        const result = await fn();
        setNotice(result.message);
        notify("ok", actionLabel(kind), result.message);
        // Opening the browser is a courtesy, not part of the action: the PR
        // exists whether or not the OS could open it.
        if (result.url && window.omni?.shell?.openExternal) {
          await window.omni.shell.openExternal(result.url).catch(() => {});
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : `${kind} failed.`;
        setError(message);
        notify("error", `${actionLabel(kind)} failed`, message);
      } finally {
        setAction(null);
        void refresh();
      }
    },
    [project, worktreePath, refresh],
  );

  const dirtyCount = (status?.staged ?? 0) + (status?.unstaged ?? 0) + (status?.untracked ?? 0);
  const unpushed = status?.ahead ?? 0;
  const busy = action !== null || agentTask !== null;
  const tone: HeaderTone = status?.isRepo ? headerTone(status, dirtyCount) : "neutral";
  // Default tab follows what the tone is about: merge/check state → Check,
  // local work → Changes.
  const tab: PanelTab =
    pickedTab ?? (tone === "ready" || tone === "merged" || dirtyCount === 0 ? "check" : "changes");
  const caption = status?.isRepo ? stateCaption(status, tone, dirtyCount) : null;

  const openPrForm = (draft: boolean) => {
    setPrDraft(draft);
    setPickedTab("changes");
    setShowPrForm(true);
  };

  /**
   * Commit via the workspace's agent, not a raw `git commit`: hooks
   * (format/lint/test) differ per repo and only the agent can fix what they
   * reject. The prompt lands in this workspace's thread; git state is
   * re-read once the agent's turn ends.
   */
  const delegateCommit = (push: boolean) => {
    if (!project || !worktreePath || !status || dirtyCount === 0 || busy) return;
    const kind = push ? "commitPush" : "commit";
    setShowPrForm(false);
    setError(null);
    setNotice(null);
    setAgentTask(kind);
    agentTaskWorkspaceRef.current = worktreePath;
    const settle = () => {
      // A workspace switch already reset the panel; don't clobber its state.
      if (agentTaskWorkspaceRef.current !== worktreePath) return;
      setAgentTask(null);
      setNotice(null);
      void refresh();
    };
    void sendWorkspaceAgentPrompt({
      project,
      worktreePath,
      title: workspaceName ? `${workspaceName}: commit` : "Commit",
      message: buildCommitPrompt({ branch: status.branch, push }),
    })
      .then(({ turn }) => {
        setNotice(push ? "Agent is committing and pushing…" : "Agent is committing…");
        notify(
          "ok",
          actionLabel(kind),
          "Watch the thread for progress; the panel updates when it finishes.",
        );
        turn.then(settle, (err) => {
          if (agentTaskWorkspaceRef.current !== worktreePath) return;
          const message = err instanceof Error ? err.message : "The agent did not finish.";
          setError(message);
          notify("error", `${actionLabel(kind)} failed`, message);
          settle();
        });
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Could not reach the agent.";
        setError(message);
        notify("error", `${actionLabel(kind)} failed`, message);
        setAgentTask(null);
      });
  };

  const runPush = () => {
    if (!project || !worktreePath || !status || busy) return;
    void runAction("push", () =>
      window.omni.git.push({ projectId: project.id, path: worktreePath }),
    );
  };

  const runMergePr = () => {
    if (!project || !worktreePath || !status?.openPrNumber || busy) return;
    if (
      !window.confirm(`Merge PR #${status.openPrNumber} on GitHub? The workspace branch is kept.`)
    )
      return;
    void runAction("mergePr", () =>
      window.omni.git.mergePr({ projectId: project.id, path: worktreePath }),
    );
  };

  const runLocalMerge = () => {
    if (!project || !worktreePath || !status?.branch || busy) return;
    if (
      !window.confirm(
        `Merge "${status.branch}" into the base branch in the project root? This does not open a PR.`,
      )
    )
      return;
    void runAction("merge", () =>
      window.omni.git.merge({ projectId: project.id, path: worktreePath }),
    );
  };

  const runMarkReady = () => {
    if (!project || !worktreePath || !status?.openPrNumber || busy) return;
    void runAction("ready", () =>
      window.omni.git.markPrReady({ projectId: project.id, path: worktreePath }),
    );
  };

  const addCommentsToChat = (comments: WorkspacePrComment[]) => {
    if (!project || !worktreePath || !status?.pr || comments.length === 0) return;
    void sendWorkspaceAgentPrompt({
      project,
      worktreePath,
      title: workspaceName ? `${workspaceName}: review comments` : "Review comments",
      message: buildPrCommentsPrompt({ prNumber: status.pr.number, comments }),
    })
      .then(() =>
        notify(
          "ok",
          comments.length === 1
            ? "Comment added to chat"
            : `${comments.length} comments added to chat`,
        ),
      )
      .catch((err) =>
        notify(
          "error",
          "Could not add to chat",
          err instanceof Error ? err.message : "Could not reach the agent.",
        ),
      );
  };

  /** Git-status checklist under the PR: each blocker with the button that clears it. */
  const prStatusItems = (status: WorkspaceGitStatus): PrStatusItem[] => {
    if (!status.pr) return [];
    if (status.pr.state === "merged") return [{ key: "merged", label: "Merged", done: true }];
    const items: PrStatusItem[] = [];
    if (status.isDraftPr) {
      items.push({
        key: "draft",
        label: "PR is in draft",
        action: {
          label: action === "ready" ? "Marking…" : "Ready for review",
          onClick: runMarkReady,
          disabled: busy,
        },
      });
    }
    if (dirtyCount > 0) {
      items.push({
        key: "dirty",
        label: `${dirtyCount} uncommitted change${dirtyCount === 1 ? "" : "s"}`,
        action: {
          label: agentTask ? "Agent working…" : "Commit and push",
          onClick: () => delegateCommit(true),
          disabled: busy,
        },
      });
    } else if (unpushed > 0) {
      items.push({
        key: "unpushed",
        label: `${unpushed} unpushed commit${unpushed === 1 ? "" : "s"}`,
        action: {
          label: action === "push" ? "Pushing…" : "Push",
          onClick: runPush,
          disabled: busy,
        },
      });
    }
    if (status.behind > 0) {
      items.push({
        key: "behind",
        label: `${status.behind} commit${status.behind === 1 ? "" : "s"} behind upstream`,
      });
    }
    if (status.checksState === "pending") items.push({ key: "checks", label: "Checks running" });
    if (status.checksState === "failing") {
      const failing = status.checks.filter((check) => check.state === "failing").length;
      items.push({
        key: "checks",
        label: `${failing} check${failing === 1 ? "" : "s"} failing`,
      });
    }
    if (items.length === 0) {
      items.push({
        key: "ready",
        label: "Ready to merge",
        done: true,
        action: {
          label: action === "mergePr" ? "Merging…" : "Merge",
          onClick: runMergePr,
          disabled: busy,
        },
      });
    }
    return items;
  };

  const runArchive = () => {
    if (!onArchive || busy) return;
    if (
      !window.confirm(
        "Archive this workspace? Installed dependencies are removed to free disk; chats and git history are kept.",
      )
    )
      return;
    void runAction("archive", async () => {
      await onArchive();
      return { message: "Workspace archived." };
    });
  };

  const runContinue = () => {
    if (!project || !worktreePath || busy) return;
    void runAction("continue", async () => {
      const worktree = await window.omni.worktrees.continue({
        projectId: project.id,
        path: worktreePath,
      });
      await onContinued?.();
      return { message: `Continuing on ${worktree.branch ?? "a new branch"}.` };
    });
  };

  /**
   * "Commit and push" when there is local work, "Push" when commits are
   * waiting, otherwise disabled. Shared by the no-PR and PR-open states.
   */
  const commitPushPrimary = (status: WorkspaceGitStatus) =>
    agentTask
      ? {
          label: "Agent working…",
          title: "The agent is committing in this workspace's thread",
          disabled: true,
          onPrimary: () => {},
        }
      : dirtyCount > 0
        ? {
            label: "Commit and push",
            title: "Ask the agent to commit and push this workspace branch",
            disabled: busy,
            onPrimary: () => delegateCommit(true),
          }
        : unpushed > 0
          ? {
              label: action === "push" ? "Pushing…" : "Push",
              title: status.upstream
                ? `Push ${unpushed} commit${unpushed === 1 ? "" : "s"}`
                : "Publish this branch",
              disabled: busy,
              onPrimary: runPush,
            }
          : {
              label: "Commit and push",
              title: "Nothing to commit or push",
              disabled: true,
              onPrimary: () => {},
            };

  const commitMenuItem: SplitMenuItem = {
    label: "Commit",
    icon: <GitCommit size={14} />,
    disabled: dirtyCount === 0 || busy,
    title: dirtyCount === 0 ? "Nothing to commit" : "Ask the agent to commit without pushing",
    onSelect: () => delegateCommit(false),
  };

  const renderStateAction = (status: WorkspaceGitStatus) => {
    if (!status.openPrNumber) {
      // Fresh worktree, nothing happened yet: no action button. It appears
      // once there is anything to act on — dirty files, unpushed commits, or
      // a pushed branch that still needs a PR.
      if (dirtyCount === 0 && unpushed === 0 && status.aheadOfBase === 0) return null;
      const blocker = prBlocker(status);
      // Pushed and clean: the next step is the PR, so it takes the primary slot
      // (and drops out of the menu — no point listing it twice).
      const prIsPrimary = dirtyCount === 0 && unpushed === 0 && !agentTask;
      const primary = prIsPrimary
        ? {
            label: action === "pr" ? "Creating…" : "Create a PR",
            title: blocker ?? "Open a pull request for this branch",
            disabled: busy || blocker !== null,
            onPrimary: () => openPrForm(false),
          }
        : commitPushPrimary(status);
      const localMergeBlocked =
        dirtyCount > 0
          ? "Commit your changes first"
          : status.aheadOfBase === 0
            ? "No commits to merge"
            : null;
      return (
        <SplitButton
          tone="neutral"
          {...primary}
          menuDisabled={busy}
          items={[
            commitMenuItem,
            ...(prIsPrimary
              ? []
              : [
                  {
                    label: "Create PR",
                    icon: <GitPullRequest size={14} />,
                    disabled: blocker !== null,
                    title: blocker ?? "Open a pull request for this branch",
                    onSelect: () => openPrForm(false),
                  },
                ]),
            {
              label: "Create draft PR",
              icon: <GitPullRequest size={14} />,
              disabled: blocker !== null,
              title: blocker ?? "Open a draft pull request for this branch",
              onSelect: () => openPrForm(true),
            },
            {
              label: "Merge locally",
              icon: <GitBranch size={14} />,
              disabled: busy || localMergeBlocked !== null,
              title:
                localMergeBlocked ??
                "Merge this branch into the base branch in the project root (no PR)",
              onSelect: runLocalMerge,
            },
          ]}
        />
      );
    }
    if (tone === "ready") {
      return (
        <button
          type="button"
          disabled={busy}
          title="Merge this pull request on GitHub"
          onClick={runMergePr}
          className="shrink-0 rounded-full bg-emerald-300/90 px-3.5 py-1.5 text-xs font-semibold text-emerald-950 transition-colors hover:bg-emerald-200 disabled:opacity-50"
        >
          {action === "mergePr" ? "Merging…" : "Merge"}
        </button>
      );
    }
    // Draft with nothing left to push: the next step is flipping the flag.
    if (status.isDraftPr && dirtyCount === 0 && unpushed === 0) {
      return (
        <button
          type="button"
          disabled={busy}
          title="Mark this draft pull request ready for review"
          onClick={runMarkReady}
          className="shrink-0 rounded-full bg-black/40 px-3.5 py-1.5 text-xs font-semibold text-amber-100 transition-colors hover:bg-black/60 disabled:opacity-50"
        >
          {action === "ready" ? "Marking…" : "Ready for review"}
        </button>
      );
    }
    // PR open but blocked: keep the commit/push control in reach; the Check
    // tab explains what is blocking (checks, draft).
    const readyItem: SplitMenuItem[] = status.isDraftPr
      ? [
          {
            label: "Ready for review",
            icon: <GitPullRequest size={14} />,
            disabled: busy,
            title: "Mark this draft pull request ready for review",
            onSelect: runMarkReady,
          },
        ]
      : [];
    return (
      <SplitButton
        tone="action"
        {...commitPushPrimary(status)}
        menuDisabled={busy}
        items={[commitMenuItem, ...readyItem]}
      />
    );
  };

  /** Merged state: Archive (primary) + Continue (secondary) side by side. */
  const renderMergedActions = () => (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        title="Start a new branch off the latest base in this same workspace"
        onClick={runContinue}
        className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/25 disabled:opacity-50"
      >
        <ArrowsClockwise size={13} />
        {action === "continue" ? "Starting…" : "Continue"}
      </button>
      <button
        type="button"
        disabled={busy || !onArchive}
        title={
          onArchive
            ? "Archive this workspace and remove its installed dependencies"
            : "The project root cannot be archived"
        }
        onClick={runArchive}
        className="flex items-center gap-1.5 rounded-full bg-violet-200/90 px-3.5 py-1.5 text-xs font-semibold text-violet-950 transition-colors hover:bg-violet-100 disabled:opacity-50"
      >
        <Archive size={13} />
        {action === "archive" ? "Archiving…" : "Archive"}
      </button>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      {!project || !worktreePath ? (
        <div className="flex h-12 shrink-0 items-center px-4 text-xs font-semibold text-foreground">
          Workflow
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-4">
        {!project || !worktreePath ? (
          <p className="px-4 text-xs leading-5 text-muted-foreground">
            Select a workspace to see its git state.
          </p>
        ) : !status ? (
          <div className="flex flex-col gap-2 px-4 pt-3">
            <p className="text-xs leading-5 text-muted-foreground">
              {loading ? "Reading git state…" : "Git state unavailable."}
            </p>
            {error && (
              <p className="text-[11px] leading-4 text-destructive" role="alert">
                {error}
              </p>
            )}
            {!loading && (
              <Button type="button" size="sm" variant="ghost" onClick={() => void refresh()}>
                Retry
              </Button>
            )}
          </div>
        ) : !status.isRepo ? (
          <div className="flex flex-col gap-2 px-4 pt-3">
            <p className="text-xs leading-5 text-muted-foreground">
              This workspace is not inside a git repository.
            </p>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() =>
                void runAction("init", async () => {
                  const user = await window.omni.launch.getUser().catch(() => null);
                  // Identity comes from the signed-in account; stored as
                  // repo-local config so global git identity is never touched.
                  return window.omni.git.init({
                    projectId: project.id,
                    name: user?.name,
                    email: user?.email,
                  });
                })
              }
            >
              {action === "init" ? "Initializing…" : "Initialize git repo"}
            </Button>
          </div>
        ) : (
          <>
            {/* Gradient state header: PR pill + state action, Check/Changes tabs. */}
            <div
              className={cn(
                "shrink-0 rounded-tr-[28px] bg-gradient-to-b px-4 pb-3 pt-4",
                tone === "ready" && "from-emerald-500/80 via-emerald-900/25 to-transparent",
                tone === "action" && "from-amber-500/70 via-amber-900/25 to-transparent",
                tone === "merged" && "from-violet-500/80 via-violet-900/25 to-transparent",
                tone === "neutral" && "from-zinc-300/50 via-zinc-600/20 to-transparent",
              )}
            >
              <div className="flex items-center gap-2">
                {prPill(status)}
                {caption ? (
                  <span className="min-w-0 truncate text-xs font-medium text-white/80">
                    {caption}
                  </span>
                ) : null}
                <div className="min-w-0 flex-1" />
                {tone === "merged" ? renderMergedActions() : renderStateAction(status)}
              </div>
              <div className="mt-3 flex items-center gap-4 text-[19px] font-medium leading-6">
                {(["check", "changes"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPickedTab(value)}
                    className={cn(
                      "capitalize transition-colors",
                      tab === value ? "text-white" : "text-white/35 hover:text-white/60",
                    )}
                  >
                    {value === "check" ? "Check" : "Changes"}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 px-4 pt-3">
              {tab === "check" ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <GitBranch size={13} className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{status.branch ?? "detached"}</span>
                    {syncLabel(status) && (
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {syncLabel(status)}
                      </span>
                    )}
                  </div>
                  {status.pr ? (
                    <WorkspacePrDetail
                      status={status}
                      items={prStatusItems(status)}
                      onAddComments={status.pr.state === "open" ? addCommentsToChat : undefined}
                    />
                  ) : status.openPrNumber ? (
                    <p className="text-xs leading-5 text-muted-foreground">
                      Could not load details for PR #{status.openPrNumber}.
                    </p>
                  ) : (
                    <p className="text-xs leading-5 text-muted-foreground">
                      No pull request for this branch yet.
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {dirtyCount === 0 ? (
                    <p className="text-xs leading-5 text-muted-foreground">
                      Working tree is clean.
                    </p>
                  ) : (
                    <div className="text-[11px] text-muted-foreground">
                      <span>
                        {status.staged > 0 && `${status.staged} staged · `}
                        {status.unstaged > 0 && `${status.unstaged} modified · `}
                        {status.untracked > 0 && `${status.untracked} untracked`}
                      </span>
                    </div>
                  )}
                  {status.files.length > 0 && (
                    <ul className="flex flex-col gap-0.5">
                      {status.files.slice(0, 12).map((file) => (
                        <li
                          key={file.path}
                          className="truncate text-[11px] leading-4 text-muted-foreground"
                          title={file.path}
                        >
                          <span
                            className={cn(
                              "mr-1.5 inline-block w-14 shrink-0",
                              file.status === "untracked" && "text-muted-foreground/70",
                              file.status === "deleted" && "text-destructive",
                              file.status === "added" && "text-emerald-500",
                              (file.status === "modified" || file.status === "renamed") &&
                                "text-amber-500",
                            )}
                          >
                            {file.staged ? "staged" : file.status}
                          </span>
                          {file.path}
                        </li>
                      ))}
                      {status.files.length > 12 && (
                        <li className="text-[11px] text-muted-foreground/70">
                          +{status.files.length - 12} more{status.truncated ? " (truncated)" : ""}
                        </li>
                      )}
                    </ul>
                  )}
                  {showPrForm ? (
                    <>
                      {dirtyCount > 0 ? (
                        <p className="text-[11px] leading-4 text-amber-500">
                          Uncommitted changes are not included — commit first to add them.
                        </p>
                      ) : null}
                      <input
                        value={prTitle}
                        onChange={(event) => setPrTitle(event.target.value)}
                        placeholder="PR title"
                        disabled={busy}
                        className="h-8 rounded-md border border-border bg-surface-2 px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-foreground/50"
                      />
                      <div className="flex gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setShowPrForm(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="primary"
                          className="flex-1"
                          disabled={busy || prBlocker(status) !== null}
                          onClick={() =>
                            // A PR covers the whole branch: push any local commits
                            // first so all of them land in the PR.
                            void runAction("pr", async () => {
                              if (!status.upstream || status.ahead > 0) {
                                await window.omni.git.push({
                                  projectId: project.id,
                                  path: worktreePath,
                                });
                              }
                              return window.omni.git.createPr({
                                projectId: project.id,
                                path: worktreePath,
                                title:
                                  prTitle.trim() || status.branch || workspaceName || "Workspace",
                                draft: prDraft,
                              });
                            }).then(() => setShowPrForm(false))
                          }
                        >
                          {action === "pr"
                            ? "Creating…"
                            : prDraft
                              ? "Create draft PR"
                              : "Create PR"}
                        </Button>
                      </div>
                    </>
                  ) : null}
                </div>
              )}

              {error && (
                <p className="text-[11px] leading-4 text-destructive" role="alert">
                  {error}
                </p>
              )}
              {notice && (
                <p className="text-[11px] leading-4 text-emerald-500" role="status">
                  {notice}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
