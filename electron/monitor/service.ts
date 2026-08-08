import { app } from "electron";
import { randomUUID } from "node:crypto";
import os from "node:os";
import type {
  MonitorAggregate,
  MonitorLiveSnapshot,
  MonitorProcessDescriptor,
  MonitorProcessSample,
  MonitorRendererFreezeReport,
  MonitorSampleTick,
  MonitorSession,
  MonitorSessionSummary,
  MonitorTabMismatchReport,
} from "../../contracts/monitor.ts";
import { samplePid } from "./platform-sampler.ts";
import {
  ensureMonitorTables,
  finishMonitorSession,
  insertIncident,
  insertMonitorSession,
  insertSampleBatch,
  listIncidents,
  listMonitorSessions,
  getSessionTicks,
  pruneOldSamples,
} from "./db.ts";

const SAMPLE_INTERVAL_MS = 1000;
const RING_CAPACITY = 300;
const SLOW_SWITCH_MS = 3000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface MonitorConnectionLossEvent {
  agentId: string;
  pid: number | null;
  cause?: "transport_closed" | "process_exit";
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  activeThreadId: string | null;
  runningThreadIds: string[];
  uptimeMs: number;
}

export interface MonitorServiceOptions {
  getInventory: () => MonitorProcessDescriptor[];
  getRunningThreadIds: () => string[];
  onBroadcast: (channel: string, payload: unknown) => void;
}

export class MonitorService {
  private readonly getInventory: () => MonitorProcessDescriptor[];
  private readonly getRunningThreadIds: () => string[];
  private readonly onBroadcast: (channel: string, payload: unknown) => void;

  private timer: NodeJS.Timeout | null = null;
  private sampling = false;
  private readonly ring: MonitorSampleTick[] = [];
  private recordingSessionId: string | null = null;
  private recordingStartedAt: number | null = null;
  private readonly connectionStartedAt = new Map<string, number>();

  constructor(options: MonitorServiceOptions) {
    this.getInventory = options.getInventory;
    this.getRunningThreadIds = options.getRunningThreadIds;
    this.onBroadcast = options.onBroadcast;
    ensureMonitorTables();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, SAMPLE_INTERVAL_MS);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isEnabled(): boolean {
    return true;
  }

  getLiveSnapshot(): MonitorLiveSnapshot {
    const recentTicks = [...this.ring];
    const latestTick = recentTicks.at(-1);
    return {
      timestamp: Date.now(),
      recording: this.recordingSessionId != null,
      recordingSessionId: this.recordingSessionId,
      recordingStartedAt: this.recordingStartedAt,
      systemCpuCount: Math.max(os.cpus().length, 1),
      aggregate: aggregateSamples(latestTick?.processes ?? []),
      recentTicks,
      runningThreadIds: this.getRunningThreadIds(),
    };
  }

  getIncidents(limit = 100) {
    return listIncidents(limit);
  }

  getSessions(limit = 50): MonitorSession[] {
    return listMonitorSessions(limit);
  }

  getRecordedSession(sessionId: string) {
    const ticks = getSessionTicks(sessionId);
    const session = listMonitorSessions(200).find((entry) => entry.id === sessionId) ?? null;
    const incidents = listIncidents(500).filter((incident) => {
      const payloadSessionId = incident.payload.sessionId;
      return payloadSessionId === sessionId;
    });
    return {
      session,
      ticks,
      incidents,
      summary: summarizeSession(ticks, session, incidents.length),
    };
  }

  startRecording(label?: string): MonitorSession {
    if (this.recordingSessionId) {
      this.stopRecording();
    }
    const session: MonitorSession = {
      id: randomUUID(),
      label: label?.trim() || `Session ${new Date().toLocaleString()}`,
      startedAt: Date.now(),
      endedAt: null,
    };
    insertMonitorSession(session);
    this.recordingSessionId = session.id;
    this.recordingStartedAt = session.startedAt;
    this.broadcastLive();
    return session;
  }

  stopRecording(): MonitorSession | null {
    if (!this.recordingSessionId) return null;
    const session = listMonitorSessions(200).find((entry) => entry.id === this.recordingSessionId);
    const endedAt = Date.now();
    finishMonitorSession(this.recordingSessionId, endedAt);
    const finishedSession: MonitorSession = {
      id: this.recordingSessionId,
      label: session?.label ?? "Recording",
      startedAt: session?.startedAt ?? this.recordingStartedAt ?? endedAt,
      endedAt,
    };
    this.recordingSessionId = null;
    this.recordingStartedAt = null;
    this.broadcastLive();
    return finishedSession;
  }

  noteConnectionStarted(agentId: string): void {
    this.connectionStartedAt.set(agentId, Date.now());
  }

  noteConnectionLost(event: MonitorConnectionLossEvent): void {
    const preDropTicks = this.ring.slice(-30);
    const incident = insertIncident(
      "connection_loss",
      `ACP connection lost (${event.agentId}${event.cause ? ` · ${event.cause}` : ""})`,
      {
        ...event,
        preDropTicks,
        sessionId: this.recordingSessionId,
      },
    );
    this.connectionStartedAt.delete(event.agentId);
    this.onBroadcast("monitor:incident", incident);
    this.broadcastLive();
  }

  reportRendererFreeze(report: MonitorRendererFreezeReport): void {
    if (report.blockedMs < 200) return;
    const incident = insertIncident(
      "renderer_freeze",
      `Renderer blocked ${Math.round(report.blockedMs)}ms`,
      {
        ...report,
        runningThreadIds: report.runningThreadIds ?? this.getRunningThreadIds(),
        preDropTicks: this.ring.slice(-15),
        sessionId: this.recordingSessionId,
      },
    );
    this.onBroadcast("monitor:incident", incident);
  }

  reportTabMismatch(report: MonitorTabMismatchReport): void {
    const incident = insertIncident(
      "tab_highlight_mismatch",
      `Tab highlight mismatch (${Math.round(report.durationMs)}ms)`,
      {
        ...report,
        sessionId: this.recordingSessionId,
      },
    );
    this.onBroadcast("monitor:incident", incident);
  }

  noteSwitchCompleted(input: {
    threadId: string;
    durationMs: number;
    success: boolean;
    error?: string;
  }): void {
    if (!input.success) {
      const incident = insertIncident("switch_failed", `Thread switch failed (${input.threadId})`, {
        ...input,
        preDropTicks: this.ring.slice(-15),
        sessionId: this.recordingSessionId,
      });
      this.onBroadcast("monitor:incident", incident);
      this.broadcastLive();
      return;
    }
    if (input.durationMs >= SLOW_SWITCH_MS) {
      const incident = insertIncident(
        "switch_slow",
        `Slow thread switch (${Math.round(input.durationMs)}ms)`,
        {
          ...input,
          preDropTicks: this.ring.slice(-15),
          sessionId: this.recordingSessionId,
        },
      );
      this.onBroadcast("monitor:incident", incident);
      this.broadcastLive();
    }
  }

  private async tick(): Promise<void> {
    if (this.sampling) return;
    this.sampling = true;
    try {
      const tick = await this.collectTick();
      this.pushRing(tick);
      if (this.recordingSessionId) {
        insertSampleBatch(this.recordingSessionId, tick);
      }
      this.onBroadcast("monitor:tick", tick);
      this.broadcastLive();
      if (Math.random() < 0.01) {
        pruneOldSamples(RETENTION_MS);
      }
    } finally {
      this.sampling = false;
    }
  }

  private pushRing(tick: MonitorSampleTick): void {
    this.ring.push(tick);
    while (this.ring.length > RING_CAPACITY) {
      this.ring.shift();
    }
  }

  private broadcastLive(): void {
    this.onBroadcast("monitor:live", this.getLiveSnapshot());
  }

  private async collectTick(): Promise<MonitorSampleTick> {
    const timestamp = Date.now();
    const descriptors = this.mergeElectronMetrics(this.getInventory());
    const uniqueByPid = new Map<number, MonitorProcessDescriptor>();
    for (const descriptor of descriptors) {
      if (!uniqueByPid.has(descriptor.pid)) {
        uniqueByPid.set(descriptor.pid, descriptor);
      }
    }

    const processes: MonitorProcessSample[] = [];
    await Promise.all(
      [...uniqueByPid.entries()].map(async ([pid, descriptor]) => {
        const metrics = await samplePid(pid);
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

  private mergeElectronMetrics(
    descriptors: MonitorProcessDescriptor[],
  ): MonitorProcessDescriptor[] {
    const merged = [...descriptors];
    try {
      for (const metric of app.getAppMetrics()) {
        if (!metric.pid || merged.some((entry) => entry.pid === metric.pid)) continue;
        const role =
          metric.type === "GPU"
            ? "electron-gpu"
            : metric.type === "Tab" || metric.type === "Browser"
              ? "electron-renderer"
              : "electron-other";
        merged.push({
          pid: metric.pid,
          role,
          label: `Electron ${metric.type ?? "process"}`,
        });
      }
    } catch {
      // app.getAppMetrics may fail before ready
    }
    return merged;
  }
}

function aggregateSamples(samples: MonitorProcessSample[]): MonitorAggregate {
  return {
    processCount: samples.length,
    totalCpuPercent: samples.reduce((total, sample) => total + sample.cpuPercent, 0),
    totalCpuPercentOfSystem: samples.reduce(
      (total, sample) => total + sample.cpuPercentOfSystem,
      0,
    ),
    totalMemoryBytes: samples.reduce((total, sample) => total + sample.memoryBytes, 0),
    osThreadCount: samples.reduce((total, sample) => total + sample.threadCount, 0),
    busyThreads: samples.reduce((total, sample) => total + sample.busyThreads, 0),
    idleThreads: samples.reduce((total, sample) => total + sample.idleThreads, 0),
    streamingThreadCount: new Set(samples.flatMap((sample) => sample.streamingThreadIds)).size,
  };
}

function summarizeSession(
  ticks: MonitorSampleTick[],
  session: MonitorSession | null,
  incidentCount: number,
): MonitorSessionSummary {
  const aggregates = ticks.map((tick) => aggregateSamples(tick.processes));
  const latest = aggregates.at(-1) ?? aggregateSamples([]);
  return {
    ...latest,
    durationMs:
      session?.endedAt != null
        ? session.endedAt - session.startedAt
        : ticks.length > 1
          ? ticks.at(-1)!.timestamp - ticks[0].timestamp
          : 0,
    sampleCount: ticks.length,
    incidentCount,
    peakCpuPercent: Math.max(0, ...aggregates.map((aggregate) => aggregate.totalCpuPercent)),
    peakCpuPercentOfSystem: Math.max(
      0,
      ...aggregates.map((aggregate) => aggregate.totalCpuPercentOfSystem),
    ),
    peakMemoryBytes: Math.max(0, ...aggregates.map((aggregate) => aggregate.totalMemoryBytes)),
    peakBusyThreads: Math.max(0, ...aggregates.map((aggregate) => aggregate.busyThreads)),
  };
}
