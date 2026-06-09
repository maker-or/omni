import { randomUUID } from "node:crypto";
import type { Thread } from "../contracts/threads.ts";
import type { Message } from "../contracts/messages.ts";
import { getDb } from "./db.ts";

export function listThreads(): Thread[] {
  const db = getDb();
  const query = db.prepare("SELECT * FROM threads");
  return query.all() as unknown as Thread[];
}

export function getThread(id: string): Thread | null {
  const db = getDb();
  const query = db.prepare("SELECT * FROM threads WHERE id = ?");
  return (query.get(id) as unknown as Thread) || null;
}

export function createThread(
  projectId: string,
  title: string,
  sessionFile: string | null = null,
): Thread {
  const db = getDb();
  const row: Thread = {
    id: randomUUID(),
    project_id: projectId,
    title: title.trim(),
    session_file: sessionFile,
  };
  const stmt = db.prepare(
    "INSERT INTO threads (id, project_id, title, session_file) VALUES (?, ?, ?, ?)",
  );
  stmt.run(row.id, row.project_id, row.title, row.session_file);
  return row;
}

export function deleteThread(id: string): void {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM threads WHERE id = ?");
  stmt.run(id);
}

export function updateThreadSessionFile(id: string, sessionFile: string | null): void {
  const db = getDb();
  const stmt = db.prepare("UPDATE threads SET session_file = ? WHERE id = ?");
  stmt.run(sessionFile, id);
}

export function getMessages(threadId: string): Message[] {
  const db = getDb();
  const query = db.prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC");
  return query.all() as unknown as Message[];
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
