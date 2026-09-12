import type { Project } from "../../contracts/projects.ts";
import type { WorkspacePrComment } from "../../contracts/git.ts";
import { normalizeWorkspacePath } from "../../contracts/workspace-scope.ts";
import { useAgentStore } from "@/store/agent-store";
import { useThreadStore } from "@/store/thread-store";
import { useWorkspaceViewStore } from "@/store/workspace-view-store";
import { selectThread } from "@/lib/thread-actions";

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
 * Commit (and optionally push) via the agent instead of a raw `git commit`:
 * repos gate commits with hooks (format, lint, tests) that only an agent in
 * that codebase can satisfy. Never lets it skip hooks.
 */
export function buildCommitPrompt(input: { branch: string | null; push: boolean }): string {
  const branch = input.branch ? `\`${input.branch}\`` : "the current branch";
  const lines = [
    `Commit all current changes in this workspace on ${branch}.`,
    "Stage everything (including new files), write a concise commit message that describes what changed, and commit.",
    "If a pre-commit hook or check fails (formatting, lint, type errors, tests), fix the underlying problem, re-stage, and commit again. Do not bypass hooks with --no-verify.",
  ];
  if (input.push) {
    lines.push(
      "Then push the branch to origin, setting the upstream if it has none. If a pre-push hook fails, fix it and push again.",
      "Finish by reporting the commit hash and whether the push succeeded.",
    );
  } else {
    lines.push("Do not push. Finish by reporting the commit hash.");
  }
  return lines.join("\n");
}

/**
 * Hand PR comments (review threads, bot reviews) to the agent to address.
 * Inline comments carry their file:line so the agent can go straight there.
 */
export function buildPrCommentsPrompt(input: {
  prNumber: number;
  comments: WorkspacePrComment[];
}): string {
  const header =
    input.comments.length === 1
      ? `Address this comment from PR #${input.prNumber}:`
      : `Address these ${input.comments.length} comments from PR #${input.prNumber}:`;
  const blocks = input.comments.map((comment) => {
    const where = comment.path
      ? ` on ${comment.path}${comment.line ? `:${comment.line}` : ""}`
      : "";
    return `--- @${comment.author}${where}\n${comment.body.trim()}`;
  });
  return [
    header,
    "",
    ...blocks,
    "",
    "For each one: make the change if it is valid, or explain briefly why not. Do not commit.",
  ].join("\n");
}
