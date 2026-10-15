import { DatabaseSync, backup } from "node:sqlite";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { compactDatabase } from "../electron/database-compaction.ts";
import { createHash } from "node:crypto";

function fingerprint(db, tables) {
  const result = {};
  for (const { name } of tables) {
    const hashes = [];
    // Hash logical rows independently of rowid/order; VACUUM may renumber
    // implicit rowids. Only hashes leave the disposable private directory.
    for (const row of db.prepare(`SELECT * FROM ${name}`).iterate()) {
      const json = JSON.stringify(row, (_, value) =>
        value instanceof Uint8Array
          ? { bytes: Buffer.from(value).toString("base64") }
          : typeof value === "bigint"
            ? { integer: value.toString() }
            : value,
      );
      hashes.push(createHash("sha256").update(json).digest("hex"));
    }
    result[name] = createHash("sha256").update(hashes.sort().join("\n")).digest("hex");
  }
  return result;
}

// Read-only source; all mutations are against a disposable SQLite backup.
const source = process.argv[2];
if (!source)
  throw new Error("Usage: node scripts/benchmark-database-compaction.mjs /path/to/omni.sqlite");
const root = await mkdtemp(join(tmpdir(), "pipper-database-bench-"));
await chmod(root, 0o700);
try {
  const input = new DatabaseSync(resolve(source), { readOnly: true });
  const path = join(root, "copy.sqlite");
  try {
    await backup(input, path);
  } finally {
    input.close();
  }
  await chmod(path, 0o600);
  const before = new DatabaseSync(path, { readOnly: true });
  const counts = before
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map(({ name }) => {
      if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error("Unexpected table identifier");
      return { name, rows: before.prepare(`SELECT COUNT(*) AS rows FROM ${name}`).get().rows };
    });
  const beforeContent = fingerprint(before, counts);
  before.close();
  const started = performance.now();
  const result = await compactDatabase(path);
  const compactionMs = performance.now() - started;
  const after = new DatabaseSync(path, { readOnly: true });
  const integrityCheck = after.prepare("PRAGMA integrity_check").get().integrity_check;
  const rowsPreserved = counts.every(
    ({ name, rows }) => after.prepare(`SELECT COUNT(*) AS rows FROM ${name}`).get().rows === rows,
  );
  const contentPreserved =
    JSON.stringify(beforeContent) === JSON.stringify(fingerprint(after, counts));
  after.close();
  if (integrityCheck !== "ok" || !rowsPreserved || !contentPreserved)
    throw new Error("Compaction validation failed");
  console.log(
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        source: resolve(source),
        mode: "disposable SQLite backup; live source read-only",
        ...result,
        elapsedMs: performance.now() - started,
        compactionMs,
        rowsPreserved,
        contentPreserved,
        integrityCheck,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
