import type { Project } from "../../contracts/projects.ts";
import type { WorkspacePrComment } from "../../contracts/git.ts";
import { normalizeWorkspacePath } from "../../contracts/workspace-scope.ts";
import { useAgentStore } from "@/store/agent-store";
import { useThreadStore } from "@/store/thread-store";
import { useWorkspaceViewStore } from "@/store/workspace-view-store";
import { selectThread } from "@/lib/thread-actions";
import { composeSkillPrompt, contextBlock, encodeContextString } from "@/lib/git-skills";

/**
 * Hand a task to the agent in a workspace's own thread. Reuses the thread
 * the user is looking at when it is bound to that workspace; otherwise starts
 * a fresh one there so the prompt never lands in another worktree's session.
 *
 * Resolves as soon as the prompt is dispatched (optimistic bubble shown).
 * `turn` settles when the agent finishes the whole turn — callers that
 * depend on the outcome (e.g. re-reading git state) wait on that instead.
 */
export async function sendWorkspaceAgentPrompt(input: {
  project: Project;
  worktreePath: string | null;
  message: string;
  /** Title for a thread created on the caller's behalf. */
  title: string;
}): Promise<{ threadId: string; turn: Promise<void> }> {
  const { project, message, title } = input;
  const workspacePath = normalizeWorkspacePath(input.worktreePath, project.path);
  const agent = useAgentStore.getState();
  const snapshot = agent.snapshot;
  const currentInWorkspace =
    snapshot?.threadId &&
    snapshot.projectId === project.id &&
    normalizeWorkspacePath(snapshot.cwd, project.path) === workspacePath;

  let threadId = currentInWorkspace ? snapshot.threadId : null;
  let midTurn = currentInWorkspace ? snapshot.isStreaming : false;
  if (!threadId) {
    const thread = await agent.createThread(project.id, title, null, null, workspacePath);
    await useThreadStore.getState().loadProjectThreads(project.id, { reset: true });
    await selectThread(thread.id);
    threadId = thread.id;
    midTurn = false;
  } else {
    useWorkspaceViewStore.getState().showAgent();
  }

  // The ACP call resolves only when the turn ends; a busy agent gets the
  // task queued as a follow-up rather than interrupting its current work.
  const turn = useAgentStore.getState().sendPrompt({
    threadId,
    message,
    streamingBehavior: midTurn ? "followUp" : undefined,
  });
  return { threadId, turn };
}

/**
 * Paths that must never be committed on the user's behalf: env files,
 * private keys, credential stores and the like. Matched on the basename at
 * any depth. `.env.example`-style templates are deliberately allowed — they
 * exist to be committed.
 */
const SECRET_PATH_PATTERN =
  /(^|\/)(\.env(?!\.(example|sample|template|dist)$)(\..*)?|\.envrc|.*\.(pem|key|p12|pfx|jks|keystore)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.npmrc|\.pypirc|\.netrc|credentials(\.json)?|secrets?(\.ya?ml|\.json)?|service-account.*\.json)$/i;

/** True when a changed path looks like a secret and must not be staged. */
export function looksLikeSecretPath(path: string): boolean {
  return SECRET_PATH_PATTERN.test(path.replace(/\\/g, "/"));
}

/**
 * Commit (and optionally push) via the agent instead of a raw `git commit`:
 * repos gate commits with hooks (format, lint, tests) that only an agent in
 * that codebase can satisfy. The protocol lives in `skills/git/commit.md`;
 * this only supplies the facts.
 *
 * Staging is an explicit path list, not `git add -A`: the panel already knows
 * every changed path, so it hands the agent exactly what to stage and holds
 * back anything that looks like a secret. Only when the list was truncated
 * does the agent get a review-and-stage instruction instead.
 */
export function buildCommitPrompt(input: {
  branch: string | null;
  push: boolean;
  /** Every changed path (staged, unstaged, untracked) the panel knows about. */
  files?: string[];
  /** True when `files` was capped and does not cover the whole tree. */
  truncated?: boolean;
}): string {
  const branch = input.branch ? `\`${input.branch}\`` : "the current branch";
  const files = input.files ?? [];
  const complete = files.length > 0 && !input.truncated;
  return composeSkillPrompt({
    skill: "commit",
    task: `Commit the current changes in this workspace on ${branch}${input.push ? " and push" : ""}.`,
    context: contextBlock({
      branch: input.branch,
      push: input.push,
      "files-list-complete": complete,
      "files-to-stage": complete ? files.filter((file) => !looksLikeSecretPath(file)) : undefined,
      "files-that-look-like-secrets": files.filter(looksLikeSecretPath),
    }),
  });
}

/**
 * Catch a workspace up with its base branch, via the agent.
 *
 * Merging is delegated rather than run as a plain `git merge` because the
 * interesting case is the conflicted one: resolving it needs to understand
 * both sides, re-run the project's checks, and explain the result — none of
 * which the panel can do. The protocol lives in `skills/git/get-latest.md`.
 */
export function buildGetLatestPrompt(input: {
  branch: string | null;
  /** Ref the base counts were measured against, e.g. "origin/main". */
  baseBranch: string | null;
  /** Commits on the base this workspace does not have yet. */
  behindBase: number;
  /** Uncommitted paths that must be committed before the merge. */
  files?: string[];
}): string {
  const base = input.baseBranch ?? "origin/main";
  const files = input.files ?? [];
  return composeSkillPrompt({
    skill: "get-latest",
    task: `Bring this workspace up to date with ${base.replace(/^origin\//, "")}.`,
    context: contextBlock({
      branch: input.branch,
      "base-ref": base,
      "commits-behind-base": input.behindBase,
      "uncommitted-paths": files,
    }),
  });
}

const COMMENT_OPEN = "<<<pr-comment";
const COMMENT_CLOSE = ">>>";

/**
 * Hand PR comments (review threads, bot reviews) to the agent to address.
 * The protocol lives in `skills/git/address-review.md`; this supplies the
 * comments. Inline comments carry their file:line so the agent can go
 * straight there.
 *
 * Comment bodies come from anyone who can write on the PR, so they are
 * fenced as untrusted data: the skill tells the agent they are feedback to
 * evaluate, never instructions. A body containing the closing fence is
 * neutralized so it cannot break out of its block.
 */
export function buildPrCommentsPrompt(input: {
  prNumber: number;
  comments: WorkspacePrComment[];
}): string {
  const task =
    input.comments.length === 1
      ? `Address this review comment from PR #${input.prNumber}.`
      : `Address these ${input.comments.length} review comments from PR #${input.prNumber}.`;
  const blocks = input.comments.map((comment) => {
    // The path is repository-controlled and may carry newlines, which would
    // let it end the header line and forge text outside the fenced body.
    const where = comment.path
      ? ` on ${encodeContextString(comment.path)}${comment.line ? `:${comment.line}` : ""}`
      : "";
    const body = comment.body.trim().split(COMMENT_CLOSE).join("> > >");
    return `${COMMENT_OPEN} author=@${comment.author}${where}\n${body}\n${COMMENT_CLOSE}`;
  });
  return composeSkillPrompt({
    skill: "address-review",
    task,
    context: [contextBlock({ "pull-request": `#${input.prNumber}` }), "", ...blocks].join("\n"),
  });
}
