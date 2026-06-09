import { DatabaseSync } from "node:sqlite";
import { app } from "electron";
import { join } from "node:path";

let db: DatabaseSync | null = null;

function ensureColumn(table: string, column: string, ddl: string): void {
  const current = db?.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }> | undefined;
  if (!current?.some((row) => row.name === column)) {
    db?.exec(ddl);
  }
}

export function getDb(): DatabaseSync {
  if (db) return db;

  const filePath = join(app.getPath("userData"), "omni.sqlite");
  db = new DatabaseSync(filePath);
  db.exec("PRAGMA foreign_keys = ON;");

  // Create tables manually on startup if they don'texist;
  db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          icon TEXT
        );
      `);

  db.exec(`
        CREATE TABLE IF NOT EXISTS threads (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          session_file TEXT,
          FOREIGN KEY (project_id) REFERENCES
  projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_threads_project_id
  ON threads(project_id);
      `);

  ensureColumn("threads", "session_file", "ALTER TABLE threads ADD COLUMN session_file TEXT;");

  db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (thread_id) REFERENCES threads(id)
  ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_messages_thread_id
  ON messages(thread_id);
        CREATE INDEX IF NOT EXISTS
  idx_messages_thread_created ON messages(thread_id,
  created_at);
      `);

  return db;
}
