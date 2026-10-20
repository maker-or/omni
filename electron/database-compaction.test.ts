import { expect, test } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compactDatabase, compactWhenIdle } from "./database-compaction.ts";
import { StorageMaintenance } from "./storage-maintenance.ts";

test("returns SQLite free pages to disk without removing live data", async () => {
  const root = mkdtempSync(join(tmpdir(), "pipper-compact-"));
  try {
    const path = join(root, "test.sqlite");
    const db = new DatabaseSync(path);
    db.exec(
      "PRAGMA journal_mode = WAL; CREATE TABLE data (id INTEGER PRIMARY KEY, value BLOB); INSERT INTO data VALUES (1, randomblob(1048576)), (2, randomblob(1048576)); DELETE FROM data WHERE id = 1; PRAGMA wal_checkpoint(TRUNCATE);",
    );
    const originalValue = db.prepare("SELECT value FROM data WHERE id = 2").get()!.value;
    const result = await compactDatabase(path);
    expect(result.reclaimedBytes).toBeGreaterThan(900_000);
    expect(result.afterBytes).toBeLessThan(result.beforeBytes);
    expect(db.prepare("SELECT id, length(value) AS bytes FROM data").all()).toEqual([
      { id: 2, bytes: 1048576 },
    ]);
    expect(db.prepare("SELECT value FROM data WHERE id = 2").get()!.value).toEqual(originalValue);
    db.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compaction starts only after running work and in-flight writes finish", async () => {
  let busy = true;
  const maintenance = new StorageMaintenance({ isBusy: () => busy, quietMs: 20, pollMs: 5 });
  const release = await maintenance.acquireWrite();
  const order: string[] = [];
  const compaction = maintenance.runWhenIdle(async () => {
    order.push("compact");
    await new Promise((resolve) => setTimeout(resolve, 30));
    order.push("compacted");
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(order).toEqual([]);
  busy = false;
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(order).toEqual([]); // the write is still in flight
  release();
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(order).toEqual(["compact"]);

  // A write requested during maintenance waits instead of contending.
  const write = maintenance.acquireWrite().then((done) => {
    order.push("write");
    done();
  });
  await Promise.all([compaction, write]);
  expect(order).toEqual(["compact", "compacted", "write"]);
});

test("returns busy or insufficient-space without touching the database", async () => {
  const root = mkdtempSync(join(tmpdir(), "pipper-compact-"));
  try {
    const path = join(root, "test.sqlite");
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE data (id INTEGER PRIMARY KEY, value BLOB); INSERT INTO data VALUES (1, randomblob(65536));",
    );
    const busy = new StorageMaintenance({ isBusy: () => true, pollMs: 5, maxWaitMs: 20 });
    await expect(
      compactWhenIdle(path, { maintenance: busy, freeBytes: () => Infinity }),
    ).resolves.toMatchObject({
      status: "busy",
      reclaimedBytes: 0,
    });
    const idle = new StorageMaintenance({ quietMs: 0 });
    const result = await compactWhenIdle(path, { maintenance: idle, freeBytes: () => 1024 });
    expect(result).toMatchObject({ status: "insufficient-space", availableFreeBytes: 1024 });
    expect(result.requiredFreeBytes).toBeGreaterThan(result.beforeBytes);
    await expect(
      compactWhenIdle(path, { maintenance: idle, freeBytes: () => Infinity }),
    ).resolves.toMatchObject({
      status: "completed",
    });
    expect(db.prepare("SELECT length(value) AS bytes FROM data").get()).toEqual({ bytes: 65536 });
    db.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
