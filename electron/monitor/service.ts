import { app } from "electron";
import { randomUUID } from "node:crypto";
import os from "node:os";
import type {
  MonitorAggregate,
  MonitorConnectionEpisode,
  MonitorDiffIngestion,
  MonitorLiveSnapshot,
  MonitorProcessDescriptor,
  MonitorProcessSample,
  MonitorRendererTelemetry,
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
  getMonitorSession,
  insertIncident,
  insertDiffIngestion,
  insertMonitorSession,
  insertRendererTelemetry,
  insertSampleBatch,
  listIncidents,
  listMonitorSessions,
  getSessionTicks,
  getRendererTelemetry,
  getDiffIngestions,
  getConnectionEpisodes,
  upsertConnectionEpisode,
  pruneOldSamples,
  updateIncident,
} from "./db.ts";

const SAMPLE_INTERVAL_MS = 1000;
const RING_CAPACITY = 300;
const RENDERER_RING_CAPACITY = 120;
const MAX_RENDERER_EPISODES = 256;
const SLOW_SWITCH_MS = 3000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface MonitorConnectionLossEvent {
  connectionId: string;
  agentId: string;
  pid: number | null;
  cause?: "transport_closed" | "process_exit";
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  activeThreadId: string | null;
  runningThreadIds: string[];
  uptimeMs: number;
  intentional?: boolean;
  stderrTail?: string;
}

export interface MonitorConnectionStartedEvent {
  connectionId: string;
  agentId: string;
  pid: number | null;
  spawnedAt: number;
  previousConnectionId: string | null;
}

export interface MonitorConnectionReadyEvent {
  connectionId: string;
  initializedAt: number;
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
  private readonly rendererRing: MonitorRendererTelemetry[] = [];
  private readonly rendererEpisodes = new Map<
    string,
    { incidentId: number; payload: Record<string, unknown> }
  >();
  private recordingSessionId: string | null = null;
  private recordingStartedAt: number | null = null;
  private readonly connectionStartedAt = new Map<string, number>();
  private readonly connectionEpisodes = new Map<string, MonitorConnectionEpisode>();
  private readonly connectionIncidentIds = new Map<string, number>();
  private readonly reconnectAttempts = new Map<string, number>();

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
      rendererTelemetry: this.rendererRing.at(-1) ?? null,
      recentRendererTelemetry: [...this.rendererRing],
    };
  }

  getIncidents(limit = 100) {
    return listIncidents(limit);
  }

  getConnectionEpisodes(limit = 200): MonitorConnectionEpisode[] {
    return getConnectionEpisodes(limit);
  }

  getSessions(limit = 50): MonitorSession[] {
    return listMonitorSessions(limit);
  }

  getRecordedSession(sessionId: string) {
    const ticks = getSessionTicks(sessionId);
    const session = getMonitorSession(sessionId);
    const incidents = listIncidents(500).filter((incident) => {
      const payloadSessionId = incident.payload.sessionId;
      return payloadSessionId === sessionId;
    });
    return {
      session,
      ticks,
      rendererTelemetry: getRendererTelemetry(sessionId),
      diffIngestions: getDiffIngestions(sessionId),
      connectionEpisodes: getConnectionEpisodes(500),
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

  noteConnectionStarted(event: MonitorConnectionStartedEvent): void {
    const reconnectAttempt = (this.reconnectAttempts.get(event.agentId) ?? 0) + 1;
    this.reconnectAttempts.set(event.agentId, reconnectAttempt);
    this.connectionStartedAt.set(event.connectionId, event.spawnedAt);
    const episode: MonitorConnectionEpisode = {
      connectionId: event.connectionId,
      agentId: event.agentId,
      pid: event.pid,
      spawnedAt: event.spawnedAt,
      initializedAt: null,
      transportClosedAt: null,
      processExitedAt: null,
      endedAt: null,
      exitCode: null,
      signal: null,
      intentional: false,
      terminalCause: null,
      activeThreadId: null,
      runningThreadIds: [],
      uptimeMs: null,
      stderrTail: "",
      reconnectAttempt,
      previousConnectionId: event.previousConnectionId,
    };
    this.connectionEpisodes.set(event.connectionId, episode);
    upsertConnectionEpisode(episode);
  }

  noteConnectionReady(event: MonitorConnectionReadyEvent): void {
    const episode = this.connectionEpisodes.get(event.connectionId);
    if (!episode) return;
    episode.initializedAt = event.initializedAt;
    upsertConnectionEpisode(episode);
  }

  noteConnectionLost(event: MonitorConnectionLossEvent): void {
    const episode =
      this.connectionEpisodes.get(event.connectionId) ??
      ({
        connectionId: event.connectionId,
        agentId: event.agentId,
        pid: event.pid,
        spawnedAt: Date.now() - event.uptimeMs,
        initializedAt: null,
        transportClosedAt: null,
        processExitedAt: null,
        endedAt: null,
        exitCode: null,
        signal: null,
        intentional: false,
        terminalCause: null,
        activeThreadId: null,
        runningThreadIds: [],
        uptimeMs: null,
        stderrTail: "",
        reconnectAttempt: this.reconnectAttempts.get(event.agentId) ?? 1,
        previousConnectionId: null,
      } satisfies MonitorConnectionEpisode);
    const now = Date.now();
    if (event.cause === "transport_closed") episode.transportClosedAt ??= now;
    if (event.cause === "process_exit") {
      episode.processExitedAt ??= now;
      episode.exitCode = event.exitCode;
      episode.signal = event.signal;
    }
    episode.endedAt = now;
    episode.intentional ||= event.intentional === true;
    episode.activeThreadId = event.activeThreadId;
    episode.runningThreadIds = event.runningThreadIds;
    episode.uptimeMs = event.uptimeMs;
    if (event.stderrTail) episode.stderrTail = event.stderrTail;
    episode.terminalCause =
      episode.processExitedAt && episode.transportClosedAt
        ? "transport_then_process_exit"
        : (event.cause ?? "transport_closed");
    this.connectionEpisodes.set(event.connectionId, episode);
    upsertConnectionEpisode(episode);
    // Expected app shutdowns belong in the lifecycle table, but are not
    // failures and should not inflate the incident stream.
    if (episode.intentional) {
      this.connectionStartedAt.delete(event.connectionId);
      return;
    }
    const preDropTicks = this.ring.slice(-30);
    const payload = {
      ...episode,
      preDropTicks,
      sessionId: this.recordingSessionId,
    };
    const existingIncidentId = this.connectionIncidentIds.get(event.connectionId);
    const incident = existingIncidentId
      ? updateIncident(
          existingIncidentId,
          payload,
          `ACP connection lost (${event.agentId} · ${episode.terminalCause})`,
        )
      : insertIncident(
          "connection_loss",
          `ACP connection lost (${event.agentId} · ${episode.terminalCause})`,
          payload,
        );
    if (!incident) return;
    if (!existingIncidentId) this.connectionIncidentIds.set(event.connectionId, incident.id);
    this.connectionStartedAt.delete(event.connectionId);
    this.onBroadcast("monitor:incident", incident);
    this.broadcastLive();
  }

  reportRendererFreeze(report: MonitorRendererFreezeReport): void {
    if (report.blockedMs < 200 && report.phase !== "end") return;
    const episodeId = report.episodeId ?? randomUUID();
    const phase = report.phase ?? "start";
    const existing = this.rendererEpisodes.get(episodeId);
    if (phase === "end" && existing) {
      const payload = { ...existing.payload, ...report, phase, endedAt: Date.now() };
      const incident = updateIncident(
        existing.incidentId,
        payload,
        `Renderer freeze episode ${Math.round(Number(payload.maxBlockedMs ?? report.blockedMs))}ms`,
      );
      this.rendererEpisodes.delete(episodeId);
      if (incident) this.onBroadcast("monitor:incident", incident);
      return;
    }

    if (existing) return;
    const payload = {
      ...report,
      phase: "start",
      episodeId,
      runningThreadIds: report.runningThreadIds ?? this.getRunningThreadIds(),
      preDropTicks: this.ring.slice(-5),
      rendererTelemetry: this.rendererRing.slice(-3),
      sessionId: this.recordingSessionId,
    };
    const incident = insertIncident(
      "renderer_freeze",
      `Renderer freeze episode started (${Math.round(report.blockedMs)}ms)`,
      payload,
    );
    this.rendererEpisodes.set(episodeId, { incidentId: incident.id, payload });
    while (this.rendererEpisodes.size > MAX_RENDERER_EPISODES) {
      const oldest = this.rendererEpisodes.keys().next().value;
      if (!oldest) break;
      this.rendererEpisodes.delete(oldest);
    }
    this.onBroadcast("monitor:incident", incident);
  }

  reportRendererTelemetry(telemetry: MonitorRendererTelemetry): void {
    this.rendererRing.push(telemetry);
    while (this.rendererRing.length > RENDERER_RING_CAPACITY) this.rendererRing.shift();
    if (this.recordingSessionId) insertRendererTelemetry(this.recordingSessionId, telemetry);
  }

  reportDiffIngestion(ingestion: MonitorDiffIngestion): void {
    // High-frequency traces are useful only when they can be correlated with
    // a deliberate recording. Avoid continuously growing the local database.
    if (!this.recordingSessionId) return;
    insertDiffIngestion(this.recordingSessionId, ingestion);
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
