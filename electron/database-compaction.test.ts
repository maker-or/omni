import { expect, test } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compactDatabase } from "./database-compaction.ts";

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
