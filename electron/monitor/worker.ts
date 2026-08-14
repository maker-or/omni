import { DatabaseSync } from "node:sqlite";
import { parentPort } from "node:worker_threads";
import type {
  MonitorProcessDescriptor,
  MonitorProcessSample,
  MonitorSampleTick,
} from "../../contracts/monitor.ts";
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
  pruneOldSamples,
} from "./db.ts";
import { samplePid, type RawProcessMetrics } from "./platform-sampler.ts";
import type { WorkerCommand } from "./worker-client.ts";

type IncomingCommand = WorkerCommand & { id: number };

let db: DatabaseSync | null = null;
let commandQueue = Promise.resolve();

function send(id: number, ok: boolean, result?: unknown, error?: string): void {
  parentPort?.postMessage({ id, ok, result, error });
}

async function collectTick(
  descriptors: MonitorProcessDescriptor[],
  mainPid: number,
  mainProcessMetrics?: RawProcessMetrics,
): Promise<MonitorSampleTick> {
  const timestamp = Date.now();
  const uniqueByPid = new Map<number, MonitorProcessDescriptor>();
  for (const descriptor of descriptors) {
    if (!uniqueByPid.has(descriptor.pid)) uniqueByPid.set(descriptor.pid, descriptor);
  }

  const processes: MonitorProcessSample[] = [];
  await Promise.all(
    [...uniqueByPid.entries()].map(async ([pid, descriptor]) => {
      // Windows has no cross-process sampler in this app. Preserve the main
      // process metric by sampling it in the parent and passing it here.
      const metrics =
        pid === mainPid && mainProcessMetrics ? mainProcessMetrics : await samplePid(pid);
      if (!metrics) return;
      processes.push({
        pid,
        role: descriptor.role,
        label: descriptor.label,
        agentId: descriptor.agentId,
        threadId: descriptor.threadId,
        threadIds: descriptor.threadIds ?? (descriptor.threadId ? [descriptor.threadId] : []),
        streamingThreadIds: descriptor.streamingThreadIds ?? [],
        sessionId: descriptor.sessionId,
        isStreaming: descriptor.isStreaming,
        ...metrics,
      });
    }),
  );

  processes.sort((a, b) => a.label.localeCompare(b.label));
  return { timestamp, processes };
}

async function handle(command: IncomingCommand): Promise<void> {
  try {
    switch (command.type) {
      case "init": {
        db?.close();
        db = new DatabaseSync(command.dbPath);
        db.exec("PRAGMA foreign_keys = ON;");
        db.exec("PRAGMA journal_mode = WAL;");
        db.exec("PRAGMA busy_timeout = 5000;");
        initializeMonitorDb(db);
        ensureMonitorTables();
        send(command.id, true);
        return;
      }
      case "sample": {
        const tick = await collectTick(
          command.descriptors,
          command.mainPid,
          command.mainProcessMetrics,
        );
        if (command.sessionId) insertSampleBatch(command.sessionId, tick);
        send(command.id, true, tick);
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
        pruneOldSamples(command.retentionMs);
        send(command.id, true);
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

parentPort?.on("message", (command: IncomingCommand) => {
  // SQLite writes and samples are serialized. This preserves event ordering,
  // bounds native SQLite contention, and lets shutdown drain prior writes.
  commandQueue = commandQueue.then(() => handle(command));
});
