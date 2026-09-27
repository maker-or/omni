import { randomBytes } from "node:crypto";
import type { AgentManager } from "./agent-connection-manager.ts";
import { getProject } from "./projects.ts";
import { listThreads } from "./threads.ts";
import { listAgentInstanceDescriptors } from "./agent-instances.ts";
import { buildSiriCatalog } from "./siri/siri-catalog.ts";
import { createWorktree, isLiveWorktree, removeWorktreeBestEffort } from "./worktree-manager.ts";

/** All external entry points bind to a verified worktree before dispatch. */
export async function prepareIsolatedAgentTask(
  am: AgentManager,
  projectId: string,
  requestedAgentId: string | null | undefined,
  prompt: string,
) {
  const project = getProject(projectId);
  if (!project) throw new Error("Project not found. Refresh your project list.");
  // The phone/PWA sends a provider *instance* id as `modelId`
  // (listAgentInstanceDescriptors; default instances reuse the driver id), so
  // validate against live instances — not the driver-only Siri catalog — or a
  // task routed to a secondary account is wrongly rejected.
  const instances = listAgentInstanceDescriptors();
  const agentId =
    requestedAgentId ??
    instances.find((a) => a.id === buildSiriCatalog().defaultAgentId)?.id ??
    instances[0]?.id ??
    null;
  if (!agentId || !instances.some((a) => a.id === agentId)) {
    throw new Error("The selected agent is unavailable. Choose an installed agent on your Mac.");
  }
  let worktree;
  try {
    worktree = createWorktree({
      projectPath: project.path,
      projectId: project.id,
      name: `phone-${randomBytes(8).toString("hex")}`,
    });
  } catch (error) {
    throw new Error(
      `Could not create an isolated workspace. No task was started. Check that the project has a Git commit and a writable worktree directory on your Mac. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    const thread = await am.createThread(
      project.id,
      prompt.slice(0, 80),
      null,
      agentId,
      worktree.path,
      null,
      { background: true, requireWorktree: true },
    );
    if (thread.worktree_path !== worktree.path || !isLiveWorktree(worktree.path, project.path)) {
      throw new Error(
        "The thread could not bind to its isolated workspace. No prompt was sent. Check Pipper on your Mac.",
      );
    }
    return {
      threadId: thread.id,
      result: {
        thread: {
          id: thread.id,
          projectId: thread.project_id,
          worktreePath: thread.worktree_path,
          title: thread.title,
          running: true,
          lastUsedAt: thread.last_used_at,
        },
      },
      execute: () =>
        !prompt
          ? Promise.resolve()
          : am.sendPrompt(
              { threadId: thread.id, message: prompt },
              { background: true, requireWorktree: true },
            ),
    };
  } catch (error) {
    if (!listThreads().some((t) => t.worktree_path === worktree.path)) {
      removeWorktreeBestEffort(project.path, worktree.path, worktree.branch);
    }
    throw error;
  }
}
