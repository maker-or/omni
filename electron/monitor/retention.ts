import type { DatabaseSync } from "node:sqlite";
import type { MonitorPruneReport } from "../../contracts/monitor.ts";

/**
 * Diagnostic retention. Incidents are always-on evidence, so each kind gets
 * its own count budget (a storm of one kind cannot evict the others), plus an
 * age limit and a shared payload-byte budget. Durable event streams and
 * recordings get age and row limits. Nothing here looks at incident payload
 * flags: old rows age out by the same rules as new ones.
 *
 * Every pass deletes at most `batchRows * maxBatches` rows so it cannot hold
 * the database for long; an incomplete pass reports `complete: false` and the
 * caller schedules the next one sooner.
 */
export interface MonitorRetentionPolicy {
  incidents: { maxAgeMs: number; maxPerKind: number; maxPayloadBytes: number };
  /** Switch, tab, click-timing, session-cache and connection-episode rows. */
  events: { maxAgeMs: number; maxRowsPerTable: number };
  recordings: {
    maxAgeMs: number;
    /** Newest finished recordings kept; the active recording is extra. */
    maxSessions: number;
    maxRowsPerTable: number;
  };
  batchRows: number;
  maxBatches: number;
  /** Override for tests. */
  now?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_MONITOR_RETENTION: MonitorRetentionPolicy = {
  incidents: { maxAgeMs: 7 * DAY_MS, maxPerKind: 400, maxPayloadBytes: 24 * 1024 * 1024 },
  events: { maxAgeMs: 14 * DAY_MS, maxRowsPerTable: 20_000 },
  recordings: { maxAgeMs: 30 * DAY_MS, maxSessions: 20, maxRowsPerTable: 250_000 },
  batchRows: 2_000,
  maxBatches: 50,
};

const EVENT_TABLES = [
  "monitor_switches",
  "monitor_tab_events",
  "monitor_tab_click_timings",
  "monitor_session_cache_events",
] as const;

const RECORDING_TABLES = [
  "monitor_samples",
  "monitor_renderer_samples",
  "monitor_acp_updates",
  "monitor_bridge_events",
  "monitor_diff_ingestions",
] as const;

class BatchBudget {
  private remaining: number;
  readonly batchRows: number;
  readonly deleted: Record<string, number> = {};

  constructor(policy: MonitorRetentionPolicy) {
    this.remaining = Math.max(1, policy.maxBatches);
    this.batchRows = Math.max(1, policy.batchRows);
  }

  get exhausted(): boolean {
    return this.remaining <= 0;
  }

  /**
   * Repeats `DELETE ... WHERE <key> IN (<select> LIMIT batch)` until nothing
   * matches or the budget runs out. `select` must return the key column and
   * end without a LIMIT clause.
   */
  deleteWhere(
    db: DatabaseSync,
    table: string,
    select: string,
    params: Array<string | number | null> = [],
    key = "id",
  ): void {
    const statement = db.prepare(`DELETE FROM ${table} WHERE ${key} IN (${select} LIMIT ?)`);
    // Only batches that delete something count against the budget; a pass
    // always runs its fixed set of (indexed) checks.
    while (this.remaining > 0) {
      const changes = Number(statement.run(...params, this.batchRows).changes);
      if (changes === 0) return;
      this.remaining -= 1;
      this.deleted[table] = (this.deleted[table] ?? 0) + changes;
      if (changes < this.batchRows) return;
    }
  }

  deleteIds(db: DatabaseSync, table: string, ids: number[]): void {
    for (let offset = 0; offset < ids.length && this.remaining > 0; offset += this.batchRows) {
      this.remaining -= 1;
      const chunk = ids.slice(offset, offset + this.batchRows);
      const placeholders = chunk.map(() => "?").join(",");
      const changes = Number(
        db.prepare(`DELETE FROM ${table} WHERE id IN (${placeholders})`).run(...chunk).changes,
      );
      if (changes > 0) this.deleted[table] = (this.deleted[table] ?? 0) + changes;
    }
  }
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return (
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) !==
    undefined
  );
}

/** Keeps the newest `maxRows` rows of a table (by insertion order). */
function capRows(db: DatabaseSync, budget: BatchBudget, table: string, maxRows: number): void {
  const count = Number(
    (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
  );
  if (count <= maxRows) return;
  // The cutoff id is read once so each batch is an indexed range delete.
  const cutoff = db
    .prepare(`SELECT id FROM ${table} ORDER BY id DESC LIMIT 1 OFFSET ?`)
    .get(maxRows - 1) as { id: number } | undefined;
  if (!cutoff) return;
  budget.deleteWhere(db, table, `SELECT id FROM ${table} WHERE id < ?`, [cutoff.id]);
}

function pruneIncidents(
  db: DatabaseSync,
  budget: BatchBudget,
  policy: MonitorRetentionPolicy["incidents"],
  now: number,
): void {
  budget.deleteWhere(
    db,
    "monitor_incidents",
    `SELECT id FROM monitor_incidents WHERE timestamp < ?`,
    [now - policy.maxAgeMs],
  );
  const kinds = db
    .prepare(
      `SELECT kind, COUNT(*) AS count FROM monitor_incidents GROUP BY kind HAVING COUNT(*) > ?`,
    )
    .all(policy.maxPerKind) as Array<{ kind: string; count: number }>;
  for (const { kind } of kinds) {
    if (budget.exhausted) return;
    const cutoff = db
      .prepare(
        `SELECT timestamp, id FROM monitor_incidents WHERE kind = ?
         ORDER BY timestamp DESC, id DESC LIMIT 1 OFFSET ?`,
      )
      .get(kind, policy.maxPerKind - 1) as { timestamp: number; id: number } | undefined;
    if (!cutoff) continue;
    budget.deleteWhere(
      db,
      "monitor_incidents",
      `SELECT id FROM monitor_incidents WHERE kind = ?
       AND (timestamp < ? OR (timestamp = ? AND id < ?))`,
      [kind, cutoff.timestamp, cutoff.timestamp, cutoff.id],
    );
  }
  if (budget.exhausted) return;
  // Per-kind caps bound this scan to (kinds × maxPerKind) rows.
  const over: number[] = [];
  let bytes = 0;
  for (const row of db
    .prepare(
      `SELECT id, LENGTH(CAST(payload_json AS BLOB)) AS bytes
       FROM monitor_incidents ORDER BY timestamp DESC, id DESC`,
    )
    .iterate() as Iterable<{ id: number; bytes: number }>) {
    bytes += Number(row.bytes);
    if (bytes > policy.maxPayloadBytes) over.push(row.id);
  }
  budget.deleteIds(db, "monitor_incidents", over);
}

function pruneEvents(
  db: DatabaseSync,
  budget: BatchBudget,
  policy: MonitorRetentionPolicy["events"],
  now: number,
): void {
  const cutoff = now - policy.maxAgeMs;
  for (const table of EVENT_TABLES) {
    if (budget.exhausted || !tableExists(db, table)) continue;
    budget.deleteWhere(db, table, `SELECT id FROM ${table} WHERE timestamp < ?`, [cutoff]);
    capRows(db, budget, table, policy.maxRowsPerTable);
  }
  if (budget.exhausted || !tableExists(db, "monitor_connection_episodes")) return;
  // Open episodes describe live connections and are never aged out.
  budget.deleteWhere(
    db,
    "monitor_connection_episodes",
    `SELECT rowid FROM monitor_connection_episodes WHERE ended_at IS NOT NULL AND ended_at < ?`,
    [cutoff],
    "rowid",
  );
  const count = Number(
    (
      db.prepare(`SELECT COUNT(*) AS count FROM monitor_connection_episodes`).get() as {
        count: number;
      }
    ).count,
  );
  if (count > policy.maxRowsPerTable) {
    budget.deleteWhere(
      db,
      "monitor_connection_episodes",
      `SELECT rowid FROM monitor_connection_episodes WHERE ended_at IS NOT NULL
       AND rowid NOT IN (
         SELECT rowid FROM monitor_connection_episodes ORDER BY spawned_at DESC LIMIT ?
       )`,
      [policy.maxRowsPerTable],
      "rowid",
    );
  }
}

function pruneRecordings(
  db: DatabaseSync,
  budget: BatchBudget,
  policy: MonitorRetentionPolicy["recordings"],
  now: number,
): void {
  // Finished sessions beyond the age or count limit. The active (unfinished)
  // recording is never expired as a whole; the row caps below bound it.
  const expired = db
    .prepare(
      `SELECT id FROM monitor_sessions
       WHERE ended_at IS NOT NULL AND (
         started_at < ? OR id NOT IN (
           SELECT id FROM monitor_sessions WHERE ended_at IS NOT NULL
           ORDER BY started_at DESC LIMIT ?
         )
       )`,
    )
    .all(now - policy.maxAgeMs, policy.maxSessions) as Array<{ id: string }>;
  for (const { id } of expired) {
    for (const table of RECORDING_TABLES) {
      if (budget.exhausted) return;
      budget.deleteWhere(db, table, `SELECT id FROM ${table} WHERE session_id = ?`, [id]);
    }
    if (budget.exhausted) return;
    const changes = Number(db.prepare(`DELETE FROM monitor_sessions WHERE id = ?`).run(id).changes);
    if (changes > 0) budget.deleted.monitor_sessions = (budget.deleted.monitor_sessions ?? 0) + 1;
  }
  for (const table of ["monitor_samples", "monitor_renderer_samples"]) {
    if (budget.exhausted) return;
    // Rows written outside a recording (older builds) only age out.
    budget.deleteWhere(
      db,
      table,
      `SELECT id FROM ${table} WHERE session_id IS NULL AND timestamp < ?`,
      [now - policy.maxAgeMs],
    );
  }
  for (const table of RECORDING_TABLES) {
    if (budget.exhausted) return;
    capRows(db, budget, table, policy.maxRowsPerTable);
  }
}

export function pruneMonitorData(
  db: DatabaseSync,
  policy: MonitorRetentionPolicy = DEFAULT_MONITOR_RETENTION,
): MonitorPruneReport {
  const started = performance.now();
  const now = policy.now ?? Date.now();
  const budget = new BatchBudget(policy);
  if (tableExists(db, "monitor_incidents")) pruneIncidents(db, budget, policy.incidents, now);
  if (!budget.exhausted) pruneEvents(db, budget, policy.events, now);
  if (!budget.exhausted && tableExists(db, "monitor_sessions"))
    pruneRecordings(db, budget, policy.recordings, now);
  let freelistBytes: number | null = null;
  try {
    const pages = db.prepare("PRAGMA freelist_count").get() as { freelist_count: number };
    const size = db.prepare("PRAGMA page_size").get() as { page_size: number };
    freelistBytes = Number(pages.freelist_count) * Number(size.page_size);
  } catch {
    freelistBytes = null;
  }
  return {
    finishedAt: Date.now(),
    durationMs: performance.now() - started,
    deletedRows: budget.deleted,
    complete: !budget.exhausted,
    freelistBytes,
  };
}

/** Row counts and incident payload bytes, for diagnostics surfaces. */
export function monitorStorageSummary(db: DatabaseSync): {
  rows: Record<string, number>;
  incidentPayloadBytesByKind: Record<string, number>;
} {
  const rows: Record<string, number> = {};
  for (const table of [
    "monitor_incidents",
    ...EVENT_TABLES,
    "monitor_connection_episodes",
    "monitor_sessions",
    ...RECORDING_TABLES,
  ]) {
    if (!tableExists(db, table)) continue;
    rows[table] = Number(
      (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
    );
  }
  const incidentPayloadBytesByKind: Record<string, number> = {};
  if (tableExists(db, "monitor_incidents")) {
    for (const row of db
      .prepare(
        `SELECT kind, SUM(LENGTH(CAST(payload_json AS BLOB))) AS bytes
         FROM monitor_incidents GROUP BY kind`,
      )
      .all() as Array<{ kind: string; bytes: number }>) {
      incidentPayloadBytesByKind[row.kind] = Number(row.bytes);
    }
  }
  return { rows, incidentPayloadBytesByKind };
}
