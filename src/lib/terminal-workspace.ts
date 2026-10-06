import type { AcpSessionState } from "../../contracts/acp.ts";
import type { Project } from "../../contracts/projects.ts";

/** Basic UI follows the live thread; advanced UI follows the workspace picker. */
export function resolveTerminalWorkspace(input: {
  preferThread: boolean;
  thread: Pick<AcpSessionState, "threadId" | "projectId" | "cwd"> | null;
  project: Pick<Project, "id" | "path"> | null;
  selectedPath: string | null | undefined;
}): { projectId: string; cwd: string } | null {
  const { preferThread, thread, project, selectedPath } = input;
  if (preferThread && thread?.threadId && thread.projectId && thread.cwd) {
    return { projectId: thread.projectId, cwd: thread.cwd };
  }
  if (!project) return null;
  return { projectId: project.id, cwd: selectedPath || project.path };
}
