import { Worker } from "node:worker_threads";
import type { DatabaseCompactionResult } from "../contracts/storage.ts";
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
        parentPort.postMessage({ beforeBytes, afterBytes, reclaimedBytes: Math.max(0, beforeBytes - afterBytes), checkpointBusy: checkpoint.busy !== 0 });
      } catch (error) {
        if (db) db.close();
        throw error;
      }
    `,
      { eval: true, workerData: path },
    );
    worker.once("message", (result: DatabaseCompactionResult) => resolve(result));
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`Database compaction worker exited with code ${code}`));
    });
  });
}
