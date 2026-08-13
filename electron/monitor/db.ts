import type { StatementSync } from "node:sqlite";
import os from "node:os";
import { getDb } from "../db.ts";
import type {
  MonitorIncident,
  MonitorIncidentKind,
  MonitorConnectionEpisode,
  MonitorDiffIngestion,
  MonitorProcessRole,
  MonitorProcessSample,
  MonitorRendererTelemetry,
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

    CREATE TABLE IF NOT EXISTS monitor_renderer_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      timestamp INTEGER NOT NULL,
      monotonic_ms REAL NOT NULL,
      observer_id TEXT NOT NULL,
      visibility_state TEXT NOT NULL,
      focused INTEGER NOT NULL,
      active_thread_id TEXT,
      running_thread_count INTEGER NOT NULL,
      js_heap_used_bytes INTEGER,
      js_heap_total_bytes INTEGER,
      js_heap_limit_bytes INTEGER,
      dom_node_count INTEGER,
      diff_thread_count INTEGER NOT NULL,
      diff_tool_call_count INTEGER NOT NULL,
      diff_file_count INTEGER NOT NULL,
      diff_ingestion_count INTEGER NOT NULL,
      diff_ingestion_ms REAL NOT NULL,
      diff_serialized_utf16_bytes INTEGER NOT NULL,
      diff_extracted_file_count INTEGER NOT NULL,
      diff_changed_file_count INTEGER NOT NULL,
      long_task_count INTEGER NOT NULL,
      long_task_ms REAL NOT NULL,
      gc_pause_count INTEGER NOT NULL,
      gc_pause_ms REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_renderer_session_ts
      ON monitor_renderer_samples(session_id, timestamp);

    CREATE TABLE IF NOT EXISTS monitor_diff_ingestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      active_thread_id TEXT,
      ingested_thread_id TEXT NOT NULL,
      active_thread_streaming INTEGER NOT NULL,
      is_active_thread INTEGER NOT NULL,
      visibility_state TEXT NOT NULL,
      focused INTEGER NOT NULL,
      thread_count INTEGER NOT NULL,
      tool_call_count INTEGER NOT NULL,
      file_count INTEGER NOT NULL,
      duration_ms REAL NOT NULL,
      serialized_utf16_bytes INTEGER NOT NULL,
      extracted_file_count INTEGER NOT NULL,
      changed_file_count INTEGER NOT NULL,
      next_frame_ms REAL NOT NULL,
      post_paint_ms REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_diff_ingestions_session_ts
      ON monitor_diff_ingestions(session_id, timestamp);

    CREATE TABLE IF NOT EXISTS monitor_incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_incidents_ts
      ON monitor_incidents(timestamp DESC);

    CREATE TABLE IF NOT EXISTS monitor_connection_episodes (
      connection_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      pid INTEGER,
      spawned_at INTEGER NOT NULL,
      initialized_at INTEGER,
      transport_closed_at INTEGER,
      process_exited_at INTEGER,
      ended_at INTEGER,
      exit_code INTEGER,
      signal TEXT,
      intentional INTEGER NOT NULL DEFAULT 0,
      terminal_cause TEXT,
      active_thread_id TEXT,
      running_thread_ids_json TEXT NOT NULL DEFAULT '[]',
      uptime_ms INTEGER,
      stderr_tail TEXT NOT NULL DEFAULT '',
      reconnect_attempt INTEGER NOT NULL DEFAULT 1,
      previous_connection_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_connection_episodes_ended
      ON monitor_connection_episodes(ended_at DESC);
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
  addColumnIfMissing(
    db,
    "monitor_renderer_samples",
    "long_task_count",
    "INTEGER NOT NULL DEFAULT 0",
  );
  addColumnIfMissing(db, "monitor_renderer_samples", "long_task_ms", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(
    db,
    "monitor_renderer_samples",
    "gc_pause_count",
    "INTEGER NOT NULL DEFAULT 0",
  );
  addColumnIfMissing(db, "monitor_renderer_samples", "gc_pause_ms", "REAL NOT NULL DEFAULT 0");
  tablesReady = true;
}

export function upsertConnectionEpisode(episode: MonitorConnectionEpisode): void {
  ensureMonitorTables();
  getDb()
    .prepare(
      `INSERT INTO monitor_connection_episodes (
        connection_id, agent_id, pid, spawned_at, initialized_at,
        transport_closed_at, process_exited_at, ended_at, exit_code, signal,
        intentional, terminal_cause, active_thread_id, running_thread_ids_json,
        uptime_ms, stderr_tail, reconnect_attempt, previous_connection_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connection_id) DO UPDATE SET
        agent_id = excluded.agent_id,
        pid = excluded.pid,
        spawned_at = excluded.spawned_at,
        initialized_at = excluded.initialized_at,
        transport_closed_at = excluded.transport_closed_at,
        process_exited_at = excluded.process_exited_at,
        ended_at = excluded.ended_at,
        exit_code = excluded.exit_code,
        signal = excluded.signal,
        intentional = excluded.intentional,
        terminal_cause = excluded.terminal_cause,
        active_thread_id = excluded.active_thread_id,
        running_thread_ids_json = excluded.running_thread_ids_json,
        uptime_ms = excluded.uptime_ms,
        stderr_tail = excluded.stderr_tail,
        reconnect_attempt = excluded.reconnect_attempt,
        previous_connection_id = excluded.previous_connection_id`,
    )
    .run(
      episode.connectionId,
      episode.agentId,
      episode.pid,
      episode.spawnedAt,
      episode.initializedAt,
      episode.transportClosedAt,
      episode.processExitedAt,
      episode.endedAt,
      episode.exitCode,
      episode.signal,
      episode.intentional ? 1 : 0,
      episode.terminalCause,
      episode.activeThreadId,
      JSON.stringify(episode.runningThreadIds),
      episode.uptimeMs,
      episode.stderrTail,
      episode.reconnectAttempt,
      episode.previousConnectionId,
    );
}

export function getConnectionEpisodes(
  limit = 500,
  connectionId?: string,
): MonitorConnectionEpisode[] {
  ensureMonitorTables();
  const rows = getDb()
    .prepare(
      `SELECT connection_id AS connectionId, agent_id AS agentId, pid,
              spawned_at AS spawnedAt, initialized_at AS initializedAt,
              transport_closed_at AS transportClosedAt,
              process_exited_at AS processExitedAt, ended_at AS endedAt,
              exit_code AS exitCode, signal, intentional,
              terminal_cause AS terminalCause, active_thread_id AS activeThreadId,
              running_thread_ids_json AS runningThreadIdsJson, uptime_ms AS uptimeMs,
              stderr_tail AS stderrTail, reconnect_attempt AS reconnectAttempt,
              previous_connection_id AS previousConnectionId
       FROM monitor_connection_episodes
       WHERE (? IS NULL OR connection_id = ?)
       ORDER BY spawned_at DESC
       LIMIT ?`,
    )
    .all(connectionId ?? null, connectionId ?? null, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    let runningThreadIds: string[] = [];
    try {
      const parsed = JSON.parse(String(row.runningThreadIdsJson ?? "[]"));
      if (Array.isArray(parsed))
        runningThreadIds = parsed.filter((id): id is string => typeof id === "string");
    } catch {
      // Preserve a readable empty value for rows written by an older build.
    }
    return {
      connectionId: String(row.connectionId),
      agentId: String(row.agentId),
      pid: row.pid == null ? null : Number(row.pid),
      spawnedAt: Number(row.spawnedAt),
      initializedAt: row.initializedAt == null ? null : Number(row.initializedAt),
      transportClosedAt: row.transportClosedAt == null ? null : Number(row.transportClosedAt),
      processExitedAt: row.processExitedAt == null ? null : Number(row.processExitedAt),
      endedAt: row.endedAt == null ? null : Number(row.endedAt),
      exitCode: row.exitCode == null ? null : Number(row.exitCode),
      signal: row.signal == null ? null : String(row.signal),
      intentional: Number(row.intentional) === 1,
      terminalCause:
        row.terminalCause == null
          ? null
          : (String(row.terminalCause) as MonitorConnectionEpisode["terminalCause"]),
      activeThreadId: row.activeThreadId == null ? null : String(row.activeThreadId),
      runningThreadIds,
      uptimeMs: row.uptimeMs == null ? null : Number(row.uptimeMs),
      stderrTail: String(row.stderrTail ?? ""),
      reconnectAttempt: Number(row.reconnectAttempt ?? 1),
      previousConnectionId:
        row.previousConnectionId == null ? null : String(row.previousConnectionId),
    };
  });
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

export function getMonitorSession(sessionId: string): MonitorSession | null {
  ensureMonitorTables();
  const row = getDb()
    .prepare(
      `SELECT id, label, started_at AS startedAt, ended_at AS endedAt
       FROM monitor_sessions
       WHERE id = ?`,
    )
    .get(sessionId) as MonitorSession | undefined;
  return row ? { ...row, endedAt: row.endedAt ?? null } : null;
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

export function insertRendererTelemetry(
  sessionId: string | null,
  telemetry: MonitorRendererTelemetry,
): void {
  ensureMonitorTables();
  getDb()
    .prepare(
      `INSERT INTO monitor_renderer_samples (
        session_id, timestamp, monotonic_ms, observer_id, visibility_state, focused,
        active_thread_id, running_thread_count, js_heap_used_bytes, js_heap_total_bytes,
        js_heap_limit_bytes, dom_node_count, diff_thread_count, diff_tool_call_count,
        diff_file_count, diff_ingestion_count, diff_ingestion_ms,
        diff_serialized_utf16_bytes, diff_extracted_file_count, diff_changed_file_count,
        long_task_count, long_task_ms, gc_pause_count, gc_pause_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      telemetry.timestamp,
      telemetry.monotonicMs,
      telemetry.observerId,
      telemetry.visibilityState,
      telemetry.focused ? 1 : 0,
      telemetry.activeThreadId,
      telemetry.runningThreadCount,
      telemetry.jsHeapUsedBytes,
      telemetry.jsHeapTotalBytes,
      telemetry.jsHeapLimitBytes,
      telemetry.domNodeCount,
      telemetry.diffThreadCount,
      telemetry.diffToolCallCount,
      telemetry.diffFileCount,
      telemetry.diffIngestionCount,
      telemetry.diffIngestionMs,
      telemetry.diffSerializedUtf16Bytes,
      telemetry.diffExtractedFileCount,
      telemetry.diffChangedFileCount,
      telemetry.longTaskCount,
      telemetry.longTaskMs,
      telemetry.gcPauseCount,
      telemetry.gcPauseMs,
    );
}

export function insertDiffIngestion(sessionId: string, ingestion: MonitorDiffIngestion): void {
  ensureMonitorTables();
  getDb()
    .prepare(
      `INSERT INTO monitor_diff_ingestions (
        session_id, timestamp, active_thread_id, ingested_thread_id,
        active_thread_streaming, is_active_thread, visibility_state, focused,
        thread_count, tool_call_count, file_count, duration_ms,
        serialized_utf16_bytes, extracted_file_count, changed_file_count,
        next_frame_ms, post_paint_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      ingestion.timestamp,
      ingestion.activeThreadId,
      ingestion.ingestedThreadId,
      ingestion.activeThreadStreaming ? 1 : 0,
      ingestion.isActiveThread ? 1 : 0,
      ingestion.visibilityState,
      ingestion.focused ? 1 : 0,
      ingestion.threadCount,
      ingestion.toolCallCount,
      ingestion.fileCount,
      ingestion.durationMs,
      ingestion.serializedUtf16Bytes,
      ingestion.extractedFileCount,
      ingestion.changedFileCount,
      ingestion.nextFrameMs,
      ingestion.postPaintMs,
    );
}

export function getDiffIngestions(sessionId: string, maxRows = 50_000): MonitorDiffIngestion[] {
  ensureMonitorTables();
  const rows = getDb()
    .prepare(
      `SELECT timestamp, active_thread_id AS activeThreadId,
              ingested_thread_id AS ingestedThreadId,
              active_thread_streaming AS activeThreadStreaming,
              is_active_thread AS isActiveThread, visibility_state AS visibilityState,
              focused, thread_count AS threadCount, tool_call_count AS toolCallCount,
              file_count AS fileCount, duration_ms AS durationMs,
              serialized_utf16_bytes AS serializedUtf16Bytes,
              extracted_file_count AS extractedFileCount,
              changed_file_count AS changedFileCount, next_frame_ms AS nextFrameMs,
              post_paint_ms AS postPaintMs
       FROM monitor_diff_ingestions
       WHERE session_id = ?
       ORDER BY timestamp ASC
       LIMIT ?`,
    )
    .all(sessionId, maxRows) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    timestamp: Number(row.timestamp),
    activeThreadId: (row.activeThreadId as string | null) ?? null,
    ingestedThreadId: String(row.ingestedThreadId),
    activeThreadStreaming: Number(row.activeThreadStreaming) === 1,
    isActiveThread: Number(row.isActiveThread) === 1,
    visibilityState: String(row.visibilityState),
    focused: Number(row.focused) === 1,
    threadCount: Number(row.threadCount),
    toolCallCount: Number(row.toolCallCount),
    fileCount: Number(row.fileCount),
    durationMs: Number(row.durationMs),
    serializedUtf16Bytes: Number(row.serializedUtf16Bytes),
    extractedFileCount: Number(row.extractedFileCount),
    changedFileCount: Number(row.changedFileCount),
    nextFrameMs: Number(row.nextFrameMs),
    postPaintMs: Number(row.postPaintMs),
  }));
}

export function getRendererTelemetry(
  sessionId: string,
  maxSamples = 12_000,
): MonitorRendererTelemetry[] {
  ensureMonitorTables();
  const rows = getDb()
    .prepare(
      `SELECT timestamp, monotonic_ms AS monotonicMs, observer_id AS observerId,
              visibility_state AS visibilityState, focused, active_thread_id AS activeThreadId,
              running_thread_count AS runningThreadCount, js_heap_used_bytes AS jsHeapUsedBytes,
              js_heap_total_bytes AS jsHeapTotalBytes, js_heap_limit_bytes AS jsHeapLimitBytes,
              dom_node_count AS domNodeCount, diff_thread_count AS diffThreadCount,
              diff_tool_call_count AS diffToolCallCount, diff_file_count AS diffFileCount,
              diff_ingestion_count AS diffIngestionCount, diff_ingestion_ms AS diffIngestionMs,
              diff_serialized_utf16_bytes AS diffSerializedUtf16Bytes,
              diff_extracted_file_count AS diffExtractedFileCount,
              diff_changed_file_count AS diffChangedFileCount,
              long_task_count AS longTaskCount, long_task_ms AS longTaskMs,
              gc_pause_count AS gcPauseCount, gc_pause_ms AS gcPauseMs
       FROM monitor_renderer_samples
       WHERE session_id = ?
       ORDER BY timestamp ASC
       LIMIT ?`,
    )
    .all(sessionId, maxSamples) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    timestamp: Number(row.timestamp),
    monotonicMs: Number(row.monotonicMs),
    observerId: String(row.observerId),
    visibilityState: String(row.visibilityState),
    focused: Number(row.focused) === 1,
    activeThreadId: (row.activeThreadId as string | null) ?? null,
    runningThreadCount: Number(row.runningThreadCount),
    jsHeapUsedBytes: nullableNumber(row.jsHeapUsedBytes),
    jsHeapTotalBytes: nullableNumber(row.jsHeapTotalBytes),
    jsHeapLimitBytes: nullableNumber(row.jsHeapLimitBytes),
    domNodeCount: nullableNumber(row.domNodeCount),
    diffThreadCount: Number(row.diffThreadCount),
    diffToolCallCount: Number(row.diffToolCallCount),
    diffFileCount: Number(row.diffFileCount),
    diffIngestionCount: Number(row.diffIngestionCount),
    diffIngestionMs: Number(row.diffIngestionMs),
    diffSerializedUtf16Bytes: Number(row.diffSerializedUtf16Bytes),
    diffExtractedFileCount: Number(row.diffExtractedFileCount),
    diffChangedFileCount: Number(row.diffChangedFileCount),
    longTaskCount: Number(row.longTaskCount),
    longTaskMs: Number(row.longTaskMs),
    gcPauseCount: Number(row.gcPauseCount),
    gcPauseMs: Number(row.gcPauseMs),
  }));
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
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

export function updateIncident(
  id: number,
  payload: Record<string, unknown>,
  summary?: string,
): MonitorIncident | null {
  ensureMonitorTables();
  const db = getDb();
  const payloadJson = JSON.stringify(payload);
  if (summary) {
    db.prepare(`UPDATE monitor_incidents SET summary = ?, payload_json = ? WHERE id = ?`).run(
      summary,
      payloadJson,
      id,
    );
  } else {
    db.prepare(`UPDATE monitor_incidents SET payload_json = ? WHERE id = ?`).run(payloadJson, id);
  }
  const row = db
    .prepare(
      `SELECT id, timestamp, kind, summary, payload_json AS payloadJson
       FROM monitor_incidents WHERE id = ?`,
    )
    .get(id) as
    | {
        id: number;
        timestamp: number;
        kind: MonitorIncidentKind;
        summary: string;
        payloadJson: string;
      }
    | undefined;
  return row
    ? {
        id: row.id,
        timestamp: row.timestamp,
        kind: row.kind,
        summary: row.summary,
        payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
      }
    : null;
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
  getDb()
    .prepare(`DELETE FROM monitor_renderer_samples WHERE session_id IS NULL AND timestamp < ?`)
    .run(cutoff);
  getDb().prepare(`DELETE FROM monitor_incidents WHERE timestamp < ?`).run(cutoff);
}
