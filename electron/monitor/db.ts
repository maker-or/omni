import type { DatabaseSync, StatementSync } from "node:sqlite";
import os from "node:os";
import type {
  MonitorIncident,
  MonitorIncidentKind,
  MonitorConnectionEpisode,
  MonitorAcpUpdate,
  MonitorBridgeEvent,
  MonitorDomAttribution,
  MonitorDiffIngestion,
  MonitorProcessRole,
  MonitorProcessSample,
  MonitorRendererTelemetry,
  MonitorSampleTick,
  MonitorSession,
  MonitorSwitchRecord,
  MonitorSwitchPhase,
  MonitorTabClickTiming,
  MonitorTabEvent,
} from "../../contracts/monitor.ts";

let tablesReady = false;
let monitorDb: DatabaseSync | null = null;

/**
 * The monitor can be hosted by either the Electron main process or a worker.
 * Keep the monitor schema and queries independent from Electron's app-bound
 * database accessor so the worker can open its own SQLite connection.
 */
export function initializeMonitorDb(db: DatabaseSync): void {
  if (monitorDb === db) return;
  monitorDb = db;
  tablesReady = false;
}

function getDb(): DatabaseSync {
  if (!monitorDb) throw new Error("Monitor database has not been initialized.");
  return monitorDb;
}

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
      sleeping_threads INTEGER NOT NULL DEFAULT 0,
      heap_used_bytes INTEGER,
      heap_total_bytes INTEGER,
      external_bytes INTEGER,
      array_buffers_bytes INTEGER
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
      dom_attribution_json TEXT NOT NULL DEFAULT '[]',
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
      gc_pause_ms REAL NOT NULL,
      renderer_event_stats_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_renderer_session_ts
      ON monitor_renderer_samples(session_id, timestamp);

    CREATE TABLE IF NOT EXISTS monitor_acp_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      agent_id TEXT,
      connection_id TEXT,
      session_key TEXT NOT NULL,
      thread_id TEXT,
      thread_role TEXT NOT NULL DEFAULT 'unknown',
      turn_id TEXT,
      update_type TEXT NOT NULL,
      update_bytes INTEGER NOT NULL,
      handler_duration_ms REAL NOT NULL,
      is_streaming INTEGER NOT NULL,
      entry_count INTEGER NOT NULL,
      tool_call_count INTEGER NOT NULL,
      text_bytes INTEGER NOT NULL,
      thought_bytes INTEGER NOT NULL,
      tool_payload_bytes INTEGER NOT NULL,
      largest_tool_payload_bytes INTEGER NOT NULL,
      session_snapshot_bytes INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_acp_session_ts
      ON monitor_acp_updates(session_id, timestamp);

    CREATE TABLE IF NOT EXISTS monitor_bridge_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      serialization_ms REAL NOT NULL,
      delivery_ms REAL NOT NULL DEFAULT 0,
      thread_id TEXT,
      thread_role TEXT NOT NULL DEFAULT 'unknown',
      delivery_mode TEXT NOT NULL DEFAULT 'direct'
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_bridge_session_ts
      ON monitor_bridge_events(session_id, timestamp);

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

    CREATE TABLE IF NOT EXISTS monitor_switches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      thread_id TEXT NOT NULL,
      agent_id TEXT,
      project_id TEXT,
      source TEXT NOT NULL,
      phase TEXT NOT NULL,
      duration_ms REAL NOT NULL,
      success INTEGER NOT NULL,
      error TEXT,
      open_tab_count INTEGER NOT NULL,
      previous_thread_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_switches_ts
      ON monitor_switches(timestamp);
    CREATE INDEX IF NOT EXISTS idx_monitor_switches_thread
      ON monitor_switches(thread_id, timestamp);

    CREATE TABLE IF NOT EXISTS monitor_tab_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      action TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      open_tab_count INTEGER NOT NULL,
      active_thread_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_tab_events_ts
      ON monitor_tab_events(timestamp);

    CREATE TABLE IF NOT EXISTS monitor_tab_click_timings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      thread_id TEXT NOT NULL,
      click_to_highlight_paint_ms REAL NOT NULL,
      click_to_switch_resolved_ms REAL NOT NULL,
      switch_duration_ms REAL,
      phase TEXT,
      success INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_click_timings_ts
      ON monitor_tab_click_timings(timestamp);
  `);
  addColumnIfMissing(db, "monitor_samples", "thread_ids_json", "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(
    db,
    "monitor_samples",
    "streaming_thread_ids_json",
    "TEXT NOT NULL DEFAULT '[]'",
  );
  addColumnIfMissing(
    db,
    "monitor_renderer_samples",
    "renderer_event_stats_json",
    "TEXT NOT NULL DEFAULT '{}'",
  );
  addColumnIfMissing(db, "monitor_acp_updates", "thread_role", "TEXT NOT NULL DEFAULT 'unknown'");
  addColumnIfMissing(db, "monitor_bridge_events", "delivery_ms", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "monitor_bridge_events", "thread_role", "TEXT NOT NULL DEFAULT 'unknown'");
  addColumnIfMissing(
    db,
    "monitor_bridge_events",
    "delivery_mode",
    "TEXT NOT NULL DEFAULT 'direct'",
  );
  addColumnIfMissing(db, "monitor_samples", "cpu_percent_of_system", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "monitor_samples", "runnable_threads", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "monitor_samples", "blocked_threads", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "monitor_samples", "sleeping_threads", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "monitor_samples", "heap_used_bytes", "INTEGER");
  addColumnIfMissing(db, "monitor_samples", "heap_total_bytes", "INTEGER");
  addColumnIfMissing(db, "monitor_samples", "external_bytes", "INTEGER");
  addColumnIfMissing(db, "monitor_samples", "array_buffers_bytes", "INTEGER");
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
  addColumnIfMissing(
    db,
    "monitor_renderer_samples",
    "dom_attribution_json",
    "TEXT NOT NULL DEFAULT '[]'",
  );
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
      sleeping_threads, heap_used_bytes, heap_total_bytes, external_bytes, array_buffers_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        js_heap_limit_bytes, dom_node_count, dom_attribution_json, diff_thread_count,
        diff_tool_call_count,
        diff_file_count, diff_ingestion_count, diff_ingestion_ms,
        diff_serialized_utf16_bytes, diff_extracted_file_count, diff_changed_file_count,
        long_task_count, long_task_ms, gc_pause_count, gc_pause_ms, renderer_event_stats_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      JSON.stringify(telemetry.domAttributions),
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
      JSON.stringify(telemetry.rendererEvents),
    );
}

export function insertAcpUpdate(sessionId: string, update: MonitorAcpUpdate): void {
  ensureMonitorTables();
  getDb()
    .prepare(
      `INSERT INTO monitor_acp_updates (
        session_id, timestamp, agent_id, connection_id, session_key, thread_id, thread_role, turn_id,
        update_type, update_bytes, handler_duration_ms, is_streaming, entry_count,
        tool_call_count, text_bytes, thought_bytes, tool_payload_bytes,
        largest_tool_payload_bytes, session_snapshot_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      update.timestamp,
      update.agentId,
      update.connectionId,
      update.sessionId,
      update.threadId,
      update.threadRole,
      update.turnId,
      update.updateType,
      update.updateBytes,
      update.handlerDurationMs,
      update.isStreaming ? 1 : 0,
      update.entryCount,
      update.toolCallCount,
      update.textBytes,
      update.thoughtBytes,
      update.toolPayloadBytes,
      update.largestToolPayloadBytes,
      update.sessionSnapshotBytes,
    );
}

export function insertBridgeEvent(sessionId: string, event: MonitorBridgeEvent): void {
  ensureMonitorTables();
  getDb()
    .prepare(
      `INSERT INTO monitor_bridge_events (
        session_id, timestamp, event_type, bytes, serialization_ms, delivery_ms,
        thread_id, thread_role, delivery_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      event.timestamp,
      event.eventType,
      event.bytes,
      event.serializationMs,
      event.deliveryMs,
      event.threadId,
      event.threadRole,
      event.deliveryMode,
    );
}

export function getAcpUpdates(sessionId: string, maxRows = 50_000): MonitorAcpUpdate[] {
  ensureMonitorTables();
  const rows = getDb()
    .prepare(
      `SELECT timestamp, agent_id AS agentId, connection_id AS connectionId,
              session_key AS sessionId, thread_id AS threadId, thread_role AS threadRole,
              turn_id AS turnId,
              update_type AS updateType, update_bytes AS updateBytes,
              handler_duration_ms AS handlerDurationMs, is_streaming AS isStreaming,
              entry_count AS entryCount, tool_call_count AS toolCallCount,
              text_bytes AS textBytes, thought_bytes AS thoughtBytes,
              tool_payload_bytes AS toolPayloadBytes,
              largest_tool_payload_bytes AS largestToolPayloadBytes,
              session_snapshot_bytes AS sessionSnapshotBytes
       FROM monitor_acp_updates WHERE session_id = ?
       ORDER BY timestamp ASC LIMIT ?`,
    )
    .all(sessionId, maxRows) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    timestamp: Number(row.timestamp),
    agentId: (row.agentId as string | null) ?? null,
    connectionId: (row.connectionId as string | null) ?? null,
    sessionId: String(row.sessionId),
    threadId: (row.threadId as string | null) ?? null,
    threadRole: (row.threadRole as MonitorAcpUpdate["threadRole"]) ?? "unknown",
    turnId: (row.turnId as string | null) ?? null,
    updateType: String(row.updateType),
    updateBytes: Number(row.updateBytes),
    handlerDurationMs: Number(row.handlerDurationMs),
    isStreaming: Number(row.isStreaming) === 1,
    entryCount: Number(row.entryCount),
    toolCallCount: Number(row.toolCallCount),
    textBytes: Number(row.textBytes),
    thoughtBytes: Number(row.thoughtBytes),
    toolPayloadBytes: Number(row.toolPayloadBytes),
    largestToolPayloadBytes: Number(row.largestToolPayloadBytes),
    sessionSnapshotBytes: Number(row.sessionSnapshotBytes),
  }));
}

export function getBridgeEvents(sessionId: string, maxRows = 50_000): MonitorBridgeEvent[] {
  ensureMonitorTables();
  const rows = getDb()
    .prepare(
      `SELECT timestamp, event_type AS eventType, bytes, serialization_ms AS serializationMs,
              delivery_ms AS deliveryMs, thread_id AS threadId, thread_role AS threadRole,
              delivery_mode AS deliveryMode
       FROM monitor_bridge_events WHERE session_id = ?
       ORDER BY timestamp ASC LIMIT ?`,
    )
    .all(sessionId, maxRows) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    timestamp: Number(row.timestamp),
    eventType: String(row.eventType),
    bytes: Number(row.bytes),
    serializationMs: Number(row.serializationMs),
    deliveryMs: Number(row.deliveryMs),
    threadId: (row.threadId as string | null) ?? null,
    threadRole: (row.threadRole as MonitorBridgeEvent["threadRole"]) ?? "unknown",
    deliveryMode: (row.deliveryMode as MonitorBridgeEvent["deliveryMode"]) ?? "direct",
  }));
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
              dom_node_count AS domNodeCount, dom_attribution_json AS domAttributionJson,
              diff_thread_count AS diffThreadCount,
              diff_tool_call_count AS diffToolCallCount, diff_file_count AS diffFileCount,
              diff_ingestion_count AS diffIngestionCount, diff_ingestion_ms AS diffIngestionMs,
              diff_serialized_utf16_bytes AS diffSerializedUtf16Bytes,
              diff_extracted_file_count AS diffExtractedFileCount,
              diff_changed_file_count AS diffChangedFileCount,
              long_task_count AS longTaskCount, long_task_ms AS longTaskMs,
              gc_pause_count AS gcPauseCount, gc_pause_ms AS gcPauseMs,
              renderer_event_stats_json AS rendererEventStatsJson
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
    domAttributions: parseDomAttributions(row.domAttributionJson),
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
    rendererEvents: parseRendererEventStats(row.rendererEventStatsJson),
  }));
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function parseDomAttributions(value: unknown): MonitorDomAttribution[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is MonitorDomAttribution => {
      if (!entry || typeof entry !== "object") return false;
      const candidate = entry as Record<string, unknown>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.nodeCount === "number" &&
        typeof candidate.nodeDelta === "number" &&
        typeof candidate.addedNodeCount === "number" &&
        typeof candidate.removedNodeCount === "number" &&
        typeof candidate.mutationCount === "number"
      );
    });
  } catch {
    return [];
  }
}

function parseRendererEventStats(value: unknown): MonitorRendererTelemetry["rendererEvents"] {
  const empty: MonitorRendererTelemetry["rendererEvents"] = {
    receivedCount: 0,
    receivedBytes: 0,
    activeCount: 0,
    backgroundCount: 0,
    applyMs: 0,
    maxApplyMs: 0,
    ignoredCount: 0,
    bufferedCount: 0,
    coalescedCount: 0,
    droppedCount: 0,
    tabClickCount: 0,
    scrollCount: 0,
    paintCount: 0,
    eventToPaintMs: 0,
    maxEventToPaintMs: 0,
    maxEventsPerSecond: 0,
    ipcBurstCount: 0,
    maxBurstSize: 0,
    longTaskDuringBurstMs: 0,
    missedFrameDuringBurstCount: 0,
  };
  if (typeof value !== "string") return empty;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(empty).map((key) => [
        key,
        Number(parsed[key] ?? empty[key as keyof typeof empty]),
      ]),
    ) as unknown as MonitorRendererTelemetry["rendererEvents"];
  } catch {
    return empty;
  }
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
        sample.heapUsedBytes,
        sample.heapTotalBytes,
        sample.externalBytes,
        sample.arrayBuffersBytes,
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
    heapUsedBytes: number | null;
    heapTotalBytes: number | null;
    externalBytes: number | null;
    arrayBuffersBytes: number | null;
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
              sleeping_threads AS sleepingThreads,
              heap_used_bytes AS heapUsedBytes, heap_total_bytes AS heapTotalBytes,
              external_bytes AS externalBytes, array_buffers_bytes AS arrayBuffersBytes
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
      heapUsedBytes: row.heapUsedBytes ?? null,
      heapTotalBytes: row.heapTotalBytes ?? null,
      externalBytes: row.externalBytes ?? null,
      arrayBuffersBytes: row.arrayBuffersBytes ?? null,
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

export function insertSwitchRecord(record: MonitorSwitchRecord): void {
  ensureMonitorTables();
  getDb()
    .prepare(
      `INSERT INTO monitor_switches (
        timestamp, thread_id, agent_id, project_id, source, phase,
        duration_ms, success, error, open_tab_count, previous_thread_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.timestamp,
      record.threadId,
      record.agentId,
      record.projectId,
      record.source,
      record.phase,
      record.durationMs,
      record.success ? 1 : 0,
      record.error ?? null,
      record.openTabCount,
      record.previousThreadId,
    );
}

export function insertTabEvent(event: MonitorTabEvent): void {
  ensureMonitorTables();
  getDb()
    .prepare(
      `INSERT INTO monitor_tab_events (
        timestamp, action, thread_id, open_tab_count, active_thread_id
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(event.timestamp, event.action, event.threadId, event.openTabCount, event.activeThreadId);
}

export function insertTabClickTiming(timing: MonitorTabClickTiming): void {
  ensureMonitorTables();
  getDb()
    .prepare(
      `INSERT INTO monitor_tab_click_timings (
        timestamp, thread_id, click_to_highlight_paint_ms, click_to_switch_resolved_ms,
        switch_duration_ms, phase, success
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      timing.timestamp,
      timing.threadId,
      timing.clickToHighlightPaintMs,
      timing.clickToSwitchResolvedMs,
      timing.switchDurationMs,
      timing.phase,
      timing.success ? 1 : 0,
    );
}

export function listSwitchRecords(limit = 500): MonitorSwitchRecord[] {
  ensureMonitorTables();
  interface SwitchRow {
    timestamp: number;
    threadId: string;
    agentId: string | null;
    projectId: string | null;
    source: string;
    phase: MonitorSwitchPhase;
    durationMs: number;
    success: number;
    error: string | null;
    openTabCount: number;
    previousThreadId: string | null;
  }
  const rows = getDb()
    .prepare(
      `SELECT timestamp, thread_id AS threadId, agent_id AS agentId, project_id AS projectId,
              source, phase, duration_ms AS durationMs, success, error,
              open_tab_count AS openTabCount, previous_thread_id AS previousThreadId
       FROM monitor_switches
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as SwitchRow[];
  return rows.map((row) => ({
    timestamp: row.timestamp,
    threadId: row.threadId,
    agentId: row.agentId,
    projectId: row.projectId,
    source: row.source as MonitorSwitchRecord["source"],
    phase: row.phase,
    durationMs: row.durationMs,
    success: row.success === 1,
    error: row.error ?? undefined,
    openTabCount: row.openTabCount,
    previousThreadId: row.previousThreadId,
  }));
}

export function listTabEvents(limit = 500): MonitorTabEvent[] {
  ensureMonitorTables();
  interface TabEventRow {
    timestamp: number;
    action: string;
    threadId: string;
    openTabCount: number;
    activeThreadId: string | null;
  }
  const rows = getDb()
    .prepare(
      `SELECT timestamp, action, thread_id AS threadId, open_tab_count AS openTabCount,
              active_thread_id AS activeThreadId
       FROM monitor_tab_events
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as TabEventRow[];
  return rows.map((row) => ({
    timestamp: row.timestamp,
    action: row.action as MonitorTabEvent["action"],
    threadId: row.threadId,
    openTabCount: row.openTabCount,
    activeThreadId: row.activeThreadId,
  }));
}

export function listTabClickTimings(limit = 500): MonitorTabClickTiming[] {
  ensureMonitorTables();
  interface ClickTimingRow {
    timestamp: number;
    threadId: string;
    clickToHighlightPaintMs: number;
    clickToSwitchResolvedMs: number;
    switchDurationMs: number | null;
    phase: string | null;
    success: number;
  }
  const rows = getDb()
    .prepare(
      `SELECT timestamp, thread_id AS threadId,
              click_to_highlight_paint_ms AS clickToHighlightPaintMs,
              click_to_switch_resolved_ms AS clickToSwitchResolvedMs,
              switch_duration_ms AS switchDurationMs, phase, success
       FROM monitor_tab_click_timings
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as ClickTimingRow[];
  return rows.map((row) => ({
    timestamp: row.timestamp,
    threadId: row.threadId,
    clickToHighlightPaintMs: row.clickToHighlightPaintMs,
    clickToSwitchResolvedMs: row.clickToSwitchResolvedMs,
    switchDurationMs: row.switchDurationMs,
    phase: row.phase as MonitorSwitchPhase | null,
    success: row.success === 1,
  }));
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
