import { DatabaseSync, backup } from "node:sqlite";
import { mkdtemp, mkdir, rm, chmod, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { compactDatabase } from "../electron/database-compaction.ts";
const source = process.argv[2];
if (!source) throw new Error("Provide a source SQLite path; it will only be opened read-only");
const root = await mkdtemp(join(tmpdir(), "pipper-contention-"));
await chmod(root, 0o700);
let db;
try {
  const input = new DatabaseSync(source, { readOnly: true });
  const path = join(root, "copy.sqlite");
  try {
    await backup(input, path);
  } finally {
    input.close();
  }
  db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode=WAL;PRAGMA busy_timeout=0;CREATE TABLE _architecture_write_probe(id INTEGER PRIMARY KEY,value INTEGER);INSERT INTO _architecture_write_probe VALUES(1,0)",
  );
  const update = db.prepare("UPDATE _architecture_write_probe SET value=value+1 WHERE id=1");
  const baselineStart = performance.now();
  update.run();
  const baselineWriteMs = performance.now() - baselineStart;
  let finished = false;
  let done;
  let failure;
  let blockedWriteMs = null;
  let lockObserved = false;
  const ticks = [];
  const start = performance.now();
  let last = start;
  const heartbeat = setInterval(() => {
    const now = performance.now();
    ticks.push(now - last);
    last = now;
  }, 5);
  const compact = compactDatabase(path).then(
    (value) => {
      finished = true;
      done = value;
    },
    (error) => {
      finished = true;
      failure = error;
    },
  );
  while (!finished) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      update.run();
    } catch (error) {
      if (!/locked|busy/i.test(String(error))) throw error;
      lockObserved = true;
      db.exec("PRAGMA busy_timeout=5000");
      const t = performance.now();
      update.run();
      blockedWriteMs = performance.now() - t;
      break;
    }
  }
  await compact;
  await new Promise((resolve) => setTimeout(resolve, 15));
  clearInterval(heartbeat);
  if (failure) throw failure;
  const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
  const report = {
    capturedAt: new Date().toISOString(),
    scope:
      "Actual compactDatabase implementation on a private SQLite backup of the local database. Only a new probe table is modified. A zero-timeout write detects the VACUUM lock; the next synchronous write uses the app's 5000ms busy timeout. This checks shared-writer contention, not live Electron paint or typical user frequency. Other investigation processes may compete for CPU.",
    baselineWriteMs,
    lockObserved,
    blockedWriteMs,
    maxHeartbeatGapMs: Math.max(...ticks),
    elapsedMs: performance.now() - start,
    integrityCheck: integrity,
    compactionResult: done,
  };
  if (!lockObserved || integrity !== "ok")
    throw new Error("Did not reproduce expected safe lock contention");
  const reportPath = fileURLToPath(
    new URL(
      "../docs/architecture/opencode/compaction-contention-verification.json",
      import.meta.url,
    ),
  );
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  db?.close();
  await rm(root, { recursive: true, force: true });
}
