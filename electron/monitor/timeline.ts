import type {
  MonitorRecordedSession,
  MonitorSessionSummary,
  MonitorSwitchRecord,
  MonitorSwitchTimeline,
  MonitorTabClickTiming,
  MonitorTabEvent,
} from "../../contracts/monitor.ts";

export const SLOW_SWITCH_MS = 3000;

export function emptySwitchTimeline(): MonitorSwitchTimeline {
  return {
    rows: [],
    switches: [],
    tabEvents: [],
    clickTimings: [],
    summary: {
      totalSwitches: 0,
      cacheHits: 0,
      sessionLoads: 0,
      sessionResumes: 0,
      sessionNews: 0,
      failures: 0,
      slowSwitches: 0,
      switchesAfterTabChange: 0,
    },
  };
}

export function emptySessionSummary(): MonitorSessionSummary {
  return {
    processCount: 0,
    totalCpuPercent: 0,
    totalCpuPercentOfSystem: 0,
    totalMemoryBytes: 0,
    osThreadCount: 0,
    busyThreads: 0,
    idleThreads: 0,
    streamingThreadCount: 0,
    durationMs: 0,
    sampleCount: 0,
    incidentCount: 0,
    peakCpuPercent: 0,
    peakCpuPercentOfSystem: 0,
    peakMemoryBytes: 0,
    peakBusyThreads: 0,
  };
}

export function emptyMonitorRecordedSession(): MonitorRecordedSession {
  return {
    session: null,
    ticks: [],
    rendererTelemetry: [],
    diffIngestions: [],
    acpUpdates: [],
    bridgeEvents: [],
    connectionEpisodes: [],
    incidents: [],
    switches: [],
    tabEvents: [],
    clickTimings: [],
    switchTimeline: emptySwitchTimeline(),
    summary: emptySessionSummary(),
  };
}

export function buildSwitchTimeline(
  tabEvents: MonitorTabEvent[],
  switches: MonitorSwitchRecord[],
  clickTimings: MonitorTabClickTiming[],
  slowSwitchMs = SLOW_SWITCH_MS,
): MonitorSwitchTimeline {
  const orderedTabEvents = [...tabEvents].sort((a, b) => a.timestamp - b.timestamp);
  const orderedSwitches = [...switches].sort((a, b) => a.timestamp - b.timestamp);
  const orderedClicks = [...clickTimings].sort((a, b) => a.timestamp - b.timestamp);

  const rows = [
    ...orderedTabEvents.map((event) => ({
      kind: "tab_event" as const,
      timestamp: event.timestamp,
      event,
    })),
    ...orderedSwitches.map((record) => ({
      kind: "switch" as const,
      timestamp: record.timestamp,
      record,
    })),
    ...orderedClicks.map((timing) => ({
      kind: "click" as const,
      timestamp: timing.timestamp,
      timing,
    })),
  ].sort((a, b) => a.timestamp - b.timestamp);

  let openTabCount = 0;
  const annotated = [];
  for (const row of rows) {
    if (row.kind === "tab_event") openTabCount = row.event.openTabCount;
    annotated.push({ ...row, openTabCount });
  }

  return {
    rows: annotated,
    switches: orderedSwitches,
    tabEvents: orderedTabEvents,
    clickTimings: orderedClicks,
    summary: {
      totalSwitches: orderedSwitches.length,
      cacheHits: orderedSwitches.filter((entry) => entry.phase === "cache_hit").length,
      sessionLoads: orderedSwitches.filter((entry) => entry.phase === "session_load").length,
      sessionResumes: orderedSwitches.filter((entry) => entry.phase === "session_resume").length,
      sessionNews: orderedSwitches.filter((entry) => entry.phase === "session_new").length,
      failures: orderedSwitches.filter((entry) => !entry.success).length,
      slowSwitches: orderedSwitches.filter((entry) => entry.durationMs >= slowSwitchMs).length,
      switchesAfterTabChange: orderedSwitches.filter((entry) =>
        orderedTabEvents.some(
          (event) =>
            Math.abs(event.timestamp - entry.timestamp) < 2000 &&
            event.timestamp <= entry.timestamp,
        ),
      ).length,
    },
  };
}
