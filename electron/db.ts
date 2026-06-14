import { DatabaseSync } from "node:sqlite";
import { app } from "electron";
import { join } from "node:path";

let db: DatabaseSync | null = null;

function ensureColumn(table: string, column: string, ddl: string): void {
  const identifierRegex = /^[A-Za-z_][A-Za-z0-9_]*$/;
  if (!identifierRegex.test(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
  if (!identifierRegex.test(column)) {
    throw new Error(`Invalid column name: ${column}`);
  }

  const ddlPrefix = `ALTER TABLE ${table} ADD COLUMN ${column}`.toLowerCase();
  const normalizedDdl = ddl.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalizedDdl.startsWith(ddlPrefix)) {
    throw new Error(`Invalid DDL statement: ${ddl}`);
  }

  const current = db?.prepare(`PRAGMA table_info(${table})`).all() as
    | Array<{ name: string }>
    | undefined;
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
          sort_order INTEGER,
          session_file TEXT,
          created_at INTEGER,
          last_used_at INTEGER,
          FOREIGN KEY (project_id) REFERENCES
  projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_threads_project_id
  ON threads(project_id);
      `);

  ensureColumn("threads", "sort_order", "ALTER TABLE threads ADD COLUMN sort_order INTEGER;");
  ensureColumn("threads", "session_file", "ALTER TABLE threads ADD COLUMN session_file TEXT;");
  ensureColumn("threads", "created_at", "ALTER TABLE threads ADD COLUMN created_at INTEGER;");
  ensureColumn("threads", "last_used_at", "ALTER TABLE threads ADD COLUMN last_used_at INTEGER;");
  db.exec("UPDATE threads SET sort_order = rowid WHERE sort_order IS NULL;");

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

  db.exec(`
        CREATE TABLE IF NOT EXISTS auth_users (
          provider TEXT NOT NULL,
          provider_user_id TEXT PRIMARY KEY,
          email TEXT,
          name TEXT,
          avatar_url TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_auth_users_last_seen
  ON auth_users(last_seen_at DESC);
      `);

  db.exec(`
        UPDATE threads
        SET created_at = COALESCE(
          created_at,
          (SELECT MIN(messages.created_at) FROM messages WHERE messages.thread_id = threads.id),
          CAST(strftime('%s', 'now') AS INTEGER) * 1000
        ),
        last_used_at = COALESCE(
          last_used_at,
          (SELECT MAX(messages.created_at) FROM messages WHERE messages.thread_id = threads.id),
          created_at,
          CAST(strftime('%s', 'now') AS INTEGER) * 1000
        );
        CREATE INDEX IF NOT EXISTS idx_threads_project_last_used
  ON threads(project_id, last_used_at DESC, created_at DESC);
      `);

  return db;
}

export interface AuthUserRecord {
  provider: string;
  provider_user_id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  created_at: number;
  updated_at: number;
  last_seen_at: number;
}

export function upsertAuthUser(input: {
  provider: string;
  providerUserId: string;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
}): AuthUserRecord {
  const database = getDb();
  const now = Date.now();
  const existing = database
    .prepare("SELECT * FROM auth_users WHERE provider_user_id = ?")
    .get(input.providerUserId) as AuthUserRecord | undefined;

  const record: AuthUserRecord = {
    provider: input.provider,
    provider_user_id: input.providerUserId,
    email: input.email ?? null,
    name: input.name ?? null,
    avatar_url: input.avatarUrl ?? null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    last_seen_at: now,
  };

  database
    .prepare(
      `INSERT INTO auth_users (
        provider, provider_user_id, email, name, avatar_url, created_at, updated_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_user_id) DO UPDATE SET
        provider = excluded.provider,
        email = excluded.email,
        name = excluded.name,
        avatar_url = excluded.avatar_url,
        updated_at = excluded.updated_at,
        last_seen_at = excluded.last_seen_at`,
    )
    .run(
      record.provider,
      record.provider_user_id,
      record.email,
      record.name,
      record.avatar_url,
      record.created_at,
      record.updated_at,
      record.last_seen_at,
    );

  return record;
}

export function getAuthUser(providerUserId: string): AuthUserRecord | null {
  const row = getDb()
    .prepare("SELECT * FROM auth_users WHERE provider_user_id = ?")
    .get(providerUserId) as AuthUserRecord | undefined;
  return row ?? null;
}
