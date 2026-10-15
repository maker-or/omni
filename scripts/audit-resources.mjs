import { execFileSync } from "node:child_process";
import { lstat, opendir } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";

// Read-only: inspect metadata, never follow symlinks or read project contents.
export async function measureDirectory(root) {
  const categories = {};
  const seen = new Set();
  let errors = 0;
  let symlinks = 0;
  const categoryFor = (name, inherited) => {
    if (inherited !== "other") return inherited;
    if (name === "node_modules") return "dependencies";
    if ([".next", ".nuxt", "dist", "out", "build", "target", ".build"].includes(name)) {
      return "builds";
    }
    if ([".cache", ".turbo", ".parcel-cache", ".vite"].includes(name)) return "caches";
    if (name === ".git") return "git";
    return inherited;
  };
  async function visit(path, category) {
    let info;
    try {
      info = await lstat(path);
    } catch {
      errors++;
      return;
    }
    if (info.isSymbolicLink()) {
      symlinks++;
      return;
    }
    const key = `${info.dev}:${info.ino}`;
    if (seen.has(key)) return;
    seen.add(key);
    const totals = (categories[category] ??= { files: 0, logicalBytes: 0, allocatedBytes: 0 });
    totals.allocatedBytes += info.blocks * 512;
    if (info.isFile()) {
      totals.files++;
      totals.logicalBytes += info.size;
    } else if (info.isDirectory()) {
      try {
        const directory = await opendir(path);
        for await (const entry of directory) {
          await visit(join(path, entry.name), categoryFor(entry.name, category));
        }
      } catch {
        errors++;
      }
    }
  }
  await visit(resolve(root), "other");
  return {
    path: resolve(root),
    categories,
    logicalBytes: Object.values(categories).reduce((sum, item) => sum + item.logicalBytes, 0),
    allocatedBytes: Object.values(categories).reduce((sum, item) => sum + item.allocatedBytes, 0),
    symlinks,
    errors,
  };
}

export function processTree(rootPid) {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,rss=,comm="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
      return match
        ? {
            pid: +match[1],
            parentPid: +match[2],
            rssBytes: +match[3] * 1024,
            executable: basename(match[4]),
          }
        : null;
    })
    .filter(Boolean);
  const selected = new Set([rootPid]);
  for (let size = -1; size !== selected.size; ) {
    size = selected.size;
    for (const row of rows) if (selected.has(row.parentPid)) selected.add(row.pid);
  }
  const processes = rows.filter((row) => selected.has(row.pid));
  if (!processes.some((row) => row.pid === rootPid))
    throw new Error(`PID ${rootPid} is not running`);
  return {
    processes,
    summedRssBytes: processes.reduce((sum, row) => sum + row.rssBytes, 0),
    note: "RSS includes shared pages per process; the sum is not unique physical RAM.",
  };
}

export async function measureDatabase(path) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(resolve(path), { readOnly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all();
    const rows = tables.map(({ name }) => {
      if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error("Unexpected database table identifier");
      return { name, rows: db.prepare(`SELECT COUNT(*) AS rows FROM ${name}`).get().rows };
    });
    let tableStorage = null;
    try {
      tableStorage = db
        .prepare("SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC")
        .all();
    } catch {
      /* dbstat is not enabled in every SQLite build. */
    }
    return {
      path: resolve(path),
      pageSize: db.prepare("PRAGMA page_size").get().page_size,
      pages: db.prepare("PRAGMA page_count").get().page_count,
      freePages: db.prepare("PRAGMA freelist_count").get().freelist_count,
      tables: rows,
      tableStorage,
    };
  } finally {
    db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const { values } = parseArgs({
    options: {
      worktrees: { type: "string", default: join(homedir(), ".pipper", "worktrees") },
      directory: { type: "string", multiple: true, default: [] },
      database: { type: "string", multiple: true, default: [] },
      pid: { type: "string" },
    },
  });
  const directories = [];
  // Enumerate the managed layout <project-id>/<workspace>; no recursive globbing.
  try {
    for await (const project of await opendir(values.worktrees)) {
      if (!project.isDirectory()) continue;
      const projectPath = join(values.worktrees, project.name);
      for await (const workspace of await opendir(projectPath)) {
        if (workspace.isDirectory()) directories.push(join(projectPath, workspace.name));
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  directories.push(...values.directory);
  const measurements = [];
  for (const directory of directories) measurements.push(await measureDirectory(directory));
  const databases = [];
  for (const path of values.database) databases.push(await measureDatabase(path));
  const rootPid = values.pid === undefined ? null : Number(values.pid);
  if (rootPid !== null && (!Number.isSafeInteger(rootPid) || rootPid <= 0)) {
    throw new Error("--pid must be a positive integer");
  }
  console.log(
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        platform: process.platform,
        directories: measurements,
        databases,
        processes: rootPid === null ? null : processTree(rootPid),
        limitations: [
          "Metadata scan is not atomic; files can change during collection.",
          "Allocated bytes deduplicate hard links within each directory, not APFS/reflink shared extents.",
          "Categories use directory names; other includes source files and uncategorized data.",
        ],
      },
      null,
      2,
    ),
  );
}
