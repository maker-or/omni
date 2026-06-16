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
}

const DEFAULT_STATE: LaunchState = {
  completed: false,
  completedAt: null,
  projectId: null,
  threadId: null,
  openThreadIds: [],
  activeThreadId: null,
  threadSwitchHistory: [],
};

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
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function writeLaunchState(state: LaunchState): Promise<void> {
  const file = statePath();
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2), "utf-8");
}

export async function markLaunchComplete(projectId: string): Promise<void> {
  await writeLaunchState({
    completed: true,
    completedAt: new Date().toISOString(),
    projectId,
    threadId: null,
    openThreadIds: [],
    activeThreadId: null,
    threadSwitchHistory: [],
  });
}

export async function updateLaunchSelection(selection: {
  projectId?: string | null;
  threadId?: string | null;
}): Promise<void> {
  const current = await readLaunchState();
  await writeLaunchState({
    ...current,
    projectId: selection.projectId !== undefined ? selection.projectId : current.projectId,
    threadId: selection.threadId !== undefined ? selection.threadId : current.threadId,
    activeThreadId: selection.threadId !== undefined ? selection.threadId : current.activeThreadId,
  });
}
