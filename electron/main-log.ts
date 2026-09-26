import { app } from "electron";
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX_BYTES = 2 * 1024 * 1024;

let logFile: string | null = null;
/** Bytes in the active log, tracked locally so rotation needs no stat per line. */
let logSize = 0;

function resolveLogFile(): string | null {
  if (logFile) return logFile;
  try {
    const dir = join(app.getPath("userData"), "logs");
    mkdirSync(dir, { recursive: true });
    logFile = join(dir, "main.log");
    try {
      logSize = statSync(logFile).size;
    } catch {
      // No log yet or unreadable — start fresh.
      logSize = 0;
    }
    return logFile;
  } catch {
    return null;
  }
}

/**
 * Keep one previous generation (`main.log.1`). Checked on every append — a
 * long-running process must not grow the active file past the cap just
 * because it was small at startup.
 */
function rotateIfNeeded(file: string, incomingBytes: number): void {
  if (logSize + incomingBytes <= MAX_BYTES) return;
  try {
    renameSync(file, `${file}.1`);
    logSize = 0;
  } catch (err) {
    // Nothing to rotate (it vanished): the append recreates an empty file, so
    // the counter resets. Any other failure (e.g. a Windows lock) keeps the
    // real size — resetting it would let the oversized file grow while only
    // new bytes are accounted; this way rotation retries on the next append.
    if ((err as NodeJS.ErrnoException | null)?.code === "ENOENT") logSize = 0;
  }
}

/** Timestamped main-process log, mirrored to stdout. Never throws. */
export function logMain(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    const file = resolveLogFile();
    if (!file) return;
    const payload = `${line}\n`;
    const bytes = Buffer.byteLength(payload);
    rotateIfNeeded(file, bytes);
    appendFileSync(file, payload);
    logSize += bytes;
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
