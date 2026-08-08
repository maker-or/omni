import type { StatementSync } from "node:sqlite";
import os from "node:os";
import { getDb } from "../db.ts";
import type {
  MonitorIncident,
  MonitorIncidentKind,
  MonitorProcessRole,
  MonitorProcessSample,
  MonitorSampleTick,
  MonitorSession,
} from "../../contracts/monitor.ts";

let tablesReady = false;

export function ensureMonitorTables(): void {
  if (tablesReady) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS monitor_sessions (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS monitor_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      timestamp INTEGER NOT NULL,
      pid INTEGER NOT NULL,
      role TEXT NOT NULL,
      label TEXT NOT NULL,
      agent_id TEXT,
      thread_id TEXT,
      thread_ids_json TEXT NOT NULL DEFAULT '[]',
      streaming_thread_ids_json TEXT NOT NULL DEFAULT '[]',
      session_key TEXT,
      is_streaming INTEGER,
      cpu_percent REAL NOT NULL,
      cpu_percent_of_system REAL NOT NULL DEFAULT 0,
      memory_bytes INTEGER NOT NULL,
      thread_count INTEGER NOT NULL,
      busy_threads INTEGER NOT NULL,
      idle_threads INTEGER NOT NULL,
      runnable_threads INTEGER NOT NULL DEFAULT 0,
      blocked_threads INTEGER NOT NULL DEFAULT 0,
      sleeping_threads INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_samples_session_ts
      ON monitor_samples(session_id, timestamp);

    CREATE TABLE IF NOT EXISTS monitor_incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_incidents_ts
      ON monitor_incidents(timestamp DESC);
  `);
  addColumnIfMissing(db, "monitor_samples", "thread_ids_json", "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(
    db,
    "monitor_samples",
    "streaming_thread_ids_json",
    "TEXT NOT NULL DEFAULT '[]'",
  );
  addColumnIfMissing(db, "monitor_samples", "cpu_percent_of_system", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "monitor_samples", "runnable_threads", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "monitor_samples", "blocked_threads", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "monitor_samples", "sleeping_threads", "INTEGER NOT NULL DEFAULT 0");
  tablesReady = true;
}

function addColumnIfMissing(
  db: ReturnType<typeof getDb>,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((entry) => entry.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function insertMonitorSession(session: MonitorSession): void {
  ensureMonitorTables();
  getDb()
    .prepare(
      `INSERT INTO monitor_sessions (id, label, started_at, ended_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(session.id, session.label, session.startedAt, session.endedAt);
}

export function finishMonitorSession(sessionId: string, endedAt: number): void {
  ensureMonitorTables();
  getDb().prepare(`UPDATE monitor_sessions SET ended_at = ? WHERE id = ?`).run(endedAt, sessionId);
}

export function listMonitorSessions(limit = 50): MonitorSession[] {
  ensureMonitorTables();
  const rows = getDb()
    .prepare(
      `SELECT id, label, started_at AS startedAt, ended_at AS endedAt
       FROM monitor_sessions
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as MonitorSession[];
  return rows.map((row) => ({
    ...row,
    endedAt: row.endedAt ?? null,
  }));
}

export function insertSampleBatch(sessionId: string | null, tick: MonitorSampleTick): void {
  ensureMonitorTables();
  const stmt = getDb().prepare(
    `INSERT INTO monitor_samples (
      session_id, timestamp, pid, role, label, agent_id, thread_id, thread_ids_json,
      streaming_thread_ids_json, session_key, is_streaming, cpu_percent, cpu_percent_of_system,
      memory_bytes, thread_count, busy_threads, idle_threads, runnable_threads, blocked_threads,
      sleeping_threads
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  dbRunBatch(stmt, tick, sessionId);
}

function dbRunBatch(stmt: StatementSync, tick: MonitorSampleTick, sessionId: string | null): void {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const sample of tick.processes) {
      stmt.run(
        sessionId,
        tick.timestamp,
        sample.pid,
        sample.role,
        sample.label,
        sample.agentId ?? null,
        sample.threadId ?? null,
        JSON.stringify(sample.threadIds),
        JSON.stringify(sample.streamingThreadIds),
        sample.sessionId ?? null,
        sample.isStreaming ? 1 : 0,
        sample.cpuPercent,
        sample.cpuPercentOfSystem,
        sample.memoryBytes,
        sample.threadCount,
        sample.busyThreads,
        sample.idleThreads,
        sample.runnableThreads,
        sample.blockedThreads,
        sample.sleepingThreads,
      );
    }
    db.exec("COMMIT;");
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // ignore
    }
    throw error;
  }
}

export function insertIncident(
  kind: MonitorIncidentKind,
  summary: string,
  payload: Record<string, unknown>,
  timestamp = Date.now(),
): MonitorIncident {
  ensureMonitorTables();
  const payloadJson = JSON.stringify(payload);
  const result = getDb()
    .prepare(
      `INSERT INTO monitor_incidents (timestamp, kind, summary, payload_json)
       VALUES (?, ?, ?, ?)`,
    )
    .run(timestamp, kind, summary, payloadJson);
  return {
    id: Number(result.lastInsertRowid),
    timestamp,
    kind,
    summary,
    payload,
  };
}

export function listIncidents(limit = 100): MonitorIncident[] {
  ensureMonitorTables();
  const rows = getDb()
    .prepare(
      `SELECT id, timestamp, kind, summary, payload_json AS payloadJson
       FROM monitor_incidents
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: number;
    timestamp: number;
    kind: MonitorIncidentKind;
    summary: string;
    payloadJson: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    kind: row.kind,
    summary: row.summary,
    payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
  }));
}

export function getSessionTicks(sessionId: string, maxTicks = 12_000): MonitorSampleTick[] {
  ensureMonitorTables();
  interface SampleRow {
    timestamp: number;
    pid: number;
    role: string;
    label: string;
    agentId: string | null;
    threadId: string | null;
    threadIdsJson: string | null;
    streamingThreadIdsJson: string | null;
    sessionId: string | null;
    isStreaming: number | null;
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
  const rows = getDb()
    .prepare(
      `SELECT timestamp, pid, role, label, agent_id AS agentId, thread_id AS threadId,
              thread_ids_json AS threadIdsJson,
              streaming_thread_ids_json AS streamingThreadIdsJson,
              session_key AS sessionId, is_streaming AS isStreaming,
              cpu_percent AS cpuPercent, cpu_percent_of_system AS cpuPercentOfSystem,
              memory_bytes AS memoryBytes, thread_count AS threadCount,
              busy_threads AS busyThreads, idle_threads AS idleThreads,
              runnable_threads AS runnableThreads, blocked_threads AS blockedThreads,
              sleeping_threads AS sleepingThreads
       FROM monitor_samples
       WHERE session_id = ?
         AND timestamp IN (
           SELECT timestamp
           FROM monitor_samples
           WHERE session_id = ?
           GROUP BY timestamp
           ORDER BY timestamp ASC
           LIMIT ?
         )
       ORDER BY timestamp ASC, pid ASC
      `,
    )
    .all(sessionId, sessionId, maxTicks) as unknown as SampleRow[];

  const ticks = new Map<number, MonitorProcessSample[]>();
  for (const row of rows) {
    const threadIds = parseJsonArray(row.threadIdsJson);
    const streamingThreadIds = parseJsonArray(row.streamingThreadIdsJson);
    const sample: MonitorProcessSample = {
      pid: row.pid,
      role: row.role as MonitorProcessRole,
      label: row.label,
      agentId: row.agentId ?? undefined,
      threadId: row.threadId ?? undefined,
      // Older recordings predate the JSON columns. Reconstruct the single
      // known association instead of rendering those sessions as unowned.
      threadIds: threadIds.length > 0 ? threadIds : row.threadId ? [row.threadId] : [],
      streamingThreadIds:
        streamingThreadIds.length > 0
          ? streamingThreadIds
          : row.isStreaming === 1 && row.threadId
            ? [row.threadId]
            : [],
      sessionId: row.sessionId ?? undefined,
      isStreaming: row.isStreaming === 1,
      cpuPercent: row.cpuPercent,
      cpuPercentOfSystem:
        row.cpuPercentOfSystem > 0
          ? row.cpuPercentOfSystem
          : row.cpuPercent / Math.max(os.cpus().length, 1),
      memoryBytes: row.memoryBytes,
      threadCount: row.threadCount,
      busyThreads: row.busyThreads,
      idleThreads: row.idleThreads,
      runnableThreads: row.runnableThreads ?? row.busyThreads,
      blockedThreads: row.blockedThreads ?? 0,
      sleepingThreads: row.sleepingThreads ?? row.idleThreads,
    };
    const bucket = ticks.get(row.timestamp) ?? [];
    bucket.push(sample);
    ticks.set(row.timestamp, bucket);
  }

  return [...ticks.entries()].map(([timestamp, processes]) => ({ timestamp, processes }));
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

export function pruneOldSamples(retentionMs: number): void {
  ensureMonitorTables();
  const cutoff = Date.now() - retentionMs;
  getDb()
    .prepare(`DELETE FROM monitor_samples WHERE session_id IS NULL AND timestamp < ?`)
    .run(cutoff);
  getDb().prepare(`DELETE FROM monitor_incidents WHERE timestamp < ?`).run(cutoff);
}
