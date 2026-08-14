import { Worker } from "node:worker_threads";
import type {
  MonitorDiffIngestion,
  MonitorAcpUpdate,
  MonitorBridgeEvent,
  MonitorProcessDescriptor,
  MonitorRendererTelemetry,
  MonitorSampleTick,
  MonitorSession,
} from "../../contracts/monitor.ts";
import type { RawProcessMetrics } from "./platform-sampler.ts";

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
}

export class MonitorWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private queuedWrites = 0;
  private stopped = false;
  private droppedWrites = 0;
  private writeFailures = 0;
  private workerFailures = 0;
  private lastWriteLatencyMs = 0;
  private maxWriteLatencyMs = 0;
  private lastFlushMs = 0;
  private lastError: string | null = null;
  private readonly initPromise: Promise<void>;

  constructor(dbPath: string) {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url));
    this.worker.unref();
    this.worker.on("message", (response: WorkerResponse) => this.handleResponse(response));
    this.worker.on("error", (error) => this.rejectAll(error));
    this.worker.on("exit", (code) => {
      if (code !== 0) {
        this.workerFailures += 1;
        this.lastError = `Monitor worker exited with code ${code}`;
        this.rejectAll(new Error(this.lastError));
      }
    });
    this.initPromise = this.request<void>({ type: "init", dbPath });
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
      await this.request<void>({ type: "shutdown" });
    } finally {
      await this.worker.terminate();
      this.rejectAll(new Error("Monitor worker stopped."));
    }
  }

  private postWrite(command: WorkerCommand): boolean {
    if (this.stopped || this.queuedWrites >= MAX_QUEUED_WRITES) {
      this.droppedWrites += 1;
      return false;
    }
    this.queuedWrites += 1;
    void this.request<void>(command, true).catch(() => {
      // Monitor persistence is diagnostic. A failed write must not impact the
      // application or turn a busy worker into an unbounded retry loop.
      this.writeFailures += 1;
    });
    return true;
  }

  private request<T>(command: WorkerCommand, isWrite = false): Promise<T> {
    if (this.stopped && command.type !== "shutdown") {
      return Promise.reject(new Error("Monitor worker is stopped."));
    }
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        isWrite,
        startedAt: performance.now(),
      });
      this.worker.postMessage({ id, ...command });
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

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.isWrite) this.queuedWrites = Math.max(this.queuedWrites - 1, 0);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
