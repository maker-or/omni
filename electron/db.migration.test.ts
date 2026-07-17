import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  app: { getPath: () => process.env.PIPPER_LIBRARY_PATH ?? process.env.TMPDIR ?? "/tmp" },
}));

let root: string | null = null;

beforeEach(() => {
  vi.resetModules();
  root = mkdtempSync(join(tmpdir(), "pipper-db-migration-"));
  process.env.PIPPER_LIBRARY_PATH = root;
});

afterEach(() => {
  delete process.env.PIPPER_LIBRARY_PATH;
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

/**
 * Regression: legacy installs created `threads` with `title TEXT NOT NULL`
 * (and other now-nullable constraints). ACP threads are born untitled, so
 * `worktrees:switch` creating the workspace's first thread crashed with
 * "NOT NULL constraint failed: threads.title" until the table is rebuilt.
 */
function seedLegacyDatabase(dir: string): void {
  const legacy = new DatabaseSync(join(dir, "omni.sqlite"));
  legacy.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      icon TEXT
    );
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      created_at INTEGER,
      last_used_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
    INSERT INTO projects (id, path, name, icon) VALUES ('project-1', '/repo', 'Repo', NULL);
    INSERT INTO threads (id, project_id, title, created_at, last_used_at)
      VALUES ('thread-legacy', 'project-1', 'Kept title', 1, 1);
  `);
  legacy.close();
}

describe("threads table legacy-constraint rebuild", () => {
  test("a legacy NOT NULL title no longer rejects untitled threads, and data survives", async () => {
    if (!root) throw new Error("temp dir missing");
    seedLegacyDatabase(root);

    const { getDb } = await import("./db.ts");
    const db = getDb();

    const titleColumn = (
      db.prepare("PRAGMA table_info(threads)").all() as Array<{ name: string; notnull: number }>
    ).find((column) => column.name === "title");
    expect(titleColumn?.notnull).toBe(0);

    // The legacy row survives the rebuild with its backfilled agent identity.
    const { getThread, createThread } = await import("./threads.ts");
    const legacyThread = getThread("thread-legacy");
    expect(legacyThread?.title).toBe("Kept title");
    expect(legacyThread?.agent_id).toBeTruthy();

    // The exact failing operation: creating an untitled workspace thread.
    const created = createThread("project-1", null, "agent-x", "session-x", undefined, "/repo/wt");
    expect(created.title).toBeNull();
    expect(getThread(created.id)?.worktree_path).toBe("/repo/wt");
  });

  test("a current-schema database is left untouched", async () => {
    const { getDb } = await import("./db.ts");
    const db = getDb();
    // Fresh database: title is already nullable and inserts of null work.
    const { createThread } = await import("./threads.ts");
    db.prepare("INSERT INTO projects (id, path, name) VALUES (?, ?, ?)").run(
      "project-1",
      "/repo",
      "Repo",
    );
    const created = createThread("project-1", null, "agent-x", "session-x");
    expect(created.title).toBeNull();
  });
});
