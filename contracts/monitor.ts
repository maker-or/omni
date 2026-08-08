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
  blockedMs: number;
  longTaskMs?: number;
  activeThreadId?: string | null;
  runningThreadIds?: string[];
}

export interface MonitorTabMismatchReport {
  shownThreadId: string;
  realThreadId: string;
  durationMs: number;
  agentId?: string | null;
}
