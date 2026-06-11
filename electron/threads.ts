import { randomUUID } from "node:crypto";
import type { Thread } from "../contracts/threads.ts";
import type { Message } from "../contracts/messages.ts";
import { getDb } from "./db.ts";

export function listThreads(): Thread[] {
  const db = getDb();
  const query = db.prepare("SELECT * FROM threads ORDER BY sort_order ASC, rowid ASC");
  return query.all() as unknown as Thread[];
}

export function getThread(id: string): Thread | null {
  const db = getDb();
  const query = db.prepare("SELECT * FROM threads WHERE id = ?");
  return (query.get(id) as unknown as Thread) || null;
}

export function getMaxThreadSortOrder(): number {
  const db = getDb();
  const query = db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS maxSortOrder FROM threads");
  const row = query.get() as { maxSortOrder?: number } | undefined;
  return row?.maxSortOrder ?? 0;
}

export function getThreadSortOrder(id: string): number | null {
  const thread = getThread(id);
  if (!thread) return null;
  const order = (thread as Thread & { sort_order?: number | null }).sort_order;
  return typeof order === "number" ? order : null;
}

export function createThread(
  projectId: string,
  title: string,
  sessionFile: string | null = null,
  sortOrder?: number,
): Thread {
  const db = getDb();
  const nextSortOrder = sortOrder ?? getMaxThreadSortOrder() + 1;
  if (sortOrder != null) {
    const shift = db.prepare("UPDATE threads SET sort_order = sort_order + 1 WHERE sort_order >= ?");
    shift.run(sortOrder);
  }
  const row: Thread = {
    id: randomUUID(),
    project_id: projectId,
    title: title.trim(),
    session_file: sessionFile,
  };
  const stmt = db.prepare(
    "INSERT INTO threads (id, project_id, title, sort_order, session_file) VALUES (?, ?, ?, ?, ?)",
  );
  stmt.run(row.id, row.project_id, row.title, nextSortOrder, row.session_file);
  return row;
}

export function deleteThread(id: string): void {
  const db = getDb();
  const thread = getThread(id);
  const stmt = db.prepare("DELETE FROM threads WHERE id = ?");
  stmt.run(id);
  const sortOrder = thread && typeof (thread as Thread & { sort_order?: number | null }).sort_order === "number"
    ? (thread as Thread & { sort_order?: number | null }).sort_order
    : null;
  if (sortOrder != null) {
    const shift = db.prepare("UPDATE threads SET sort_order = sort_order - 1 WHERE sort_order > ?");
    shift.run(sortOrder);
  }
}

export function updateThreadSessionFile(id: string, sessionFile: string | null): void {
  const db = getDb();
  const stmt = db.prepare("UPDATE threads SET session_file = ? WHERE id = ?");
  stmt.run(sessionFile, id);
}

export function updateThreadTitle(id: string, title: string): void {
  const db = getDb();
  const stmt = db.prepare("UPDATE threads SET title = ? WHERE id = ?");
  stmt.run(title.trim(), id);
}

export function getMessages(threadId: string): Message[] {
  const db = getDb();
  const query = db.prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC");
  return query.all(threadId) as unknown as Message[];
}

export function createMessage(input: {
  thread_id: string;
  role: string;
  content: string;
}): Message {
  const db = getDb();
  const row: Message = {
    id: randomUUID(),
    thread_id: input.thread_id,
    role: input.role as any,
    content: input.content,
    created_at: Date.now(),
  };
  const stmt = db.prepare(
    "INSERT INTO messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  stmt.run(row.id, row.thread_id, row.role, row.content, row.created_at);
  return row;
}
