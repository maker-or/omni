import { Worker } from "node:worker_threads";
import type {
  MonitorDiffIngestion,
  MonitorAcpUpdate,
  MonitorBridgeEvent,
  MonitorProcessDescriptor,
  MonitorProcessSample,
  MonitorRendererTelemetry,
  MonitorSampleTick,
  MonitorSession,
} from "../../contracts/monitor.ts";
import { samplePid, type RawProcessMetrics } from "./platform-sampler.ts";
import {
  ensureMonitorTables,
  finishMonitorSession,
  insertAcpUpdate,
  insertBridgeEvent,
  insertDiffIngestion,
  insertMonitorSession,
  insertRendererTelemetry,
  insertSampleBatch,
  isMonitorDbInitialized,
  initializeMonitorDb,
  pruneOldSamples,
} from "./db.ts";

const MAX_QUEUED_WRITES = 256;

export type WorkerCommand =
  | { type: "init"; dbPath: string }
  | {
      type: "sample";
      descriptors: MonitorProcessDescriptor[];
      sessionId: string | null;
      mainPid: number;
      mainProcessMetrics?: RawProcessMetrics;
    }
  | { type: "start-recording"; session: MonitorSession }
  | { type: "stop-recording"; sessionId: string; endedAt: number }
  | { type: "renderer-telemetry"; sessionId: string; telemetry: MonitorRendererTelemetry }
  | { type: "diff-ingestion"; sessionId: string; ingestion: MonitorDiffIngestion }
  | { type: "acp-update"; sessionId: string; update: MonitorAcpUpdate }
  | { type: "bridge-event"; sessionId: string; event: MonitorBridgeEvent }
  | { type: "flush" }
  | { type: "prune"; retentionMs: number }
  | { type: "shutdown" };

interface WorkerResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  isWrite: boolean;
  startedAt: number;
  command: WorkerCommand;
}

async function collectProcessTick(
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

async function executeCommandInProcess(command: WorkerCommand): Promise<unknown> {
  try {
    switch (command.type) {
      case "init":
        if (!isMonitorDbInitialized()) {
          try {
            const { DatabaseSync } = await import("node:sqlite");
            if (DatabaseSync) {
              const db = new DatabaseSync(command.dbPath);
              db.exec("PRAGMA foreign_keys = ON;");
              db.exec("PRAGMA journal_mode = WAL;");
              db.exec("PRAGMA busy_timeout = 5000;");
              initializeMonitorDb(db);
            }
          } catch {
            // node:sqlite not available in this environment
          }
        }
        if (isMonitorDbInitialized()) {
          try {
            ensureMonitorTables();
          } catch {
            // Table creation best-effort
          }
        }
        return;
      case "sample": {
        const tick = await collectProcessTick(
          command.descriptors,
          command.mainPid,
          command.mainProcessMetrics,
        );
        if (command.sessionId && isMonitorDbInitialized()) {
          try {
            insertSampleBatch(command.sessionId, tick);
          } catch (e) {
            console.warn("[Monitor] Failed to write sample batch in process:", e);
          }
        }
        return tick;
      }
      case "start-recording":
        if (isMonitorDbInitialized()) {
          try {
            insertMonitorSession(command.session);
          } catch (e) {
            console.warn("[Monitor] Failed to start recording in process:", e);
          }
        }
        return;
      case "stop-recording":
        if (isMonitorDbInitialized()) {
          try {
            finishMonitorSession(command.sessionId, command.endedAt);
          } catch (e) {
            console.warn("[Monitor] Failed to finish recording in process:", e);
          }
        }
        return;
      case "renderer-telemetry":
        if (isMonitorDbInitialized()) {
          try {
            insertRendererTelemetry(command.sessionId, command.telemetry);
          } catch (e) {
            console.warn("[Monitor] Failed to insert renderer telemetry in process:", e);
          }
        }
        return;
      case "diff-ingestion":
        if (isMonitorDbInitialized()) {
          try {
            insertDiffIngestion(command.sessionId, command.ingestion);
          } catch (e) {
            console.warn("[Monitor] Failed to insert diff ingestion in process:", e);
          }
        }
        return;
      case "acp-update":
        if (isMonitorDbInitialized()) {
          try {
            insertAcpUpdate(command.sessionId, command.update);
          } catch (e) {
            console.warn("[Monitor] Failed to insert acp update in process:", e);
          }
        }
        return;
      case "bridge-event":
        if (isMonitorDbInitialized()) {
          try {
            insertBridgeEvent(command.sessionId, command.event);
          } catch (e) {
            console.warn("[Monitor] Failed to insert bridge event in process:", e);
          }
        }
        return;
      case "flush":
        return;
      case "prune":
        if (isMonitorDbInitialized()) {
          try {
            pruneOldSamples(command.retentionMs);
          } catch (e) {
            console.warn("[Monitor] Failed to prune old samples in process:", e);
          }
        }
        return;
      case "shutdown":
        return;
    }
  } catch (error) {
    console.error("[Monitor] executeCommandInProcess failed:", error);
    if (command.type === "sample") {
      return { timestamp: Date.now(), processes: [] };
    }
    return;
  }
}

export class MonitorWorkerClient {
  private worker: Worker | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private queuedWrites = 0;
  private stopped = false;
  private useFallback = false;
  private droppedWrites = 0;
  private writeFailures = 0;
  private workerFailures = 0;
  private lastWriteLatencyMs = 0;
  private maxWriteLatencyMs = 0;
  private lastFlushMs = 0;
  private lastError: string | null = null;
  private readonly initPromise: Promise<void>;

  constructor(dbPath: string) {
    try {
      this.worker = new Worker(new URL("./worker.ts", import.meta.url));
      this.worker.unref();
      this.worker.on("message", (response: WorkerResponse) => this.handleResponse(response));
      this.worker.on("error", (error) => this.handleWorkerCrash(error));
      this.worker.on("exit", (code) => {
        if (code !== 0 && !this.stopped) {
          this.handleWorkerCrash(new Error(`Monitor worker exited with code ${code}`));
        }
      });
      this.initPromise = this.request<void>({ type: "init", dbPath });
    } catch (error) {
      this.useFallback = true;
      this.worker = null;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.initPromise = executeCommandInProcess({ type: "init", dbPath }) as Promise<void>;
    }
  }

  ready(): Promise<void> {
    return this.initPromise;
  }

  sample(
    descriptors: MonitorProcessDescriptor[],
    sessionId: string | null,
    mainPid: number,
    mainProcessMetrics?: RawProcessMetrics,
  ): Promise<MonitorSampleTick> {
    return this.request<MonitorSampleTick>({
      type: "sample",
      descriptors,
      sessionId,
      mainPid,
      mainProcessMetrics,
    });
  }

  startRecording(session: MonitorSession): Promise<void> {
    return this.request<void>({ type: "start-recording", session });
  }

  stopRecording(sessionId: string, endedAt: number): Promise<void> {
    return this.request<void>({ type: "stop-recording", sessionId, endedAt });
  }

  writeRendererTelemetry(sessionId: string, telemetry: MonitorRendererTelemetry): boolean {
    return this.postWrite({ type: "renderer-telemetry", sessionId, telemetry });
  }

  writeDiffIngestion(sessionId: string, ingestion: MonitorDiffIngestion): boolean {
    return this.postWrite({ type: "diff-ingestion", sessionId, ingestion });
  }

  writeAcpUpdate(sessionId: string, update: MonitorAcpUpdate): boolean {
    return this.postWrite({ type: "acp-update", sessionId, update });
  }

  writeBridgeEvent(sessionId: string, event: MonitorBridgeEvent): boolean {
    return this.postWrite({ type: "bridge-event", sessionId, event });
  }

  flush(): Promise<void> {
    const startedAt = performance.now();
    return this.request<void>({ type: "flush" }).then((value) => {
      this.lastFlushMs = performance.now() - startedAt;
      return value;
    });
  }

  health() {
    return {
      queueDepth: this.queuedWrites,
      queueCapacity: MAX_QUEUED_WRITES,
      droppedWrites: this.droppedWrites,
      writeFailures: this.writeFailures,
      workerFailures: this.workerFailures,
      lastWriteLatencyMs: this.lastWriteLatencyMs,
      maxWriteLatencyMs: this.maxWriteLatencyMs,
      lastFlushMs: this.lastFlushMs,
      lastError: this.lastError,
    };
  }

  prune(retentionMs: number): boolean {
    return this.postWrite({ type: "prune", retentionMs });
  }

  async shutdown(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    try {
      if (this.worker && !this.useFallback) {
        await this.request<void>({ type: "shutdown" });
      }
    } catch {
      // Best-effort shutdown command.
    } finally {
      if (this.worker) {
        await this.worker.terminate().catch(() => {});
        this.worker = null;
      }
    }
  }

  private postWrite(command: WorkerCommand): boolean {
    if (this.stopped || this.queuedWrites >= MAX_QUEUED_WRITES) {
      this.droppedWrites += 1;
      return false;
    }
    this.queuedWrites += 1;
    void this.request<void>(command, true).catch(() => {
      this.writeFailures += 1;
    });
    return true;
  }

  private request<T>(command: WorkerCommand, isWrite = false): Promise<T> {
    if (this.stopped && command.type !== "shutdown") {
      return Promise.reject(new Error("Monitor worker is stopped."));
    }

    if (this.useFallback || !this.worker) {
      const startedAt = performance.now();
      return executeCommandInProcess(command).then(
        (result) => {
          if (isWrite) {
            this.queuedWrites = Math.max(this.queuedWrites - 1, 0);
            const latency = performance.now() - startedAt;
            this.lastWriteLatencyMs = latency;
            this.maxWriteLatencyMs = Math.max(this.maxWriteLatencyMs, latency);
          }
          return result as T;
        },
        (error: unknown) => {
          if (isWrite) {
            this.queuedWrites = Math.max(this.queuedWrites - 1, 0);
            this.writeFailures += 1;
          }
          throw error instanceof Error ? error : new Error(String(error));
        },
      );
    }

    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        isWrite,
        startedAt: performance.now(),
        command,
      });
      try {
        this.worker!.postMessage({ id, ...command });
      } catch (error) {
        this.pending.delete(id);
        this.handleWorkerCrash(error instanceof Error ? error : new Error(String(error)));
        executeCommandInProcess(command)
          .then((res) => resolve(res as T))
          .catch((err) => reject(err));
      }
    });
  }

  private handleResponse(response: WorkerResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (pending.isWrite) {
      this.queuedWrites = Math.max(this.queuedWrites - 1, 0);
      const latency = performance.now() - pending.startedAt;
      this.lastWriteLatencyMs = latency;
      this.maxWriteLatencyMs = Math.max(this.maxWriteLatencyMs, latency);
    }
    if (!response.ok) this.lastError = response.error ?? "Monitor worker request failed.";
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new Error(response.error ?? "Monitor worker request failed."));
  }

  private handleWorkerCrash(error: Error): void {
    this.workerFailures += 1;
    this.lastError = error.message;
    this.useFallback = true;
    this.worker = null;

    // Failover all pending requests into in-process execution instead of hanging.
    const drainList = [...this.pending.values()];
    this.pending.clear();
    for (const pending of drainList) {
      executeCommandInProcess(pending.command)
        .then((result) => {
          if (pending.isWrite) {
            this.queuedWrites = Math.max(this.queuedWrites - 1, 0);
            const latency = performance.now() - pending.startedAt;
            this.lastWriteLatencyMs = latency;
            this.maxWriteLatencyMs = Math.max(this.maxWriteLatencyMs, latency);
          }
          pending.resolve(result);
        })
        .catch((err) => {
          if (pending.isWrite) {
            this.queuedWrites = Math.max(this.queuedWrites - 1, 0);
            this.writeFailures += 1;
          }
          pending.reject(err instanceof Error ? err : new Error(String(err)));
        });
    }
  }
}
