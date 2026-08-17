import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import type { MonitorRecordedSession } from "../contracts/monitor.ts";
import {
  THREAD_BENCHMARK_CAPTURE_SCHEMA_VERSION,
  type ThreadBenchmarkCapture,
  type ThreadBenchmarkIdentity,
  type ThreadBenchmarkIndex,
  type ThreadBenchmarkIndexEntry,
  type ThreadBenchmarkInsights,
  type ThreadBenchmarkMode,
  type ThreadBenchmarkPrepared,
  type ThreadBenchmarkProcessPeak,
  type ThreadBenchmarkReport,
  type ThreadBenchmarkRun,
} from "../contracts/benchmark.ts";


export function parseFixtureTurns(fixturePath: string): number | null {
  const match = basename(fixturePath).match(/(\d+)turns/i);
  if (!match) return null;
  const turns = Number(match[1]);
  return Number.isInteger(turns) && turns > 0 ? turns : null;
}

export function buildRecordingLabel(
  mode: ThreadBenchmarkMode,
  fixtureTurns: number | null,
  fixtureBytes: number,
): string {
  const turns = fixtureTurns != null ? `${fixtureTurns}t` : "unknownt";
  const mib = `${Math.max(1, Math.round(fixtureBytes / 1024 / 1024))}mib`;
  return `thread-benchmark:${mode}:${turns}:${mib}`;
}

export function buildBenchmarkIdentity(input: {
  run: ThreadBenchmarkRun;
  prepared: ThreadBenchmarkPrepared;
  monitorSessionId: string;
  finishedAt: number;
}): ThreadBenchmarkIdentity {
  const fixtureTurns = parseFixtureTurns(input.prepared.fixturePath);
  return {
    runId: input.run.runId,
    monitorSessionId: input.monitorSessionId,
    label: buildRecordingLabel(input.run.mode, fixtureTurns, input.prepared.fixtureBytes),
    mode: input.run.mode,
    fixturePath: input.prepared.fixturePath,
    fixtureName: basename(input.prepared.fixturePath),
    fixtureBytes: input.prepared.fixtureBytes,
    fixtureTurns,
    threadId: input.run.threadId,
    controlThreadId: input.prepared.controlThreadId,
    startedAt: input.run.startedAt,
    finishedAt: input.finishedAt,
  };
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}

function processKey(pid: number, role: string): string {
  return `${pid}:${role}`;
}

export function buildBenchmarkInsights(input: {
  identity: ThreadBenchmarkIdentity;
  monitor: MonitorRecordedSession;
  rendererReadyMs: number | null;
}): ThreadBenchmarkInsights {
  const { monitor, identity, rendererReadyMs } = input;
  const latestSwitch = [...monitor.switches]
    .filter((record) => record.threadId === identity.threadId)
    .at(-1);
  const latestClick = [...monitor.clickTimings]
    .filter((timing) => timing.threadId === identity.threadId)
    .at(-1);
  const processPeaks = new Map<string, ThreadBenchmarkProcessPeak>();
  for (const tick of monitor.ticks) {
    for (const sample of tick.processes) {
      const key = processKey(sample.pid, sample.role);
      const current = processPeaks.get(key);
      if (!current) {
        processPeaks.set(key, {
          pid: sample.pid,
          role: sample.role,
          label: sample.label,
          agentId: sample.agentId ?? null,
          peakCpuPercent: sample.cpuPercent,
          peakCpuPercentOfSystem: sample.cpuPercentOfSystem,
          peakMemoryBytes: sample.memoryBytes,
          peakBusyThreads: sample.busyThreads,
          peakThreadCount: sample.threadCount,
        });
        continue;
      }
      current.peakCpuPercent = Math.max(current.peakCpuPercent, sample.cpuPercent);
      current.peakCpuPercentOfSystem = Math.max(
        current.peakCpuPercentOfSystem,
        sample.cpuPercentOfSystem,
      );
      current.peakMemoryBytes = Math.max(current.peakMemoryBytes, sample.memoryBytes);
      current.peakBusyThreads = Math.max(current.peakBusyThreads, sample.busyThreads);
      current.peakThreadCount = Math.max(current.peakThreadCount, sample.threadCount);
    }
  }

  const freezeIncidents = monitor.incidents.filter((incident) => incident.kind === "renderer_freeze");
  const domPeaks = new Map<
    string,
    { id: string; peakNodeCount: number; peakNodeDelta: number; mutationCount: number }
  >();
  for (const sample of monitor.rendererTelemetry) {
    for (const attribution of sample.domAttributions) {
      const current = domPeaks.get(attribution.id);
      if (!current) {
        domPeaks.set(attribution.id, {
          id: attribution.id,
          peakNodeCount: attribution.nodeCount,
          peakNodeDelta: attribution.nodeDelta,
          mutationCount: attribution.mutationCount,
        });
        continue;
      }
      current.peakNodeCount = Math.max(current.peakNodeCount, attribution.nodeCount);
      current.peakNodeDelta = Math.max(current.peakNodeDelta, attribution.nodeDelta);
      current.mutationCount += attribution.mutationCount;
    }
  }

  const eventTotals = {
    receivedCount: 0,
    receivedBytes: 0,
    applyMs: 0,
    maxApplyMs: 0,
    droppedCount: 0,
    coalescedCount: 0,
    bufferedCount: 0,
    maxEventToPaintMs: 0,
    ipcBurstCount: 0,
    longTaskDuringBurstMs: 0,
  };
  for (const sample of monitor.rendererTelemetry) {
    const events = sample.rendererEvents;
    eventTotals.receivedCount += events.receivedCount;
    eventTotals.receivedBytes += events.receivedBytes;
    eventTotals.applyMs += events.applyMs;
    eventTotals.maxApplyMs = Math.max(eventTotals.maxApplyMs, events.maxApplyMs);
    eventTotals.droppedCount += events.droppedCount;
    eventTotals.coalescedCount += events.coalescedCount;
    eventTotals.bufferedCount += events.bufferedCount;
    eventTotals.maxEventToPaintMs = Math.max(
      eventTotals.maxEventToPaintMs,
      events.maxEventToPaintMs,
    );
    eventTotals.ipcBurstCount += events.ipcBurstCount;
    eventTotals.longTaskDuringBurstMs += events.longTaskDuringBurstMs;
  }

  const byType = new Map<string, { type: string; count: number; bytes: number }>();
  for (const update of monitor.acpUpdates) {
    const current = byType.get(update.updateType) ?? {
      type: update.updateType,
      count: 0,
      bytes: 0,
    };
    current.count += 1;
    current.bytes += update.updateBytes;
    byType.set(update.updateType, current);
  }

  const timeline = monitor.switchTimeline.summary;

  return {
    durationMs: Math.max(0, identity.finishedAt - identity.startedAt),
    rendererReadyMs,
    switch: {
      durationMs: latestSwitch?.durationMs ?? null,
      phase: latestSwitch?.phase ?? null,
      success: latestSwitch?.success ?? null,
      clickToHighlightPaintMs: latestClick?.clickToHighlightPaintMs ?? null,
      clickToSwitchResolvedMs: latestClick?.clickToSwitchResolvedMs ?? null,
      cacheHits: timeline.cacheHits,
      sessionLoads: timeline.sessionLoads,
      sessionResumes: timeline.sessionResumes,
      sessionNews: timeline.sessionNews,
      failures: timeline.failures,
      slowSwitches: timeline.slowSwitches,
    },
    processes: [...processPeaks.values()].sort((left, right) =>
      left.label.localeCompare(right.label),
    ),
    renderer: {
      sampleCount: monitor.rendererTelemetry.length,
      peakJsHeapUsedBytes: monitor.rendererTelemetry.reduce<number | null>(
        (peak, sample) =>
          sample.jsHeapUsedBytes == null
            ? peak
            : peak == null
              ? sample.jsHeapUsedBytes
              : Math.max(peak, sample.jsHeapUsedBytes),
        null,
      ),
      maxLongTaskMs: monitor.rendererTelemetry.reduce(
        (peak, sample) => Math.max(peak, sample.longTaskMs),
        0,
      ),
      totalLongTaskMs: monitor.rendererTelemetry.reduce(
        (total, sample) => total + sample.longTaskMs,
        0,
      ),
      maxGcPauseMs: monitor.rendererTelemetry.reduce(
        (peak, sample) => Math.max(peak, sample.gcPauseMs),
        0,
      ),
      peakDomNodeCount: monitor.rendererTelemetry.reduce<number | null>(
        (peak, sample) =>
          sample.domNodeCount == null
            ? peak
            : peak == null
              ? sample.domNodeCount
              : Math.max(peak, sample.domNodeCount),
        null,
      ),
      freezeIncidentCount: freezeIncidents.length,
      freezeEpisodes: freezeIncidents.map((incident) => ({
        timestamp: incident.timestamp,
        blockedMs: Number(incident.payload.maxBlockedMs ?? incident.payload.blockedMs ?? 0),
        sources: Array.isArray(incident.payload.sources)
          ? incident.payload.sources.filter((entry): entry is string => typeof entry === "string")
          : typeof incident.payload.source === "string"
            ? [incident.payload.source]
            : [],
        visibilityState:
          typeof incident.payload.visibilityState === "string"
            ? incident.payload.visibilityState
            : null,
        activeThreadId:
          typeof incident.payload.activeThreadId === "string"
            ? incident.payload.activeThreadId
            : null,
      })),
      domPeaks: [...domPeaks.values()].sort((left, right) => right.peakNodeCount - left.peakNodeCount),
      eventTotals,
    },
    acp: {
      updateCount: monitor.acpUpdates.length,
      totalBytes: monitor.acpUpdates.reduce((total, update) => total + update.updateBytes, 0),
      maxUpdateBytes: monitor.acpUpdates.reduce(
        (peak, update) => Math.max(peak, update.updateBytes),
        0,
      ),
      maxHandlerDurationMs: monitor.acpUpdates.reduce(
        (peak, update) => Math.max(peak, update.handlerDurationMs),
        0,
      ),
      p95HandlerDurationMs: percentile(
        monitor.acpUpdates.map((update) => update.handlerDurationMs),
        0.95,
      ),
      byType: [...byType.values()].sort((left, right) => right.bytes - left.bytes),
      activeCount: monitor.acpUpdates.filter((update) => update.threadRole === "active").length,
      backgroundCount: monitor.acpUpdates.filter((update) => update.threadRole === "background")
        .length,
    },
    bridge: {
      eventCount: monitor.bridgeEvents.length,
      totalBytes: monitor.bridgeEvents.reduce((total, event) => total + event.bytes, 0),
      dropped: monitor.bridgeEvents.filter((event) => event.deliveryMode === "dropped").length,
      coalesced: monitor.bridgeEvents.filter((event) => event.deliveryMode === "coalesced").length,
      buffered: monitor.bridgeEvents.filter((event) => event.deliveryMode === "buffered").length,
      direct: monitor.bridgeEvents.filter((event) => event.deliveryMode === "direct").length,
      maxSerializationMs: monitor.bridgeEvents.reduce(
        (peak, event) => Math.max(peak, event.serializationMs),
        0,
      ),
      maxDeliveryMs: monitor.bridgeEvents.reduce(
        (peak, event) => Math.max(peak, event.deliveryMs),
        0,
      ),
    },
    diffs: {
      ingestionCount: monitor.diffIngestions.length,
      totalDurationMs: monitor.diffIngestions.reduce(
        (total, ingestion) => total + ingestion.durationMs,
        0,
      ),
      maxDurationMs: monitor.diffIngestions.reduce(
        (peak, ingestion) => Math.max(peak, ingestion.durationMs),
        0,
      ),
      totalSerializedUtf16Bytes: monitor.diffIngestions.reduce(
        (total, ingestion) => total + ingestion.serializedUtf16Bytes,
        0,
      ),
      maxPostPaintMs: monitor.diffIngestions.reduce(
        (peak, ingestion) => Math.max(peak, ingestion.postPaintMs),
        0,
      ),
    },
    incidents: monitor.incidents.map((incident) => ({
      id: incident.id,
      timestamp: incident.timestamp,
      kind: incident.kind,
      summary: incident.summary,
    })),
    connectionEpisodes: monitor.connectionEpisodes.map((episode) => ({
      connectionId: episode.connectionId,
      agentId: episode.agentId,
      terminalCause: episode.terminalCause,
      intentional: episode.intentional,
      uptimeMs: episode.uptimeMs,
    })),
  };
}

export function buildBenchmarkReport(input: {
  identity: ThreadBenchmarkIdentity;
  insights: ThreadBenchmarkInsights;
  retainedEntries: number;
  retainedToolCalls: number;
  totalRows: number | null;
  visibleRows: number | null;
  artifactDir: string | null;
}): ThreadBenchmarkReport {
  const { identity, insights } = input;
  return {
    runId: identity.runId,
    mode: identity.mode,
    threadId: identity.threadId,
    startedAt: identity.startedAt,
    finishedAt: identity.finishedAt,
    fixtureBytes: identity.fixtureBytes,
    rendererReadyMs: insights.rendererReadyMs,
    totalRows: input.totalRows,
    visibleRows: input.visibleRows,
    retainedEntries: input.retainedEntries,
    retainedToolCalls: input.retainedToolCalls,
    switchDurationMs: insights.switch.durationMs,
    switchPhase: insights.switch.phase,
    clickToPaintMs: insights.switch.clickToHighlightPaintMs,
    receivedUpdateCount: insights.acp.updateCount,
    receivedUpdateBytes: insights.acp.totalBytes,
    peakRendererHeapBytes: insights.renderer.peakJsHeapUsedBytes,
    maxLongTaskMs: insights.renderer.maxLongTaskMs,
    freezeIncidentCount: insights.renderer.freezeIncidentCount,
    monitorSessionId: identity.monitorSessionId,
    identity,
    insights,
    artifactDir: input.artifactDir,
  };
}

export function captureDirForRun(outputDir: string, runId: string): string {
  return join(outputDir, "runs", runId);
}

function indexEntryFromCapture(outputDir: string, capture: ThreadBenchmarkCapture): ThreadBenchmarkIndexEntry {
  return {
    runId: capture.identity.runId,
    monitorSessionId: capture.identity.monitorSessionId,
    label: capture.identity.label,
    mode: capture.identity.mode,
    fixtureName: capture.identity.fixtureName,
    fixtureTurns: capture.identity.fixtureTurns,
    fixtureBytes: capture.identity.fixtureBytes,
    startedAt: capture.identity.startedAt,
    finishedAt: capture.identity.finishedAt,
    rendererReadyMs: capture.report.rendererReadyMs,
    switchPhase: capture.report.switchPhase,
    freezeIncidentCount: capture.report.freezeIncidentCount,
    path: relative(outputDir, captureDirForRun(outputDir, capture.identity.runId)) || ".",
  };
}

export async function writeBenchmarkCapture(
  outputDir: string,
  capture: ThreadBenchmarkCapture,
): Promise<string> {
  const runDir = captureDirForRun(outputDir, capture.identity.runId);
  const report = { ...capture.report, artifactDir: runDir };
  await mkdir(runDir, { recursive: true });
  await Promise.all([
    writeFile(join(runDir, "identity.json"), `${JSON.stringify(capture.identity, null, 2)}\n`, "utf8"),
    writeFile(join(runDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(
      join(runDir, "insights.json"),
      `${JSON.stringify(capture.report.insights, null, 2)}\n`,
      "utf8",
    ),
    writeFile(join(runDir, "monitor.json"), `${JSON.stringify(capture.monitor, null, 2)}\n`, "utf8"),
  ]);

  const indexPath = join(outputDir, "index.json");
  let index: ThreadBenchmarkIndex = {
    schemaVersion: THREAD_BENCHMARK_CAPTURE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    outputDir,
    runs: [],
  };
  try {
    const raw = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as ThreadBenchmarkIndex;
    if (Array.isArray(parsed.runs)) index = parsed;
  } catch {
    // First capture in this output directory.
  }
  const entry = indexEntryFromCapture(outputDir, capture);
  index.schemaVersion = THREAD_BENCHMARK_CAPTURE_SCHEMA_VERSION;
  index.updatedAt = new Date().toISOString();
  index.outputDir = outputDir;
  index.runs = [...index.runs.filter((existing) => existing.runId !== entry.runId), entry].sort(
    (left, right) => left.startedAt - right.startedAt,
  );
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return runDir;
}
