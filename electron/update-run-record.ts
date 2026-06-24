import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { UpdateRunRecord } from "../contracts/updates.ts";
import { getUpdatesPath } from "./workspace-manager.ts";

export function createRunId(): string {
  return randomUUID();
}

export function getRunRecordPath(runId: string): string {
  return join(getUpdatesPath(), "runs", `${runId}.json`);
}

export function getRunLogPath(runId: string): string {
  return join(getUpdatesPath(), "logs", `${runId}.log`);
}

export function readUpdateRunRecord(runId: string): UpdateRunRecord | null {
  const path = getRunRecordPath(runId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as UpdateRunRecord;
}

export function writeUpdateRunRecordAtomic(runId: string, record: UpdateRunRecord): void {
  const path = getRunRecordPath(runId);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  const fd = openSync(temporaryPath, "w", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporaryPath, path);
}

export function appendUpdateRunLog(runId: string, line: string): void {
  const path = getRunLogPath(runId);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${new Date().toISOString()} ${line}\n`, "utf8");
}

export function readNewestUpdateRunRecord(): UpdateRunRecord | null {
  const runsPath = join(getUpdatesPath(), "runs");
  if (!existsSync(runsPath)) return null;
  const newest = readdirSync(runsPath)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => join(runsPath, entry))
    .sort()
    .at(-1);
  if (!newest) return null;
  return JSON.parse(readFileSync(newest, "utf8")) as UpdateRunRecord;
}
