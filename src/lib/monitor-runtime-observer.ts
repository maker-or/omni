import type {
  MonitorFreezeSource,
  MonitorRendererFreezeReport,
  MonitorRendererTelemetry,
} from "../../contracts/monitor.ts";

const RUNTIME_SAMPLE_INTERVAL_MS = 5000;
const FREEZE_EPISODE_QUIET_MS = 1500;

export interface RendererMonitorContext {
  observerId: string;
  getActiveThreadId: () => string | null;
  getRunningThreadIds: () => string[];
}

interface DiffCounters {
  diffIngestionCount: number;
  diffIngestionMs: number;
  diffSerializedUtf16Bytes: number;
  diffExtractedFileCount: number;
  diffChangedFileCount: number;
}

interface RuntimePauseCounters {
  longTaskCount: number;
  longTaskMs: number;
  gcPauseCount: number;
  gcPauseMs: number;
}

let diffCounters: DiffCounters = emptyDiffCounters();
let diffGauges = { diffThreadCount: 0, diffToolCallCount: 0, diffFileCount: 0 };
let pauseCounters: RuntimePauseCounters = emptyPauseCounters();

function emptyDiffCounters(): DiffCounters {
  return {
    diffIngestionCount: 0,
    diffIngestionMs: 0,
    diffSerializedUtf16Bytes: 0,
    diffExtractedFileCount: 0,
    diffChangedFileCount: 0,
  };
}

function emptyPauseCounters(): RuntimePauseCounters {
  return { longTaskCount: 0, longTaskMs: 0, gcPauseCount: 0, gcPauseMs: 0 };
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createMonitorObserverId(): string {
  return createId("renderer");
}

function rendererContext(): Pick<MonitorRendererTelemetry, "visibilityState" | "focused"> {
  return {
    visibilityState: document.visibilityState,
    focused: document.hasFocus(),
  };
}

function heapStats(): Pick<
  MonitorRendererTelemetry,
  "jsHeapUsedBytes" | "jsHeapTotalBytes" | "jsHeapLimitBytes"
> {
  const memory = (
    performance as Performance & {
      memory?: {
        usedJSHeapSize?: number;
        totalJSHeapSize?: number;
        jsHeapSizeLimit?: number;
      };
    }
  ).memory;
  return {
    jsHeapUsedBytes: finiteOrNull(memory?.usedJSHeapSize),
    jsHeapTotalBytes: finiteOrNull(memory?.totalJSHeapSize),
    jsHeapLimitBytes: finiteOrNull(memory?.jsHeapSizeLimit),
  };
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function recordDiffIngestion(input: {
  threadCount: number;
  toolCallCount: number;
  fileCount: number;
  durationMs: number;
  serializedUtf16Bytes: number;
  extractedFileCount: number;
  changedFileCount: number;
}): void {
  diffGauges = {
    diffThreadCount: Math.max(input.threadCount, 0),
    diffToolCallCount: Math.max(input.toolCallCount, 0),
    diffFileCount: Math.max(input.fileCount, 0),
  };
  diffCounters.diffIngestionCount += 1;
  diffCounters.diffIngestionMs += Math.max(input.durationMs, 0);
  diffCounters.diffSerializedUtf16Bytes += Math.max(input.serializedUtf16Bytes, 0);
  diffCounters.diffExtractedFileCount += Math.max(input.extractedFileCount, 0);
  diffCounters.diffChangedFileCount += Math.max(input.changedFileCount, 0);
}

export function startMonitorRuntimeObserver(
  context: RendererMonitorContext,
  onTelemetry: (telemetry: MonitorRendererTelemetry) => void,
): () => void {
  const startedAt = now();
  let pauseObserver: PerformanceObserver | undefined;
  try {
    pauseObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === "gc") {
          pauseCounters.gcPauseCount += 1;
          pauseCounters.gcPauseMs += entry.duration;
        } else if (entry.entryType === "longtask") {
          pauseCounters.longTaskCount += 1;
          pauseCounters.longTaskMs += entry.duration;
        }
      }
    });
    const supported = (
      PerformanceObserver as typeof PerformanceObserver & {
        supportedEntryTypes?: string[];
      }
    ).supportedEntryTypes;
    const entryTypes = ["longtask", "gc"].filter(
      (entryType) => !supported || supported.includes(entryType),
    );
    if (entryTypes.length > 0) pauseObserver.observe({ entryTypes });
  } catch {
    pauseObserver = undefined;
  }
  const emit = () => {
    const counters = diffCounters;
    diffCounters = emptyDiffCounters();
    const pauses = pauseCounters;
    pauseCounters = emptyPauseCounters();
    const contextState = rendererContext();
    const heap = heapStats();
    onTelemetry({
      timestamp: Date.now(),
      monotonicMs: now() - startedAt,
      observerId: context.observerId,
      ...contextState,
      ...heap,
      activeThreadId: context.getActiveThreadId(),
      runningThreadCount: context.getRunningThreadIds().length,
      domNodeCount: document.getElementsByTagName("*").length,
      ...diffGauges,
      ...counters,
      ...pauses,
    });
  };

  emit();
  const interval = window.setInterval(emit, RUNTIME_SAMPLE_INTERVAL_MS);
  return () => {
    window.clearInterval(interval);
    pauseObserver?.disconnect();
  };
}

export function startMonitorFreezeObserver(
  context: RendererMonitorContext,
  onReport: (report: MonitorRendererFreezeReport) => void,
): () => void {
  const cleanups: Array<() => void> = [];
  const observerId = context.observerId;
  let lastFrame = now();
  let episode:
    | {
        id: string;
        startedAt: number;
        lastSignalAt: number;
        maxBlockedMs: number;
        signalCount: number;
        sequence: number;
        sources: Set<MonitorFreezeSource>;
      }
    | undefined;
  let finishTimer: number | undefined;

  const emit = (
    phase: "start" | "end",
    source: MonitorFreezeSource,
    blockedMs: number,
    longTaskMs?: number,
  ) => {
    if (!episode) return;
    episode.sequence += 1;
    const contextState = rendererContext();
    onReport({
      phase,
      episodeId: episode.id,
      observerId,
      sequence: episode.sequence,
      source,
      sources: [...episode.sources],
      blockedMs,
      longTaskMs,
      maxBlockedMs: episode.maxBlockedMs,
      episodeDurationMs: Math.max(0, now() - episode.startedAt),
      signalCount: episode.signalCount,
      observedAt: performance.timeOrigin + now(),
      monotonicMs: now(),
      ...contextState,
    });
  };

  const finish = () => {
    if (!episode) return;
    emit("end", [...episode.sources][0] ?? "raf_gap", episode.maxBlockedMs);
    episode = undefined;
    finishTimer = undefined;
  };

  const signal = (source: MonitorFreezeSource, blockedMs: number, longTaskMs?: number) => {
    if (blockedMs < 200) return;
    const current = now();
    if (!episode || current - episode.lastSignalAt > FREEZE_EPISODE_QUIET_MS) {
      if (episode) finish();
      episode = {
        id: createId("freeze"),
        startedAt: current,
        lastSignalAt: current,
        maxBlockedMs: blockedMs,
        signalCount: 1,
        sequence: 0,
        sources: new Set([source]),
      };
      emit("start", source, blockedMs, longTaskMs);
    } else {
      episode.lastSignalAt = current;
      episode.maxBlockedMs = Math.max(episode.maxBlockedMs, blockedMs);
      episode.signalCount += 1;
      episode.sources.add(source);
    }
    if (finishTimer !== undefined) window.clearTimeout(finishTimer);
    finishTimer = window.setTimeout(finish, FREEZE_EPISODE_QUIET_MS);
  };

  if ("PerformanceObserver" in window) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration >= 50) signal("longtask", entry.duration, entry.duration);
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
      cleanups.push(() => observer.disconnect());
    } catch {
      // Long Task is not available in every Electron runtime.
    }
  }

  let rafId = 0;
  const onFrame = (frameNow: number) => {
    const delta = frameNow - lastFrame;
    if (delta > 200) signal("raf_gap", delta);
    lastFrame = frameNow;
    rafId = requestAnimationFrame(onFrame);
  };
  rafId = requestAnimationFrame(onFrame);
  cleanups.push(() => cancelAnimationFrame(rafId));

  const interval = window.setInterval(() => {
    const started = now();
    window.setTimeout(() => {
      const drift = now() - started - 100;
      if (drift > 200) signal("timer_drift", drift);
    }, 100);
  }, 250);
  cleanups.push(() => window.clearInterval(interval));

  return () => {
    for (const cleanup of cleanups) cleanup();
    if (finishTimer !== undefined) window.clearTimeout(finishTimer);
  };
}
