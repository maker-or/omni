import { app } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const FILE_NAME = "launch-state.json";

export interface LaunchState {
  completed: boolean;
  completedAt: string | null;
  projectId: string | null;
}

const DEFAULT_STATE: LaunchState = {
  completed: false,
  completedAt: null,
  projectId: null,
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
  });
}
