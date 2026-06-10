import { app } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const FILE_NAME = "companion-state.json";

export interface CompanionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function statePath(): string {
  return join(app.getPath("userData"), FILE_NAME);
}

export async function readCompanionState(): Promise<CompanionBounds | null> {
  try {
    const raw = await readFile(statePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<CompanionBounds>;
    if (
      typeof parsed.x === "number" &&
      typeof parsed.y === "number" &&
      typeof parsed.width === "number" &&
      typeof parsed.height === "number"
    ) {
      return parsed as CompanionBounds;
    }
    return null;
  } catch {
    return null;
  }
}

export async function writeCompanionState(bounds: CompanionBounds): Promise<void> {
  const file = statePath();
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, JSON.stringify(bounds, null, 2), "utf-8");
}
