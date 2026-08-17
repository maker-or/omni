import type { MonitorRecordedSession } from "./monitor.ts";

export type ThreadBenchmarkMode = "cold" | "warm";

export const THREAD_BENCHMARK_CAPTURE_SCHEMA_VERSION = 2;

export interface ThreadBenchmarkPrepared {
  targetThreadId: string;
  controlThreadId: string;
  targetSelector: string;
  fixturePath: string;
  fixtureBytes: number;
}

export interface ThreadBenchmarkRun {
  runId: string;
  threadId: string;
  mode: ThreadBenchmarkMode;
  startedAt: number;
}

export interface ThreadBenchmarkRendererReady {
  threadId: string;
  totalRows: number;
  visibleRows: number;
  renderedAt: number;
}

export interface ThreadBenchmarkIdentity {
  runId: string;
  monitorSessionId: string;
  label: string;
  mode: ThreadBenchmarkMode;
  fixturePath: string;
  fixtureName: string;
  fixtureBytes: number;
  fixtureTurns: number | null;
  threadId: string;
  controlThreadId: string;
  startedAt: number;
  finishedAt: number;
}

export interface ThreadBenchmarkProcessPeak {
  pid: number;
  role: string;
  label: string;
  agentId: string | null;
  peakCpuPercent: number;
  peakCpuPercentOfSystem: number;
  peakMemoryBytes: number;
  peakBusyThreads: number;
  peakThreadCount: number;
}

export interface ThreadBenchmarkInsights {
  durationMs: number;
  rendererReadyMs: number | null;
  switch: {
    durationMs: number | null;
    phase: string | null;
    success: boolean | null;
    clickToHighlightPaintMs: number | null;
    clickToSwitchResolvedMs: number | null;
    cacheHits: number;
    sessionLoads: number;
    sessionResumes: number;
    sessionNews: number;
    failures: number;
    slowSwitches: number;
  };
  processes: ThreadBenchmarkProcessPeak[];
  renderer: {
    sampleCount: number;
    peakJsHeapUsedBytes: number | null;
    maxLongTaskMs: number;
    totalLongTaskMs: number;
    maxGcPauseMs: number;
    peakDomNodeCount: number | null;
    freezeIncidentCount: number;
    freezeEpisodes: Array<{
      timestamp: number;
      blockedMs: number;
      sources: string[];
      visibilityState: string | null;
      activeThreadId: string | null;
    }>;
    domPeaks: Array<{
      id: string;
      peakNodeCount: number;
      peakNodeDelta: number;
      mutationCount: number;
    }>;
    eventTotals: {
      receivedCount: number;
      receivedBytes: number;
      applyMs: number;
      maxApplyMs: number;
      droppedCount: number;
      coalescedCount: number;
      bufferedCount: number;
      maxEventToPaintMs: number;
      ipcBurstCount: number;
      longTaskDuringBurstMs: number;
    };
  };
  acp: {
    updateCount: number;
    totalBytes: number;
    maxUpdateBytes: number;
    maxHandlerDurationMs: number;
    p95HandlerDurationMs: number | null;
    byType: Array<{ type: string; count: number; bytes: number }>;
    activeCount: number;
    backgroundCount: number;
  };
  bridge: {
    eventCount: number;
    totalBytes: number;
    dropped: number;
    coalesced: number;
    buffered: number;
    direct: number;
    maxSerializationMs: number;
    maxDeliveryMs: number;
  };
  diffs: {
    ingestionCount: number;
    totalDurationMs: number;
    maxDurationMs: number;
    totalSerializedUtf16Bytes: number;
    maxPostPaintMs: number;
  };
  incidents: Array<{
    id: number;
    timestamp: number;
    kind: string;
    summary: string;
  }>;
  connectionEpisodes: Array<{
    connectionId: string;
    agentId: string;
    terminalCause: string | null;
    intentional: boolean;
    uptimeMs: number | null;
  }>;
}

export interface ThreadBenchmarkReport {
  runId: string;
  mode: ThreadBenchmarkMode;
  threadId: string;
  startedAt: number;
  finishedAt: number;
  fixtureBytes: number;
  rendererReadyMs: number | null;
  totalRows: number | null;
  visibleRows: number | null;
  retainedEntries: number;
  retainedToolCalls: number;
  switchDurationMs: number | null;
  switchPhase: string | null;
  clickToPaintMs: number | null;
  receivedUpdateCount: number;
  receivedUpdateBytes: number;
  peakRendererHeapBytes: number | null;
  maxLongTaskMs: number;
  freezeIncidentCount: number;
  monitorSessionId: string | null;
  identity: ThreadBenchmarkIdentity;
  insights: ThreadBenchmarkInsights;
  artifactDir: string | null;
}

export interface ThreadBenchmarkCapture {
  schemaVersion: typeof THREAD_BENCHMARK_CAPTURE_SCHEMA_VERSION;
  identity: ThreadBenchmarkIdentity;
  report: ThreadBenchmarkReport;
  monitor: MonitorRecordedSession;
}

export interface ThreadBenchmarkIndexEntry {
  runId: string;
  monitorSessionId: string;
  label: string;
  mode: ThreadBenchmarkMode;
  fixtureName: string;
  fixtureTurns: number | null;
  fixtureBytes: number;
  startedAt: number;
  finishedAt: number;
  rendererReadyMs: number | null;
  switchPhase: string | null;
  freezeIncidentCount: number;
  path: string;
}

export interface ThreadBenchmarkIndex {
  schemaVersion: typeof THREAD_BENCHMARK_CAPTURE_SCHEMA_VERSION;
  updatedAt: string;
  outputDir: string;
  runs: ThreadBenchmarkIndexEntry[];
}

export interface ThreadBenchmarkStatus {
  enabled: boolean;
  prepared: ThreadBenchmarkPrepared | null;
  run: ThreadBenchmarkRun | null;
  rendererReady: ThreadBenchmarkRendererReady | null;
}
