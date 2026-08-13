export type MonitorProcessRole =
  | "electron-main"
  | "electron-renderer"
  | "electron-gpu"
  | "electron-other"
  | "acp-agent"
  | "terminal"
  | "pty";

export interface MonitorProcessDescriptor {
  pid: number;
  role: MonitorProcessRole;
  label: string;
  agentId?: string;
  threadId?: string;
  threadIds?: string[];
  streamingThreadIds?: string[];
  sessionId?: string;
  isStreaming?: boolean;
}

export interface MonitorProcessSample {
  pid: number;
  role: MonitorProcessRole;
  label: string;
  agentId?: string;
  threadId?: string;
  threadIds: string[];
  streamingThreadIds: string[];
  sessionId?: string;
  isStreaming?: boolean;
  cpuPercent: number;
  cpuPercentOfSystem: number;
  memoryBytes: number;
  threadCount: number;
  busyThreads: number;
  idleThreads: number;
  runnableThreads: number;
  blockedThreads: number;
  sleepingThreads: number;
}

export interface MonitorSampleTick {
  timestamp: number;
  processes: MonitorProcessSample[];
}

export type MonitorIncidentKind =
  | "renderer_freeze"
  | "connection_loss"
  | "switch_slow"
  | "switch_failed"
  | "tab_highlight_mismatch";

export interface MonitorIncident {
  id: number;
  timestamp: number;
  kind: MonitorIncidentKind;
  summary: string;
  payload: Record<string, unknown>;
}

export type MonitorConnectionTerminalCause =
  | "transport_closed"
  | "process_exit"
  | "transport_then_process_exit";

/** One ACP process/transport lifecycle, deduplicated across close + exit events. */
export interface MonitorConnectionEpisode {
  connectionId: string;
  agentId: string;
  pid: number | null;
  spawnedAt: number;
  initializedAt: number | null;
  transportClosedAt: number | null;
  processExitedAt: number | null;
  endedAt: number | null;
  exitCode: number | null;
  signal: string | null;
  intentional: boolean;
  terminalCause: MonitorConnectionTerminalCause | null;
  activeThreadId: string | null;
  runningThreadIds: string[];
  uptimeMs: number | null;
  stderrTail: string;
  reconnectAttempt: number;
  previousConnectionId: string | null;
}

export interface MonitorSession {
  id: string;
  label: string;
  startedAt: number;
  endedAt: number | null;
}

export interface MonitorLiveSnapshot {
  timestamp: number;
  recording: boolean;
  recordingSessionId: string | null;
  recordingStartedAt: number | null;
  systemCpuCount: number;
  aggregate: MonitorAggregate;
  recentTicks: MonitorSampleTick[];
  runningThreadIds: string[];
  rendererTelemetry: MonitorRendererTelemetry | null;
  recentRendererTelemetry: MonitorRendererTelemetry[];
}

export interface MonitorAggregate {
  processCount: number;
  totalCpuPercent: number;
  totalCpuPercentOfSystem: number;
  totalMemoryBytes: number;
  osThreadCount: number;
  busyThreads: number;
  idleThreads: number;
  streamingThreadCount: number;
}

export interface MonitorSessionSummary extends MonitorAggregate {
  durationMs: number;
  sampleCount: number;
  incidentCount: number;
  peakCpuPercent: number;
  peakCpuPercentOfSystem: number;
  peakMemoryBytes: number;
  peakBusyThreads: number;
}

export interface MonitorRendererFreezeReport {
  phase?: "start" | "end";
  episodeId?: string;
  observerId?: string;
  sequence?: number;
  source?: MonitorFreezeSource;
  sources?: MonitorFreezeSource[];
  blockedMs: number;
  longTaskMs?: number;
  maxBlockedMs?: number;
  episodeDurationMs?: number;
  signalCount?: number;
  observedAt?: number;
  monotonicMs?: number;
  visibilityState?: string;
  focused?: boolean;
  activeThreadId?: string | null;
  runningThreadIds?: string[];
}

export type MonitorFreezeSource = "longtask" | "raf_gap" | "timer_drift";

export interface MonitorRendererTelemetry {
  timestamp: number;
  monotonicMs: number;
  observerId: string;
  visibilityState: string;
  focused: boolean;
  activeThreadId: string | null;
  runningThreadCount: number;
  jsHeapUsedBytes: number | null;
  jsHeapTotalBytes: number | null;
  jsHeapLimitBytes: number | null;
  domNodeCount: number | null;
  diffThreadCount: number;
  diffToolCallCount: number;
  diffFileCount: number;
  diffIngestionCount: number;
  diffIngestionMs: number;
  diffSerializedUtf16Bytes: number;
  diffExtractedFileCount: number;
  diffChangedFileCount: number;
  longTaskCount: number;
  longTaskMs: number;
  gcPauseCount: number;
  gcPauseMs: number;
}

/**
 * One synchronous diff-store ingestion, followed through to the next paint
 * opportunity. Unlike the five-second renderer telemetry counters, these
 * rows make an individual ingestion directly comparable to a freeze episode.
 */
export interface MonitorDiffIngestion {
  timestamp: number;
  activeThreadId: string | null;
  ingestedThreadId: string;
  activeThreadStreaming: boolean;
  isActiveThread: boolean;
  visibilityState: string;
  focused: boolean;
  threadCount: number;
  toolCallCount: number;
  fileCount: number;
  durationMs: number;
  serializedUtf16Bytes: number;
  extractedFileCount: number;
  changedFileCount: number;
  nextFrameMs: number;
  postPaintMs: number;
}

export interface MonitorTabMismatchReport {
  shownThreadId: string;
  realThreadId: string;
  durationMs: number;
  agentId?: string | null;
}
