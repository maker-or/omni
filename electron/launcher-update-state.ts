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
import type { LauncherUpdatePhase, LauncherUpdateState } from "../contracts/launcher-updates.ts";
import { LAUNCHER_UPDATE_PHASES } from "../contracts/launcher-updates.ts";

const TRANSITIONS: Record<LauncherUpdatePhase, readonly LauncherUpdatePhase[]> = {
  idle: ["checking"],
  checking: ["idle", "available", "downloaded", "failed"],
  available: ["checking", "downloading", "idle", "failed"],
  downloading: ["available", "downloaded", "failed"],
  downloaded: ["checking", "available", "idle", "failed"],
  failed: ["checking", "available", "downloading", "downloaded", "idle"],
};

export function createIdleLauncherUpdateState(currentVersion: string): LauncherUpdateState {
  return {
    phase: "idle",
    current_version: currentVersion,
    manifest: null,
    downloaded_path: null,
    downloaded_sha256: null,
    error: null,
    updated_at: new Date().toISOString(),
    last_checked_at: null,
  };
}

export function assertLauncherUpdateTransition(
  from: LauncherUpdatePhase,
  to: LauncherUpdatePhase,
): void {
  if (from !== to && !TRANSITIONS[from].includes(to))
    throw new Error(`Invalid launcher update transition: ${from} -> ${to}`);
}

export function readLauncherUpdateState(path: string, currentVersion: string): LauncherUpdateState {
  if (!existsSync(path)) return createIdleLauncherUpdateState(currentVersion);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LauncherUpdateState>;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !LAUNCHER_UPDATE_PHASES.includes(parsed.phase as LauncherUpdatePhase) ||
    (parsed.manifest != null && typeof parsed.manifest !== "object") ||
    (parsed.downloaded_path != null && typeof parsed.downloaded_path !== "string") ||
    (parsed.downloaded_sha256 != null && typeof parsed.downloaded_sha256 !== "string") ||
    (parsed.error != null && typeof parsed.error !== "string") ||
    (parsed.last_checked_at != null && typeof parsed.last_checked_at !== "string")
  ) {
    throw new Error("Launcher update state has invalid fields.");
  }
  return {
    ...createIdleLauncherUpdateState(currentVersion),
    ...parsed,
    current_version: currentVersion,
  } as LauncherUpdateState;
}

export function writeLauncherUpdateStateAtomic(path: string, state: LauncherUpdateState): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.tmp`;
  const fd = openSync(temporaryPath, "w", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporaryPath, path);
}
