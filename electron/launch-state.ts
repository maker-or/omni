import { app } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const FILE_NAME = "launch-state.json";

export interface LaunchState {
  completed: boolean;
  completedAt: string | null;
  projectId: string | null;
  threadId: string | null;
  openThreadIds: string[];
  activeThreadId: string | null;
  threadSwitchHistory: string[];
  /**
   * Canonical workspace per project: the absolute path of the selected
   * worktree (the project root path when the user is on "main"). This is the
   * single persisted source of truth the header, tab scoping, and terminal
   * cwd all agree on after a relaunch.
   */
  selectedWorktreePathByProject: Record<string, string>;
}

const DEFAULT_STATE: LaunchState = {
  completed: false,
  completedAt: null,
  projectId: null,
  threadId: null,
  openThreadIds: [],
  activeThreadId: null,
  threadSwitchHistory: [],
  selectedWorktreePathByProject: {},
};

export function parseWorkspaceSelections(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const selections: Record<string, string> = {};
  for (const [projectId, path] of Object.entries(value as Record<string, unknown>)) {
    if (typeof path === "string" && path.length > 0) selections[projectId] = path;
  }
  return selections;
}

function statePath(): string {
  return join(app.getPath("userData"), FILE_NAME);
}

export async function readLaunchState(): Promise<LaunchState> {
  try {
    const raw = await readFile(statePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<LaunchState>;
    return {
      completed: parsed.completed === true,
      completedAt: typeof parsed.completedAt === "string" ? parsed.completedAt : null,
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : null,
      threadId: typeof parsed.threadId === "string" ? parsed.threadId : null,
      openThreadIds: Array.isArray(parsed.openThreadIds)
        ? parsed.openThreadIds.filter((id): id is string => typeof id === "string")
        : [],
      activeThreadId:
        typeof parsed.activeThreadId === "string"
          ? parsed.activeThreadId
          : typeof parsed.threadId === "string"
            ? parsed.threadId
            : null,
      threadSwitchHistory: Array.isArray(parsed.threadSwitchHistory)
        ? parsed.threadSwitchHistory.filter((id): id is string => typeof id === "string")
        : [],
      selectedWorktreePathByProject: parseWorkspaceSelections(parsed.selectedWorktreePathByProject),
    };
  } catch {
    return { ...DEFAULT_STATE, selectedWorktreePathByProject: {} };
  }
}

export async function writeLaunchState(state: LaunchState): Promise<void> {
  const file = statePath();
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2), "utf-8");
}

// Serializes every launch-state read-modify-write through a single in-process
// queue. Open-tabs mutations, launch selection updates, and workspace
// selection updates are independent IPC entry points that can fire
// concurrently; without this queue two overlapping calls can both read
// launch-state.json before either writes, so the last write silently drops
// the other's change.
let mutationQueue: Promise<unknown> = Promise.resolve();

export function enqueueLaunchStateMutation<T>(task: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(task, task);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function markLaunchComplete(projectId: string): Promise<void> {
  // Workspace selections survive re-launching into a project: they are the
  // per-project navigation context, not per-run tab state.
  const current = await readLaunchState();
  await writeLaunchState({
    completed: true,
    completedAt: new Date().toISOString(),
    projectId,
    threadId: null,
    openThreadIds: [],
    activeThreadId: null,
    threadSwitchHistory: [],
    selectedWorktreePathByProject: current.selectedWorktreePathByProject,
  });
}

/** Persist the canonical workspace selection for a project (null clears it). */
export async function updateWorkspaceSelection(
  projectId: string,
  worktreePath: string | null,
): Promise<void> {
  await enqueueLaunchStateMutation(async () => {
    const current = await readLaunchState();
    const selections = { ...current.selectedWorktreePathByProject };
    if (worktreePath) selections[projectId] = worktreePath;
    else delete selections[projectId];
    await writeLaunchState({ ...current, selectedWorktreePathByProject: selections });
  });
}

export async function readWorkspaceSelections(): Promise<Record<string, string>> {
  return (await readLaunchState()).selectedWorktreePathByProject;
}

export async function updateLaunchSelection(selection: {
  projectId?: string | null;
  threadId?: string | null;
}): Promise<void> {
  await enqueueLaunchStateMutation(async () => {
    const current = await readLaunchState();
    await writeLaunchState({
      ...current,
      projectId: selection.projectId !== undefined ? selection.projectId : current.projectId,
      threadId: selection.threadId !== undefined ? selection.threadId : current.threadId,
      activeThreadId:
        selection.threadId !== undefined ? selection.threadId : current.activeThreadId,
    });
  });
}
