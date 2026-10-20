import { DatabaseSync } from "node:sqlite";

/**
 * Diagnostics live in their own SQLite file (`monitor.sqlite`). Sample,
 * telemetry and incident writes then contend only with each other, never
 * with thread metadata or display snapshots in `omni.sqlite`, and either
 * file can be compacted without blocking the other's writers.
 *
 * Earlier builds kept the monitor tables in `omni.sqlite`. Those rows are
 * moved in short steps (copy a batch, then delete it from the old file) so
 * no step holds either file's write lock for long. Row ids are preserved; a
 * crash between copy and delete repeats the copy, which `INSERT OR IGNORE`
 * makes idempotent.
 */
export const MONITOR_DATABASE_FILE = "monitor.sqlite";
export const LEGACY_MONITOR_ROWS_PER_STEP = 16;
const LEGACY_SCHEMA = "legacy_app";

export function openMonitorDatabase(path: string, busyTimeoutMs = 5000): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(busyTimeoutMs))};`);
  return db;
}

function monitorTables(db: DatabaseSync, schema = "main"): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM ${schema}.sqlite_master
         WHERE type = 'table' AND name LIKE 'monitor\\_%' ESCAPE '\\' ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function columns(db: DatabaseSync, schema: string, table: string): string[] {
  return (
    db.prepare(`PRAGMA ${schema}.table_info(${quote(table)})`).all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * New rows must not take ids that legacy rows still waiting to be moved
 * own. Raise each AUTOINCREMENT sequence past the legacy maximum before the
 * monitor database accepts any insert. Reads only `max(rowid)` per table.
 */
export function reserveLegacyMonitorIds(monitorDb: DatabaseSync, legacyDb: DatabaseSync): void {
  const legacyTables = new Set(monitorTables(legacyDb));
  for (const table of monitorTables(monitorDb)) {
    if (!legacyTables.has(table)) continue;
    const legacyMax = (
      legacyDb.prepare(`SELECT COALESCE(MAX(rowid), 0) AS id FROM ${quote(table)}`).get() as {
        id: number;
      }
    ).id;
    if (legacyMax <= 0) continue;
    const autoincrement = monitorDb
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { sql: string } | undefined;
    if (!autoincrement?.sql.toUpperCase().includes("AUTOINCREMENT")) continue;
    const current = monitorDb
      .prepare("SELECT seq FROM sqlite_sequence WHERE name = ?")
      .get(table) as { seq: number } | undefined;
    if (current && current.seq >= legacyMax) continue;
    if (current) {
      monitorDb.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = ?").run(legacyMax, table);
    } else {
      monitorDb
        .prepare("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)")
        .run(table, legacyMax);
    }
  }
}

function attached(db: DatabaseSync): boolean {
  return (db.prepare("PRAGMA database_list").all() as Array<{ name: string }>).some(
    (row) => row.name === LEGACY_SCHEMA,
  );
}

/**
 * Move up to `maxRows` legacy rows of one table. Returns true once no legacy
 * monitor table remains (the legacy database is then detached).
 */
export function migrateLegacyMonitorStep(
  db: DatabaseSync,
  legacyPath: string,
  maxRows = LEGACY_MONITOR_ROWS_PER_STEP,
): boolean {
  if (!attached(db)) {
    db.prepare(`ATTACH DATABASE ? AS ${LEGACY_SCHEMA}`).run(legacyPath);
  }
  const target = new Set(monitorTables(db));
  const pending = monitorTables(db, LEGACY_SCHEMA).filter((table) => target.has(table));
  const table = pending[0];
  if (!table) {
    db.exec(`DETACH DATABASE ${LEGACY_SCHEMA}`);
    return true;
  }
  const legacy = `${LEGACY_SCHEMA}.${quote(table)}`;
  const boundary = db
    .prepare(`SELECT MAX(rowid) AS id FROM (SELECT rowid FROM ${legacy} ORDER BY rowid LIMIT ?)`)
    .get(Math.max(1, maxRows)) as { id: number | null };
  if (boundary.id == null) {
    // Empty: dropping it also drops its indexes and sequence entry.
    db.exec(`DROP TABLE ${legacy}`);
    return false;
  }
  const targetColumns = new Set(columns(db, "main", table));
  const shared = columns(db, LEGACY_SCHEMA, table)
    .filter((column) => targetColumns.has(column))
    .map(quote)
    .join(", ");
  // Two separate commits (one per file). Copy first: a crash in between
  // leaves rows in both files, never in neither.
  db.prepare(
    `INSERT OR IGNORE INTO main.${quote(table)} (${shared})
     SELECT ${shared} FROM ${legacy} WHERE rowid <= ?`,
  ).run(boundary.id);
  db.prepare(`DELETE FROM ${legacy} WHERE rowid <= ?`).run(boundary.id);
  return false;
}

/** True when the application database still holds monitor tables. */
export function hasLegacyMonitorTables(legacyDb: DatabaseSync): boolean {
  return monitorTables(legacyDb).length > 0;
}
