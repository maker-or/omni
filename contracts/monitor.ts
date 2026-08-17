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
  /** Available for the Electron main process; null for external processes. */
  heapUsedBytes: number | null;
  heapTotalBytes: number | null;
  externalBytes: number | null;
  arrayBuffersBytes: number | null;
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

/** One ACP notification after it has been applied to the session reducer. */
export interface MonitorAcpUpdate {
  timestamp: number;
  agentId: string | null;
  connectionId: string | null;
  sessionId: string;
  threadId: string | null;
  threadRole: "active" | "background" | "unknown";
  turnId: string | null;
  updateType: string;
  updateBytes: number;
  handlerDurationMs: number;
  isStreaming: boolean;
  entryCount: number;
  toolCallCount: number;
  textBytes: number;
  thoughtBytes: number;
  toolPayloadBytes: number;
  largestToolPayloadBytes: number;
  sessionSnapshotBytes: number;
}

/** One bridge-to-renderer event accounting sample. */
export interface MonitorBridgeEvent {
  timestamp: number;
  eventType: string;
  bytes: number;
  serializationMs: number;
  deliveryMs: number;
  threadId: string | null;
  threadRole: "active" | "background" | "unknown";
  deliveryMode: "direct" | "buffered" | "coalesced" | "dropped";
}

export interface MonitorRendererEventStats {
  receivedCount: number;
  receivedBytes: number;
  activeCount: number;
  backgroundCount: number;
  applyMs: number;
  maxApplyMs: number;
  ignoredCount: number;
  bufferedCount: number;
  coalescedCount: number;
  droppedCount: number;
  tabClickCount: number;
  scrollCount: number;
  paintCount: number;
  eventToPaintMs: number;
  maxEventToPaintMs: number;
  maxEventsPerSecond: number;
  ipcBurstCount: number;
  maxBurstSize: number;
  longTaskDuringBurstMs: number;
  missedFrameDuringBurstCount: number;
}

/** Health of the monitor worker and its bounded persistence queue. */
export interface MonitorPipelineTelemetry {
  timestamp: number;
  queueDepth: number;
  queueCapacity: number;
  droppedWrites: number;
  writeFailures: number;
  workerFailures: number;
  lastWriteLatencyMs: number;
  maxWriteLatencyMs: number;
  lastFlushMs: number;
  lastError: string | null;
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
  recentAcpUpdates: MonitorAcpUpdate[];
  recentBridgeEvents: MonitorBridgeEvent[];
  pipelineTelemetry: MonitorPipelineTelemetry;
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

/**
 * DOM growth attribution for one monitored `data-pipper-id` boundary.
 *
 * Counts are sampled every renderer telemetry interval. Mutation counters are
 * reset after each sample and therefore describe the preceding interval.
 */
export interface MonitorDomAttribution {
  id: string;
  nodeCount: number;
  nodeDelta: number;
  addedNodeCount: number;
  removedNodeCount: number;
  mutationCount: number;
}

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
  domAttributions: MonitorDomAttribution[];
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
  rendererEvents: MonitorRendererEventStats;
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

/**
 * What the session cache did during a thread activation.
 *
 * `cache_hit`  – the thread's session slice already existed in
 *                AgentConnectionManager.sessions (a warm switch; no ACP round
 *                trip, just a snapshot re-emit).
 * `session_load` – no cached slice; the thread had a stored agent session id
 *                and it was loaded over ACP (cold replay).
 * `session_resume` – a load attempt failed mid-replay and the runtime was
 *                resumed instead.
 * `session_new`  – neither load nor resume could establish a session; a brand
 *                new session was created.
 *
 * The cache_hit / session_load split is the exact discriminator for the
 * "adding a 5th tab made my warm tabs cold" hypothesis: if warm threads stop
 * being cache_hits after a tab is added, the cache is being invalidated.
 */
export type MonitorSwitchPhase = "cache_hit" | "session_load" | "session_resume" | "session_new";

/**
 * One thread activation (switch), recorded for EVERY activation regardless of
 * duration. Unlike `switch_slow`/`switch_failed` incidents, these rows are
 * written unconditionally so sub-second warm switches are observable and can
 * be correlated with tab-set mutations around them.
 */
export interface MonitorSwitchRecord {
  timestamp: number;
  threadId: string;
  agentId: string | null;
  projectId: string | null;
  /** Which activation path produced the switch. */
  source: "tab" | "restore" | "delete" | "project" | "orchestration" | "other";
  phase: MonitorSwitchPhase;
  durationMs: number;
  success: boolean;
  error?: string;
  /** Open-tab count at switch time (read from the tabs state). */
  openTabCount: number;
  previousThreadId: string | null;
}

/**
 * A mutation to the open-tab set. Durable so a switch can be correlated with
 * the exact tab-count transition that preceded it (e.g. "4 -> 5").
 */
export interface MonitorTabEvent {
  timestamp: number;
  action: "open" | "close" | "activate";
  threadId: string;
  openTabCount: number;
  activeThreadId: string | null;
}

/**
 * Renderer-side click-to-paint timing for a tab activation. Captures how long
 * the renderer main thread took to re-render the newly-highlighted tab after
 * the user clicked, which isolates renderer starvation from main-process
 * switch latency (cache hits can still *feel* laggy if the renderer is pegged).
 */
export interface MonitorTabClickTiming {
  timestamp: number;
  threadId: string;
  clickToHighlightPaintMs: number;
  /** millis from the click until the main-process switch IPC resolved. */
  clickToSwitchResolvedMs: number;
  /** main-process switch duration as reported by AgentConnectionManager. */
  switchDurationMs: number | null;
  phase: MonitorSwitchPhase | null;
  success: boolean;
}

/**
 * A single row in the correlated switch timeline: one of the three durable
 * streams (tab-set mutation, switch record, or renderer click timing) annotated
 * with the running open-tab count that was in effect when it fired.
 */
export type MonitorTimelineRow =
  | { kind: "tab_event"; timestamp: number; openTabCount: number; event: MonitorTabEvent }
  | { kind: "switch"; timestamp: number; openTabCount: number; record: MonitorSwitchRecord }
  | { kind: "click"; timestamp: number; openTabCount: number; timing: MonitorTabClickTiming };

export interface MonitorSwitchTimelineSummary {
  totalSwitches: number;
  cacheHits: number;
  sessionLoads: number;
  sessionResumes: number;
  sessionNews: number;
  failures: number;
  slowSwitches: number;
  /** Switches that fired within 2s after a tab-count change. */
  switchesAfterTabChange: number;
}

/**
 * Correlated view for diagnosing tab-switch latency: the three durable streams
 * merged into one time-ordered timeline, each switch annotated with the
 * nearest-prior open-tab count, plus a phase-distribution summary.
 */
export interface MonitorSwitchTimeline {
  rows: MonitorTimelineRow[];
  switches: MonitorSwitchRecord[];
  tabEvents: MonitorTabEvent[];
  clickTimings: MonitorTabClickTiming[];
  summary: MonitorSwitchTimelineSummary;
}

/** Inclusive wall-clock window used to attach unscoped monitor rows to a recording. */
export interface MonitorTimeRange {
  from: number;
  to: number;
}

/**
 * Everything the durable monitor can reconstruct for one recording session.
 * Process ticks / renderer / ACP / bridge / diff rows are keyed by session id.
 * Switches, tab events, click timings, and connection episodes are attached by
 * overlapping the recording window.
 */
export interface MonitorRecordedSession {
  session: MonitorSession | null;
  ticks: MonitorSampleTick[];
  rendererTelemetry: MonitorRendererTelemetry[];
  diffIngestions: MonitorDiffIngestion[];
  acpUpdates: MonitorAcpUpdate[];
  bridgeEvents: MonitorBridgeEvent[];
  connectionEpisodes: MonitorConnectionEpisode[];
  incidents: MonitorIncident[];
  switches: MonitorSwitchRecord[];
  tabEvents: MonitorTabEvent[];
  clickTimings: MonitorTabClickTiming[];
  switchTimeline: MonitorSwitchTimeline;
  summary: MonitorSessionSummary;
}
