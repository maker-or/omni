import { app } from "electron";
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX_BYTES = 2 * 1024 * 1024;

let logFile: string | null = null;

function resolveLogFile(): string | null {
  if (logFile) return logFile;
  try {
    const dir = join(app.getPath("userData"), "logs");
    mkdirSync(dir, { recursive: true });
    logFile = join(dir, "main.log");
    try {
      if (statSync(logFile).size > MAX_BYTES) renameSync(logFile, `${logFile}.1`);
    } catch {
      // No log yet or unreadable — start fresh.
    }
    return logFile;
  } catch {
    return null;
  }
}

/** Timestamped main-process log, mirrored to stdout. Never throws. */
export function logMain(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    const file = resolveLogFile();
    if (file) appendFileSync(file, `${line}\n`);
  } catch {
    // Logging must never break the app.
  }
}

/** Absolute path of the main log for "check the logs" moments. */
export function mainLogPath(): string | null {
  try {
    return resolveLogFile();
  } catch {
    return null;
  }
}
