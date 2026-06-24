import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { UpdatePhase, UpdateState } from "../contracts/updates.ts";

const TRANSITIONS: Record<UpdatePhase, readonly UpdatePhase[]> = {
  idle: ["available", "failed"],
  available: ["scheduled", "preparing", "idle", "failed"],
  scheduled: ["preparing", "available", "idle", "failed"],
  preparing: ["fetching-upstream", "failed", "idle"],
  "fetching-upstream": ["agent-running", "failed", "idle"],
  "agent-running": ["installing-dependencies", "failed", "idle"],
  "installing-dependencies": ["validating", "failed", "idle"],
  validating: ["ready-to-promote", "failed", "idle"],
  "ready-to-promote": ["promoting", "failed", "idle"],
  promoting: ["awaiting-health-check", "rolling-back", "failed"],
  "awaiting-health-check": ["completed", "rolling-back", "failed"],
  completed: ["idle", "available"],
  failed: ["idle", "available", "preparing", "rolling-back"],
  "rolling-back": ["failed", "idle"],
};

export function createIdleUpdateState(): UpdateState {
  return {
    phase: "idle",
    updated_at: new Date().toISOString(),
    scheduled_for_quit: false,
    error: null,
    run_id: null,
  };
}

export function assertUpdateTransition(from: UpdatePhase, to: UpdatePhase): void {
  if (from === to) return;
  if (!TRANSITIONS[from].includes(to))
    throw new Error(`Invalid update transition: ${from} -> ${to}`);
}

export function readUpdateState(path: string): UpdateState {
  if (!existsSync(path)) return createIdleUpdateState();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<UpdateState>;
    return {
      ...createIdleUpdateState(),
      phase: parsed.phase ?? "idle",
      updated_at: parsed.updated_at ?? new Date().toISOString(),
      scheduled_for_quit: parsed.scheduled_for_quit ?? false,
      error: parsed.error ?? null,
      run_id: parsed.run_id ?? null,
    };
  } catch (error) {
    throw new Error(
      `Update state is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function writeUpdateStateAtomic(path: string, state: UpdateState): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  const fd = openSync(temporaryPath, "w", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporaryPath, path);
}
