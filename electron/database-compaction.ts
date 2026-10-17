import { statSync, statfsSync } from "node:fs";
import { dirname } from "node:path";
import { Worker } from "node:worker_threads";
import type { DatabaseCompactionResult } from "../contracts/storage.ts";
import { applicationStorage, type StorageMaintenance } from "./storage-maintenance.ts";
export type { DatabaseCompactionResult } from "../contracts/storage.ts";

/** SQLite does not return freed pages to the filesystem until compacted. */
export function compactDatabase(path: string): Promise<DatabaseCompactionResult> {
  return new Promise((resolve, reject) => {
    // Keep VACUUM and its file IO off Electron's main thread. The path comes
    // from main, never from renderer input. SQLite owns locking and rollback.
    const worker = new Worker(
      `
      const { parentPort, workerData } = require('node:worker_threads');
      const { DatabaseSync } = require('node:sqlite');
      const { statSync } = require('node:fs');
      const bytes = () => [workerData, workerData + '-wal'].reduce((sum, path) => {
        try { return sum + statSync(path).size; } catch { return sum; }
      }, 0);
      let db;
      try {
        db = new DatabaseSync(workerData, { open: true });
        db.exec('PRAGMA busy_timeout = 1000');
        const beforeBytes = bytes();
        db.exec('VACUUM');
        const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
        db.close(); db = null;
        const afterBytes = bytes();
        parentPort.postMessage({ status: 'completed', beforeBytes, afterBytes, reclaimedBytes: Math.max(0, beforeBytes - afterBytes), checkpointBusy: checkpoint.busy !== 0 });
      } catch (error) {
        if (db) db.close();
        throw error;
      }
    `,
      { eval: true, workerData: path },
    );
    let settled = false;
    worker.once("message", (result: DatabaseCompactionResult) => {
      settled = true;
      resolve(result);
    });
    worker.once("error", (error) => {
      settled = true;
      reject(error);
    });
    worker.once("exit", (code) => {
      if (settled) return;
      reject(
        new Error(
          code === 0
            ? "Database compaction worker exited without a result"
            : `Database compaction worker exited with code ${code}`,
        ),
      );
    });
  });
}

function databaseBytes(path: string): number {
  return [path, `${path}-wal`].reduce((sum, file) => {
    try {
      return sum + statSync(file).size;
    } catch {
      return sum;
    }
  }, 0);
}

function availableBytes(path: string): number {
  const stats = statfsSync(dirname(path));
  return Number(stats.bavail) * Number(stats.bsize);
}

/**
 * User-requested compaction of the application database. VACUUM writes a
 * temporary copy of the live pages and can grow the WAL by about as much, so
 * it needs that much free space; it runs only once the app is idle so it
 * cannot hold SQLite's writer lock while interaction-critical writes wait.
 */
export async function compactWhenIdle(
  path: string,
  options: {
    maintenance?: StorageMaintenance;
    freeBytes?: (path: string) => number;
  } = {},
): Promise<DatabaseCompactionResult> {
  const maintenance = options.maintenance ?? applicationStorage;
  const beforeBytes = databaseBytes(path);
  const unchanged = {
    beforeBytes,
    afterBytes: beforeBytes,
    reclaimedBytes: 0,
    checkpointBusy: false,
  };
  const requiredFreeBytes = beforeBytes * 2 + 64 * 1024 * 1024;
  const availableFreeBytes = (options.freeBytes ?? availableBytes)(path);
  if (availableFreeBytes < requiredFreeBytes) {
    return { status: "insufficient-space", ...unchanged, requiredFreeBytes, availableFreeBytes };
  }
  const outcome = await maintenance.runWhenIdle(() => compactDatabase(path));
  if (outcome.status === "busy") return { status: "busy", ...unchanged };
  return outcome.result;
}
