import { app } from "electron";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { join } from "node:path";
import type {
  MonitorAggregate,
  MonitorAcpUpdate,
  MonitorBridgeEvent,
  MonitorConnectionEpisode,
  MonitorDemand,
  MonitorDiffIngestion,
  MonitorIncident,
  MonitorIncidentKind,
  MonitorLiveMessage,
  MonitorLiveScalars,
  MonitorLiveSnapshot,
  MonitorProcessDescriptor,
  MonitorProcessSample,
  MonitorPruneReport,
  MonitorRecordedSession,
  MonitorRendererTelemetry,
  MonitorRendererFreezeReport,
  MonitorSampleTick,
  MonitorSession,
  MonitorSessionCacheEvent,
  MonitorSessionSummary,
  MonitorSwitchRecord,
  MonitorTabClickTiming,
  MonitorTabEvent,
  MonitorTabMismatchReport,
} from "../../contracts/monitor.ts";
import { buildSwitchTimeline, emptyMonitorRecordedSession, SLOW_SWITCH_MS } from "./timeline.ts";
import { getDb } from "../db.ts";
import { sampleCurrentProcessMetrics } from "./platform-sampler.ts";
import {
  ensureMonitorTables,
  getMonitorSession,
  insertIncident,
  initializeMonitorDb,
  insertSessionCacheEvent,
  insertSwitchRecord,
  insertTabEvent,
  insertTabClickTiming,
  listIncidents,
  listMonitorSessions,
  listSessionCacheEvents,
  listSwitchRecords,
  listTabEvents,
  listTabClickTimings,
  getSessionTicks,
  getRendererTelemetry,
  getDiffIngestions,
  getAcpUpdates,
  getBridgeEvents,
  getConnectionEpisodes,
  upsertConnectionEpisode,
  updateIncident,
} from "./db.ts";
import { IncidentCoalescer, mergeOccurrence } from "./incident-coalescer.ts";
import { buildLiveSnapshot, createMonitorLiveRings, MonitorLiveFeed } from "./live-feed.ts";
import { DEFAULT_MONITOR_RETENTION } from "./retention.ts";
import { MonitorWorkerClient } from "./worker-client.ts";
import {
  MONITOR_DATABASE_FILE,
  hasLegacyMonitorTables,
  openMonitorDatabase,
  reserveLegacyMonitorIds,
} from "./storage.ts";

const SAMPLE_INTERVAL_MS = 1000;
/**
 * Without a live subscriber or recording, per-thread process states (an extra
 * `ps` launch on macOS) are refreshed on every Nth tick only. CPU and RSS are
 * sampled every tick regardless, so incident context stays current.
 */
const BACKGROUND_DETAIL_EVERY_TICKS = 10;
const MAX_RENDERER_EPISODES = 256;
const FIRST_PRUNE_DELAY_MS = 60_000;
const PRUNE_INTERVAL_MS = 30 * 60_000;
/** Retry interval when a pass stopped at its batch budget. */
const PRUNE_CONTINUE_MS = 60_000;
const SYSTEM_CPU_COUNT = Math.max(os.availableParallelism?.() ?? os.cpus().length, 1);

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
  sessionCountAtTermination?: number;
  invalidatedThreadIds?: string[];
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
  /** Detailed collection is wanted when a monitor window or recording needs it. */
  onDemandChange?: (demand: MonitorDemand) => void;
}

export class MonitorService {
  private readonly getInventory: () => MonitorProcessDescriptor[];
  private readonly getRunningThreadIds: () => string[];
  private readonly onBroadcast: (channel: string, payload: unknown) => void;
  private readonly onDemandChange?: (demand: MonitorDemand) => void;
  private readonly worker: MonitorWorkerClient;

  private timer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private sampling = false;
  private tickCount = 0;
  private detailed = false;
  private lastPrune: MonitorPruneReport | null = null;
  private readonly rings = createMonitorLiveRings();
  private readonly feed: MonitorLiveFeed;
  private readonly coalescer = new IncidentCoalescer();
  private readonly rendererEpisodes = new Map<
    string,
    { incidentId: number; coalesceKey: string; first: boolean }
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
    this.onDemandChange = options.onDemandChange;
    this.feed = new MonitorLiveFeed({
      rings: this.rings,
      scalars: () => this.liveScalars(),
      onSubscribersChanged: () => this.updateDemand(),
    });
    // Diagnostics have their own database file; see storage.ts.
    const monitorPath = join(app.getPath("userData"), MONITOR_DATABASE_FILE);
    const monitorDb = openMonitorDatabase(monitorPath);
    initializeMonitorDb(monitorDb);
    ensureMonitorTables();
    const appDb = getDb();
    const legacyRows = hasLegacyMonitorTables(appDb);
    if (legacyRows) reserveLegacyMonitorIds(monitorDb, appDb);
    this.worker = new MonitorWorkerClient(monitorPath, {
      legacyDbPath: legacyRows ? join(app.getPath("userData"), "omni.sqlite") : undefined,
    });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        console.error("[Monitor] Sampling failed:", error);
      });
    }, SAMPLE_INTERVAL_MS);
    this.timer.unref?.();
    void this.tick().catch((error) => {
      console.error("[Monitor] Initial sampling failed:", error);
    });
    this.schedulePrune(FIRST_PRUNE_DELAY_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.pruneTimer) {
      clearTimeout(this.pruneTimer);
      this.pruneTimer = null;
    }
    this.feed.dispose();
    void this.worker.shutdown().catch((error) => {
      console.error("[Monitor] Worker shutdown failed:", error);
    });
  }

  isEnabled(): boolean {
    return true;
  }

  getLiveSnapshot(): MonitorLiveSnapshot {
    return buildLiveSnapshot(this.liveScalars(), this.rings);
  }

  getDemand(): MonitorDemand {
    return { detailed: this.detailed };
  }

  /**
   * Live feed for a monitor window: a full snapshot now, then coalesced
   * deltas. Snapshots are only built while someone is subscribed.
   */
  subscribeLive(id: string | number, send: (message: MonitorLiveMessage) => void): void {
    this.feed.subscribe(id, send);
  }

  unsubscribeLive(id: string | number): void {
    this.feed.unsubscribe(id);
  }

  acknowledgeLive(id: string | number, revision: number): void {
    this.feed.acknowledge(id, revision);
  }

  resyncLive(id: string | number): void {
    this.feed.resync(id);
  }

  private liveScalars(): MonitorLiveScalars {
    const latestTick = this.rings.ticks.at(-1);
    return {
      timestamp: Date.now(),
      recording: this.recordingSessionId != null,
      recordingSessionId: this.recordingSessionId,
      recordingStartedAt: this.recordingStartedAt,
      systemCpuCount: SYSTEM_CPU_COUNT,
      aggregate: aggregateSamples(latestTick?.processes ?? []),
      runningThreadIds: this.getRunningThreadIds(),
      rendererTelemetry: this.rings.rendererTelemetry.at(-1) ?? null,
      pipelineTelemetry: {
        timestamp: Date.now(),
        ...this.worker.health(),
        detailedSampling: this.detailed,
        liveSubscribers: this.feed.subscriberCount,
        lastPrune: this.lastPrune,
      },
    };
  }

  private updateDemand(): void {
    const detailed = this.feed.subscriberCount > 0 || this.recordingSessionId != null;
    if (detailed === this.detailed) return;
    this.detailed = detailed;
    this.onDemandChange?.({ detailed });
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

  async getRecordedSession(sessionId: string): Promise<MonitorRecordedSession> {
    try {
      await this.worker.flush();
    } catch (error) {
      console.warn("[Monitor] Worker flush failed before reading session:", error);
    }
    const session = getMonitorSession(sessionId);
    if (!session) return emptyMonitorRecordedSession();
    const range = {
      from: session.startedAt,
      to: session.endedAt ?? Date.now(),
    };
    const ticks = getSessionTicks(sessionId);
    const incidents = listIncidents(500, range).filter((incident) => {
      const payloadSessionId = incident.payload.sessionId;
      return payloadSessionId === sessionId || payloadSessionId == null;
    });
    const switches = listSwitchRecords(2_000, range);
    const tabEvents = listTabEvents(2_000, range);
    const clickTimings = listTabClickTimings(2_000, range);
    return {
      session,
      ticks,
      rendererTelemetry: getRendererTelemetry(sessionId),
      diffIngestions: getDiffIngestions(sessionId),
      acpUpdates: getAcpUpdates(sessionId),
      bridgeEvents: getBridgeEvents(sessionId),
      connectionEpisodes: getConnectionEpisodes(500, undefined, range),
      incidents,
      switches,
      tabEvents,
      clickTimings,
      switchTimeline: buildSwitchTimeline(tabEvents, switches, clickTimings),
      summary: summarizeSession(ticks, session, incidents.length),
    };
  }

  async startRecording(label?: string): Promise<MonitorSession> {
    if (this.recordingSessionId) {
      await this.stopRecording();
    }
    const session: MonitorSession = {
      id: randomUUID(),
      label: label?.trim() || `Session ${new Date().toLocaleString()}`,
      startedAt: Date.now(),
      endedAt: null,
    };
    try {
      await this.worker.startRecording(session);
    } catch (error) {
      console.error("[Monitor] Failed to start recording on worker:", error);
    }
    this.recordingSessionId = session.id;
    this.recordingStartedAt = session.startedAt;
    this.updateDemand();
    this.broadcastLive();
    return session;
  }

  async stopRecording(): Promise<MonitorSession | null> {
    if (!this.recordingSessionId) return null;
    const session = listMonitorSessions(200).find((entry) => entry.id === this.recordingSessionId);
    const endedAt = Date.now();
    try {
      await this.worker.stopRecording(this.recordingSessionId, endedAt);
    } catch (error) {
      console.error("[Monitor] Failed to stop recording on worker:", error);
    }
    const finishedSession: MonitorSession = {
      id: this.recordingSessionId,
      label: session?.label ?? "Recording",
      startedAt: session?.startedAt ?? this.recordingStartedAt ?? endedAt,
      endedAt,
    };
    this.recordingSessionId = null;
    this.recordingStartedAt = null;
    this.updateDemand();
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
    if (event.sessionCountAtTermination !== undefined) {
      episode.sessionCountAtTermination = event.sessionCountAtTermination;
    }
    if (event.invalidatedThreadIds) {
      episode.invalidatedThreadIds = event.invalidatedThreadIds;
    }
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
    const preDropTicks = this.rings.ticks.toArray(30);
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
    if (event.invalidatedThreadIds && event.invalidatedThreadIds.length >= 2) {
      const massIncident = insertIncident(
        "mass_session_invalidation",
        `Mass session invalidation (${event.invalidatedThreadIds.length} sessions purged by ${event.agentId})`,
        {
          agentId: event.agentId,
          connectionId: event.connectionId,
          invalidatedThreadIds: event.invalidatedThreadIds,
          cause: episode.terminalCause,
          sessionId: this.recordingSessionId,
        },
      );
      this.onBroadcast("monitor:incident", massIncident);
    }
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
      this.rendererEpisodes.delete(episodeId);
      const group = this.coalescer.get(existing.coalesceKey);
      // The group payload is current even if later episodes joined it.
      const current = group?.incidentId === existing.incidentId ? group.payload : null;
      if (!current) return;
      const maxBlockedMs = Math.max(
        Number(current.maxBlockedMs ?? 0),
        Number(report.maxBlockedMs ?? report.blockedMs),
      );
      const payload: Record<string, unknown> = existing.first
        ? { ...current, ...report, phase, endedAt: Date.now(), maxBlockedMs }
        : { ...current, maxBlockedMs, lastEndedAt: Date.now() };
      // Keep the group's occurrence bookkeeping over the report's fields.
      payload.occurrences = current.occurrences;
      payload.recentOccurrences = current.recentOccurrences;
      group!.payload = payload;
      const incident = updateIncident(
        existing.incidentId,
        payload,
        freezeSummary(payload, "episode"),
      );
      if (incident) this.onBroadcast("monitor:incident", incident);
      return;
    }

    if (existing) return;
    const now = Date.now();
    const coalesceKey = `renderer_freeze:${report.observerId ?? ""}`;
    const group = this.coalescer.find(coalesceKey, now);
    if (group) {
      const payload = mergeOccurrence(
        group,
        { at: now, value: report.blockedMs, threadId: report.activeThreadId ?? null },
        "blockedMs",
      );
      this.trackRendererEpisode(episodeId, {
        incidentId: group.incidentId,
        coalesceKey,
        first: false,
      });
      const incident = updateIncident(
        group.incidentId,
        payload,
        freezeSummary(payload, "episodes"),
      );
      if (incident) this.onBroadcast("monitor:incident", incident);
      return;
    }
    const payload: Record<string, unknown> = {
      ...report,
      phase: "start",
      episodeId,
      occurrences: 1,
      runningThreadIds: report.runningThreadIds ?? this.getRunningThreadIds(),
      preDropTicks: this.rings.ticks.toArray(5),
      rendererTelemetry: this.rings.rendererTelemetry.toArray(3),
      sessionId: this.recordingSessionId,
    };
    const incident = insertIncident(
      "renderer_freeze",
      `Renderer freeze episode started (${Math.round(report.blockedMs)}ms)`,
      payload,
    );
    this.coalescer.open(coalesceKey, incident.id, payload, now);
    this.trackRendererEpisode(episodeId, { incidentId: incident.id, coalesceKey, first: true });
    this.onBroadcast("monitor:incident", incident);
  }

  private trackRendererEpisode(
    episodeId: string,
    entry: { incidentId: number; coalesceKey: string; first: boolean },
  ): void {
    this.rendererEpisodes.set(episodeId, entry);
    while (this.rendererEpisodes.size > MAX_RENDERER_EPISODES) {
      const oldest = this.rendererEpisodes.keys().next().value;
      if (!oldest) break;
      this.rendererEpisodes.delete(oldest);
    }
  }

  /**
   * Inserts an incident, or folds it into the open incident with the same key
   * (see IncidentCoalescer). `valueField` is the payload number whose peak is kept.
   */
  private recordCoalescedIncident(
    kind: MonitorIncidentKind,
    key: string,
    summary: (payload: Record<string, unknown>) => string,
    payload: Record<string, unknown>,
    valueField: string,
  ): MonitorIncident | null {
    const now = Date.now();
    const coalesceKey = `${kind}:${key}`;
    const group = this.coalescer.find(coalesceKey, now);
    if (group) {
      const value = Number(payload[valueField] ?? 0);
      const threadId = typeof payload.threadId === "string" ? payload.threadId : null;
      const merged = mergeOccurrence(group, { at: now, value, threadId }, valueField);
      return updateIncident(group.incidentId, merged, summary(merged));
    }
    const initial = { ...payload, occurrences: 1 };
    const incident = insertIncident(kind, summary(initial), initial, now);
    this.coalescer.open(coalesceKey, incident.id, initial, now);
    return incident;
  }

  reportRendererTelemetry(telemetry: MonitorRendererTelemetry): void {
    this.rings.rendererTelemetry.push(telemetry);
    this.feed.schedule();
    if (this.recordingSessionId) {
      this.worker.writeRendererTelemetry(this.recordingSessionId, telemetry);
    }
  }

  reportDiffIngestion(ingestion: MonitorDiffIngestion): void {
    // High-frequency traces are useful only when they can be correlated with
    // a deliberate recording. Avoid continuously growing the local database.
    if (!this.recordingSessionId) return;
    this.worker.writeDiffIngestion(this.recordingSessionId, ingestion);
  }

  reportAcpUpdate(update: MonitorAcpUpdate): void {
    this.rings.acpUpdates.push(update);
    if (this.recordingSessionId) this.worker.writeAcpUpdate(this.recordingSessionId, update);
  }

  reportBridgeEvent(event: MonitorBridgeEvent): void {
    this.rings.bridgeEvents.push(event);
    if (this.recordingSessionId) this.worker.writeBridgeEvent(this.recordingSessionId, event);
  }

  reportTabMismatch(report: MonitorTabMismatchReport): void {
    const incident = this.recordCoalescedIncident(
      "tab_highlight_mismatch",
      "",
      (payload) =>
        withOccurrences(
          `Tab highlight mismatch (${Math.round(Number(payload.maxDurationMs ?? payload.durationMs))}ms)`,
          payload,
        ),
      { ...report, sessionId: this.recordingSessionId },
      "durationMs",
    );
    if (incident) this.onBroadcast("monitor:incident", incident);
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
        preDropTicks: this.rings.ticks.toArray(15),
        sessionId: this.recordingSessionId,
      });
      this.onBroadcast("monitor:incident", incident);
      this.broadcastLive();
      return;
    }
    if (input.durationMs >= SLOW_SWITCH_MS) {
      const incident = this.recordCoalescedIncident(
        "switch_slow",
        "",
        (payload) =>
          withOccurrences(
            `Slow thread switch (${Math.round(Number(payload.maxDurationMs ?? payload.durationMs))}ms)`,
            payload,
          ),
        {
          ...input,
          preDropTicks: this.rings.ticks.toArray(15),
          sessionId: this.recordingSessionId,
        },
        "durationMs",
      );
      if (incident) this.onBroadcast("monitor:incident", incident);
      this.broadcastLive();
    }
  }

  /**
   * Durable, unconditional record of a thread activation. Unlike
   * `noteSwitchCompleted` (incident-only, gated on slowness), every switch is
   * persisted so warm (cache_hit) switches are observable and can be lined up
   * against the tab-set mutations that preceded them.
   */
  reportSwitch(record: MonitorSwitchRecord): void {
    insertSwitchRecord(record);
    if (record.wasResidentInMemory && record.phase !== "cache_hit") {
      const incident = this.recordCoalescedIncident(
        "unexpected_cold_switch",
        record.threadId,
        (payload) =>
          withOccurrences(
            `Unexpected cold switch for thread ${record.threadId} (expected warm cache hit)`,
            payload,
          ),
        { ...record, sessionId: this.recordingSessionId },
        "durationMs",
      );
      if (incident) this.onBroadcast("monitor:incident", incident);
    }
    this.broadcastLive();
  }

  /** Durable record of an in-memory session cache mutation. */
  reportSessionCacheEvent(event: MonitorSessionCacheEvent): void {
    insertSessionCacheEvent(event);
    this.broadcastLive();
  }

  /** Durable record of an open-tab-set mutation (open / close / activate). */
  reportTabEvent(event: MonitorTabEvent): void {
    insertTabEvent(event);
    this.broadcastLive();
  }

  /** Durable renderer-side click-to-paint timing for a tab activation. */
  reportTabClickTiming(timing: MonitorTabClickTiming): void {
    insertTabClickTiming(timing);
    this.broadcastLive();
  }

  getSwitchRecords(limit = 500): MonitorSwitchRecord[] {
    return listSwitchRecords(limit);
  }

  getSessionCacheEvents(limit = 500): MonitorSessionCacheEvent[] {
    return listSessionCacheEvents(limit);
  }

  getTabEvents(limit = 500): MonitorTabEvent[] {
    return listTabEvents(limit);
  }

  getTabClickTimings(limit = 500): MonitorTabClickTiming[] {
    return listTabClickTimings(limit);
  }

  /**
   * Correlated view for diagnosing tab-switch latency. Lifts the three durable
   * streams (tab-set mutations, switch records, renderer click timings) into a
   * single time-ordered timeline, then annotates each switch with the
   * nearest-prior open-tab count so a regression can be tied to "4 -> 5 tabs".
   */
  getSwitchTimeline(limit = 500) {
    return buildSwitchTimeline(
      listTabEvents(limit),
      listSwitchRecords(limit),
      listTabClickTimings(limit),
    );
  }

  private async tick(): Promise<void> {
    if (this.sampling) return;
    this.sampling = true;
    try {
      const descriptors = this.mergeElectronMetrics(this.getInventory());
      const threadDetail = this.detailed || this.tickCount % BACKGROUND_DETAIL_EVERY_TICKS === 0;
      this.tickCount += 1;
      const tick: MonitorSampleTick = await this.worker.sample(
        descriptors,
        this.recordingSessionId,
        process.pid,
        threadDetail,
        sampleCurrentProcessMetrics(),
      );
      this.rings.ticks.push(tick);
      this.feed.schedule();
    } finally {
      this.sampling = false;
    }
  }

  private schedulePrune(delayMs: number): void {
    if (this.pruneTimer) clearTimeout(this.pruneTimer);
    this.pruneTimer = setTimeout(() => {
      this.pruneTimer = null;
      void this.worker
        .prune(DEFAULT_MONITOR_RETENTION)
        .then((report) => {
          if (report) this.lastPrune = report;
          if (this.timer) {
            this.schedulePrune(report && !report.complete ? PRUNE_CONTINUE_MS : PRUNE_INTERVAL_MS);
          }
        })
        .catch((error) => {
          console.warn("[Monitor] Retention pass failed:", error);
          if (this.timer) this.schedulePrune(PRUNE_INTERVAL_MS);
        });
    }, delayMs);
    this.pruneTimer.unref?.();
  }

  /** Coalesced: builds nothing unless a monitor window is subscribed. */
  private broadcastLive(): void {
    this.feed.schedule();
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

function withOccurrences(summary: string, payload: Record<string, unknown>): string {
  const occurrences = Number(payload.occurrences ?? 1);
  return occurrences > 1 ? `${summary} ×${occurrences}` : summary;
}

function freezeSummary(payload: Record<string, unknown>, noun: "episode" | "episodes"): string {
  const occurrences = Number(payload.occurrences ?? 1);
  const peak = Math.round(Number(payload.maxBlockedMs ?? payload.blockedMs ?? 0));
  return occurrences > 1
    ? `Renderer freeze episodes ×${occurrences} (max ${peak}ms)`
    : `Renderer freeze ${noun === "episode" ? "episode" : "episode started"} ${peak}ms`;
}
