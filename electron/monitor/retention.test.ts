import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ensureMonitorTables,
  finishMonitorSession,
  initializeMonitorDb,
  insertIncident,
  insertMonitorSession,
  insertTabEvent,
  listIncidents,
} from "./db.ts";
import {
  IncidentCoalescer,
  MAX_RECENT_OCCURRENCES,
  mergeOccurrence,
} from "./incident-coalescer.ts";
import {
  DEFAULT_MONITOR_RETENTION,
  monitorStorageSummary,
  pruneMonitorData,
  type MonitorRetentionPolicy,
} from "./retention.ts";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
let db: DatabaseSync;

function policy(overrides: Partial<MonitorRetentionPolicy> = {}): MonitorRetentionPolicy {
  return { ...DEFAULT_MONITOR_RETENTION, now: NOW, ...overrides };
}

function count(table: string, where = "1 = 1"): number {
  return Number(
    (db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get() as { count: number })
      .count,
  );
}

function insertBridgeRows(sessionId: string, rows: number, timestamp: number): void {
  const statement = db.prepare(
    `INSERT INTO monitor_bridge_events (session_id, timestamp, event_type, bytes, serialization_ms)
     VALUES (?, ?, 'x', 1, 0)`,
  );
  db.exec("BEGIN");
  for (let i = 0; i < rows; i++) statement.run(sessionId, timestamp + i);
  db.exec("COMMIT");
}

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  initializeMonitorDb(db);
  ensureMonitorTables();
});

describe("incident retention", () => {
  it("caps each kind separately so a freeze storm cannot evict other evidence", () => {
    for (let i = 0; i < 1_000; i++)
      insertIncident("renderer_freeze", "freeze", { hidden: i % 2 === 0 }, NOW - i * 1000);
    for (let i = 0; i < 5; i++)
      insertIncident("connection_loss", "loss", { agentId: "a" }, NOW - 10 * DAY + DAY * 4 + i);
    const report = pruneMonitorData(db, policy());
    expect(report.complete).toBe(true);
    expect(count("monitor_incidents", "kind = 'renderer_freeze'")).toBe(400);
    expect(count("monitor_incidents", "kind = 'connection_loss'")).toBe(5);
    // The newest freezes survive regardless of payload flags.
    const kept = listIncidents(400).filter((incident) => incident.kind === "renderer_freeze");
    expect(Math.min(...kept.map((incident) => incident.timestamp))).toBe(NOW - 399 * 1000);
    expect(report.deletedRows.monitor_incidents).toBe(600);
  });

  it("drops incidents past the age limit and enforces the payload byte budget", () => {
    insertIncident("switch_slow", "old", { durationMs: 2000 }, NOW - 8 * DAY);
    const big = "x".repeat(10_000);
    for (let i = 0; i < 50; i++) insertIncident("switch_slow", "slow", { big }, NOW - i);
    pruneMonitorData(
      db,
      policy({
        incidents: { maxAgeMs: 7 * DAY, maxPerKind: 400, maxPayloadBytes: 100_000 },
      }),
    );
    const remaining = listIncidents(100);
    expect(remaining.every((incident) => incident.timestamp > NOW - 7 * DAY)).toBe(true);
    const bytes = monitorStorageSummary(db).incidentPayloadBytesByKind.switch_slow;
    expect(bytes).toBeLessThanOrEqual(100_000);
    expect(remaining.length).toBe(9);
    expect(remaining[0].timestamp).toBe(NOW);
  });
});

describe("event and recording retention", () => {
  it("bounds durable event tables by age and row count", () => {
    for (let i = 0; i < 300; i++)
      insertTabEvent({
        timestamp: NOW - (299 - i) * 1000,
        action: "activate",
        threadId: `t${i}`,
        openTabCount: 1,
        activeThreadId: null,
      });
    insertTabEvent({
      timestamp: NOW - 20 * DAY,
      action: "open",
      threadId: "ancient",
      openTabCount: 1,
      activeThreadId: null,
    });
    pruneMonitorData(db, policy({ events: { maxAgeMs: 14 * DAY, maxRowsPerTable: 100 } }));
    expect(count("monitor_tab_events")).toBe(100);
    expect(count("monitor_tab_events", "thread_id = 'ancient'")).toBe(0);
    expect(count("monitor_tab_events", "thread_id = 't299'")).toBe(1);
    expect(count("monitor_tab_events", "thread_id = 't0'")).toBe(0);
  });

  it("expires old and excess finished recordings but never the active one", () => {
    for (let i = 0; i < 4; i++) {
      const id = `s${i}`;
      insertMonitorSession({ id, label: id, startedAt: NOW - (i + 1) * DAY, endedAt: null });
      finishMonitorSession(id, NOW - (i + 1) * DAY + 1000);
      insertBridgeRows(id, 10, NOW - (i + 1) * DAY);
    }
    insertMonitorSession({
      id: "active",
      label: "active",
      startedAt: NOW - 90 * DAY,
      endedAt: null,
    });
    insertBridgeRows("active", 10, NOW - 90 * DAY);
    pruneMonitorData(
      db,
      policy({ recordings: { maxAgeMs: 30 * DAY, maxSessions: 2, maxRowsPerTable: 1_000 } }),
    );
    const sessions = (
      db.prepare("SELECT id FROM monitor_sessions ORDER BY id").all() as Array<{
        id: string;
      }>
    ).map((row) => row.id);
    // The two newest finished recordings, plus the unfinished one.
    expect(sessions).toEqual(["active", "s0", "s1"]);
    expect(count("monitor_bridge_events", "session_id IN ('s2','s3')")).toBe(0);
    expect(count("monitor_bridge_events", "session_id = 'active'")).toBe(10);
  });

  it("caps a long recording to its newest rows", () => {
    insertMonitorSession({ id: "long", label: "long", startedAt: NOW - DAY, endedAt: null });
    insertBridgeRows("long", 5_000, NOW - DAY);
    pruneMonitorData(
      db,
      policy({ recordings: { maxAgeMs: 30 * DAY, maxSessions: 20, maxRowsPerTable: 1_200 } }),
    );
    expect(count("monitor_bridge_events")).toBe(1_200);
    const oldest = db.prepare("SELECT MIN(timestamp) AS ts FROM monitor_bridge_events").get() as {
      ts: number;
    };
    expect(oldest.ts).toBe(NOW - DAY + 3_800);
  });

  it("stops at its batch budget and finishes on a later pass", () => {
    insertMonitorSession({ id: "long", label: "long", startedAt: NOW - DAY, endedAt: null });
    insertBridgeRows("long", 5_000, NOW - DAY);
    const tight = policy({
      recordings: { maxAgeMs: 30 * DAY, maxSessions: 20, maxRowsPerTable: 1_000 },
      batchRows: 500,
      maxBatches: 3,
    });
    const first = pruneMonitorData(db, tight);
    expect(first.complete).toBe(false);
    expect(first.deletedRows.monitor_bridge_events).toBe(1_500);
    let passes = 1;
    while (!pruneMonitorData(db, tight).complete) passes += 1;
    expect(count("monitor_bridge_events")).toBe(1_000);
    expect(passes).toBeGreaterThan(1);
  });

  it("reports logical deletions separately from reclaimable file space", () => {
    for (let i = 0; i < 500; i++)
      insertIncident("switch_slow", "slow", { pad: "y".repeat(2000) }, NOW - i);
    const report = pruneMonitorData(
      db,
      policy({ incidents: { maxAgeMs: 7 * DAY, maxPerKind: 10, maxPayloadBytes: 1e9 } }),
    );
    expect(report.deletedRows.monitor_incidents).toBe(490);
    expect(report.freelistBytes).not.toBeNull();
  });
});

describe("IncidentCoalescer", () => {
  it("folds repeats within the window and starts a new incident after a quiet gap", () => {
    const coalescer = new IncidentCoalescer({ windowMs: 60_000, maxSpanMs: 600_000 });
    const group = coalescer.open("renderer_freeze:a", 7, { blockedMs: 300, maxBlockedMs: 300 }, 0);
    for (let i = 1; i <= 30; i++) {
      const joined = coalescer.find("renderer_freeze:a", i * 10_000);
      expect(joined?.incidentId).toBe(7);
      mergeOccurrence(joined!, { at: i * 10_000, value: 200 + i }, "blockedMs");
    }
    expect(group.payload.occurrences).toBe(31);
    expect(group.payload.maxBlockedMs).toBe(300);
    expect(group.payload.recentOccurrences).toHaveLength(MAX_RECENT_OCCURRENCES);
    expect(coalescer.find("renderer_freeze:a", 300_000 + 61_000)).toBeNull();
  });

  it("starts a new incident once a storm exceeds the maximum span", () => {
    const coalescer = new IncidentCoalescer({ windowMs: 60_000, maxSpanMs: 120_000 });
    const group = coalescer.open("switch_slow:", 1, { durationMs: 2000 }, 0);
    for (let at = 30_000; at <= 120_000; at += 30_000) {
      mergeOccurrence(coalescer.find("switch_slow:", at)!, { at, value: 2500 }, "durationMs");
    }
    expect(group.payload.maxDurationMs).toBe(2500);
    expect(coalescer.find("switch_slow:", 150_000)).toBeNull();
  });
});
