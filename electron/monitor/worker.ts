import type { DatabaseSync } from "node:sqlite";
import { parentPort } from "node:worker_threads";
import {
  ensureMonitorTables,
  finishMonitorSession,
  initializeMonitorDb,
  insertDiffIngestion,
  insertAcpUpdate,
  insertBridgeEvent,
  insertMonitorSession,
  insertRendererTelemetry,
  insertSampleBatch,
} from "./db.ts";
import { collectProcessTick, samplerStats } from "./platform-sampler.ts";
import { pruneMonitorData } from "./retention.ts";
import { migrateLegacyMonitorStep, openMonitorDatabase } from "./storage.ts";
import type { WorkerCommand } from "./worker-client.ts";

type IncomingCommand = WorkerCommand & { id: number };

let db: DatabaseSync | null = null;
let commandQueue = Promise.resolve();

function send(id: number, ok: boolean, result?: unknown, error?: string): void {
  parentPort?.postMessage({ id, ok, result, error });
}

async function handle(command: IncomingCommand): Promise<void> {
  try {
    switch (command.type) {
      case "init": {
        db?.close();
        db = openMonitorDatabase(command.dbPath);
        initializeMonitorDb(db);
        ensureMonitorTables();
        send(command.id, true);
        if (command.legacyDbPath) scheduleLegacyMigration(db, command.legacyDbPath);
        return;
      }
      case "sample": {
        const tick = await collectProcessTick(
          command.descriptors,
          command.mainPid,
          { threadDetail: command.threadDetail },
          command.mainProcessMetrics,
        );
        if (command.sessionId) insertSampleBatch(command.sessionId, tick);
        send(command.id, true, { tick, sampler: samplerStats() });
        return;
      }
      case "start-recording":
        insertMonitorSession(command.session);
        send(command.id, true);
        return;
      case "stop-recording":
        finishMonitorSession(command.sessionId, command.endedAt);
        send(command.id, true);
        return;
      case "renderer-telemetry":
        insertRendererTelemetry(command.sessionId, command.telemetry);
        send(command.id, true);
        return;
      case "diff-ingestion":
        insertDiffIngestion(command.sessionId, command.ingestion);
        send(command.id, true);
        return;
      case "acp-update":
        insertAcpUpdate(command.sessionId, command.update);
        send(command.id, true);
        return;
      case "bridge-event":
        insertBridgeEvent(command.sessionId, command.event);
        send(command.id, true);
        return;
      case "flush":
        send(command.id, true);
        return;
      case "prune":
        send(command.id, true, db ? pruneMonitorData(db, command.policy) : null);
        return;
      case "shutdown":
        db?.close();
        db = null;
        send(command.id, true);
        parentPort?.close();
        return;
    }
  } catch (error) {
    send(command.id, false, undefined, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Move monitor rows left in the application database by earlier builds.
 * Each step is queued behind pending commands, so samples and telemetry keep
 * flowing while the backlog drains.
 */
function scheduleLegacyMigration(connection: DatabaseSync, legacyDbPath: string): void {
  commandQueue = commandQueue.then(() => {
    if (db !== connection) return;
    let done = true;
    try {
      done = migrateLegacyMonitorStep(connection, legacyDbPath);
    } catch (error) {
      console.warn("[Monitor] Legacy diagnostics migration paused:", error);
    }
    if (!done) setImmediate(() => scheduleLegacyMigration(connection, legacyDbPath));
  });
}

parentPort?.on("message", (command: IncomingCommand) => {
  // SQLite writes and samples are serialized. This preserves event ordering,
  // bounds native SQLite contention, and lets shutdown drain prior writes.
  commandQueue = commandQueue.then(() => handle(command));
});
