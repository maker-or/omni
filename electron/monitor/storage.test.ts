import { afterEach, beforeEach, expect, test } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMonitorTables, initializeMonitorDb, insertIncident, listIncidents } from "./db.ts";
import {
  hasLegacyMonitorTables,
  migrateLegacyMonitorStep,
  openMonitorDatabase,
  reserveLegacyMonitorIds,
} from "./storage.ts";

let dir: string;
let appPath: string;
let monitorPath: string;
const open: DatabaseSync[] = [];

function connect(path: string, busyTimeoutMs?: number): DatabaseSync {
  const db = openMonitorDatabase(path, busyTimeoutMs);
  open.push(db);
  return db;
}

function rows(db: DatabaseSync, table: string) {
  return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pipper-monitor-storage-"));
  appPath = join(dir, "omni.sqlite");
  monitorPath = join(dir, "monitor.sqlite");
  // An application database from an earlier build: app tables plus monitor rows.
  const app = connect(appPath);
  app.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT)");
  app.prepare("INSERT INTO threads VALUES ('t1', 'kept')").run();
  initializeMonitorDb(app);
  ensureMonitorTables();
  for (let i = 0; i < 7; i++) {
    insertIncident("switch_slow", `slow ${i}`, { index: i, text: "世界".repeat(i * 10) });
  }
  app
    .prepare(
      "INSERT INTO monitor_sessions (id, started_at, ended_at, label) VALUES ('rec-1', 1, 2, 'recording')",
    )
    .run();
});

afterEach(() => {
  for (const db of open.splice(0)) {
    try {
      db.close();
    } catch {
      // already closed
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

test("moves legacy diagnostics into their own database without losing or renumbering rows", () => {
  const app = open[0]!;
  const legacyIncidents = rows(app, "monitor_incidents");
  const legacySessions = rows(app, "monitor_sessions");

  const monitor = connect(monitorPath);
  initializeMonitorDb(monitor);
  ensureMonitorTables();
  reserveLegacyMonitorIds(monitor, app);
  // New diagnostics recorded before the backlog has moved get fresh ids.
  const fresh = insertIncident("switch_failed", "after upgrade", {});
  expect(fresh.id).toBeGreaterThan(7);

  const worker = connect(monitorPath);
  let steps = 0;
  while (!migrateLegacyMonitorStep(worker, appPath, 3)) steps += 1;
  expect(steps).toBeGreaterThan(3);

  expect(hasLegacyMonitorTables(app)).toBe(false);
  expect(rows(app, "threads")).toEqual([{ id: "t1", title: "kept" }]);
  expect(rows(monitor, "monitor_sessions")).toEqual(legacySessions);
  expect(rows(monitor, "monitor_incidents")).toEqual([
    ...legacyIncidents,
    ...rows(monitor, "monitor_incidents").filter((row) => row.id === fresh.id),
  ]);
  expect(listIncidents(100)).toHaveLength(8);
});

test("an interrupted step (copied but not deleted) is repeated without duplicates", () => {
  const app = open[0]!;
  const monitor = connect(monitorPath);
  initializeMonitorDb(monitor);
  ensureMonitorTables();
  reserveLegacyMonitorIds(monitor, app);
  const before = rows(app, "monitor_incidents");

  // Simulate a crash after the copy committed but before the delete did.
  monitor.prepare("ATTACH DATABASE ? AS crashed").run(appPath);
  monitor.exec(
    "INSERT INTO main.monitor_incidents SELECT * FROM crashed.monitor_incidents WHERE rowid <= 4",
  );
  monitor.exec("DETACH DATABASE crashed");

  while (!migrateLegacyMonitorStep(monitor, appPath, 2));
  expect(rows(monitor, "monitor_incidents")).toEqual(before);
});

test("a held diagnostics write lock does not block application writes", () => {
  const app = connect(appPath, 0);
  const diagnostics = connect(monitorPath);
  initializeMonitorDb(diagnostics);
  ensureMonitorTables();
  diagnostics.exec("BEGIN IMMEDIATE");
  insertIncident("switch_slow", "flood", { bytes: "x".repeat(10_000) });
  // With a zero busy timeout any contention would throw SQLITE_BUSY.
  app.prepare("INSERT INTO threads VALUES ('t2', 'written')").run();
  diagnostics.exec("COMMIT");

  // Before the split both domains shared one file and one writer lock.
  const shared = connect(appPath);
  shared.exec("BEGIN IMMEDIATE");
  expect(() => app.prepare("INSERT INTO threads VALUES ('t3', 'blocked')").run()).toThrow(
    /locked|busy/i,
  );
  shared.exec("ROLLBACK");
});
