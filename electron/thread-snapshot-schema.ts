import type { DatabaseSync } from "node:sqlite";

/**
 * Display-snapshot schema. Owned here (not in db.ts) so the store can migrate
 * an injected database the same way the application database is migrated.
 *
 * Byte accounting is per row and exact: `slice_bytes` is the UTF-8 length of
 * `slice_json`, `payload_bytes` the on-disk size of every body file the row
 * references. Both are written in the same statement as the content they
 * describe, so a rolled-back transaction can never leave stale totals.
 *
 * `accounted_at` equals `updated_at` when the counts were written by this
 * code. Builds that predate the columns still update `updated_at` (and leave
 * `slice_bytes` untouched), which marks the row for re-accounting instead of
 * silently trusting an old count.
 *
 * Budget queries read only the covering index below. Reading `slice_bytes`
 * or `payload_bytes` from the table itself would walk every row's
 * `slice_json` overflow chain, which is what made the old exact query scale
 * with total transcript bytes.
 */
export function ensureThreadSnapshotSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS thread_snapshots (
      thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
      schema_version INTEGER NOT NULL,
      agent_session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      entry_count INTEGER NOT NULL,
      slice_json TEXT NOT NULL,
      payload_path TEXT NOT NULL,
      payload_bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  const columns = new Set(
    (db.prepare("PRAGMA table_info(thread_snapshots)").all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );
  const added: Array<[string, string]> = [
    ["slice_bytes", "INTEGER"],
    ["accounted_at", "INTEGER"],
    ["written_at", "INTEGER"],
    ["payload_index_json", "TEXT"],
  ];
  for (const [name, type] of added) {
    // Adding a nullable column is O(1): existing rows are not rewritten.
    if (!columns.has(name)) db.exec(`ALTER TABLE thread_snapshots ADD COLUMN ${name} ${type};`);
  }
  db.exec(`
    DROP INDEX IF EXISTS idx_thread_snapshots_updated_at;
    CREATE INDEX IF NOT EXISTS idx_thread_snapshots_budget
      ON thread_snapshots(updated_at, thread_id, slice_bytes, payload_bytes, accounted_at);

    -- Every body file a snapshot row references. Orphan cleanup and eviction
    -- read this narrow table instead of the transcript rows.
    CREATE TABLE IF NOT EXISTS thread_snapshot_files (
      path TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES thread_snapshots(thread_id) ON DELETE CASCADE,
      bytes INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_thread_snapshot_files_thread
      ON thread_snapshot_files(thread_id);
  `);
}

/** Rows whose byte counts were not written by this code (legacy or older build). */
export const UNACCOUNTED_SNAPSHOT_ROWS =
  "slice_bytes IS NULL OR accounted_at IS NULL OR accounted_at <> updated_at";
