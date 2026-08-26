import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { createInterface } from "node:readline";
import { app } from "electron";
import type { DatabaseSync } from "node:sqlite";
import type { Thread } from "../contracts/threads.ts";
import {
  createEmptySessionSlice,
  trimSessionSlice,
  type AcpSessionSlice,
} from "../src/lib/acp-session-reducer.ts";
import type { ToolCallPayload } from "../src/lib/tool-call-payload.ts";
import { getDb } from "./db.ts";

export const THREAD_SNAPSHOT_SCHEMA_VERSION = 1;
export const DEFAULT_THREAD_SNAPSHOT_CACHE_BYTES = 512 * 1024 * 1024;
export const DEFAULT_THREAD_SNAPSHOT_MEMORY_BYTES = 32 * 1024 * 1024;
export const DEFAULT_THREAD_SNAPSHOT_MEMORY_ENTRIES = 4;

interface ThreadSnapshotRow {
  thread_id: string;
  schema_version: number;
  agent_session_id: string;
  agent_id: string;
  entry_count: number;
  slice_json: string;
  payload_path: string;
  payload_bytes: number;
  created_at: number;
  updated_at: number;
}

export interface LoadedThreadSnapshot {
  threadId: string;
  agentSessionId: string;
  agentId: string;
  slice: AcpSessionSlice;
  payloadPath: string;
  payloadBytes: number;
  updatedAt: number;
}

export interface ThreadSnapshotWriteInput {
  threadId: string;
  agentSessionId: string;
  agentId: string;
  slice: AcpSessionSlice;
  payloads: ReadonlyMap<string, ToolCallPayload>;
  /**
   * Existing immutable generation to stream through when only a subset of
   * payloads changed. This avoids inflating a 200 MiB history into memory just
   * to persist one new turn.
   */
  baseSnapshot?: LoadedThreadSnapshot | null;
}

interface ThreadSnapshotStoreOptions {
  rootPath?: string;
  database?: DatabaseSync;
  maxPayloadBytes?: number;
  maxMemoryBytes?: number;
  maxMemoryEntries?: number;
  enabled?: boolean;
}

interface MemorySnapshotEntry {
  snapshot: LoadedThreadSnapshot;
  bytes: number;
}

function validSlice(value: unknown): value is AcpSessionSlice {
  if (!value || typeof value !== "object") return false;
  const slice = value as Partial<AcpSessionSlice>;
  return (
    Array.isArray(slice.entries) &&
    Boolean(slice.toolCalls) &&
    typeof slice.toolCalls === "object" &&
    Array.isArray(slice.configOptions) &&
    Array.isArray(slice.commands)
  );
}

function settledSlice(slice: AcpSessionSlice): AcpSessionSlice {
  return trimSessionSlice({
    ...createEmptySessionSlice(),
    ...slice,
    isStreaming: false,
    titleChanged: false,
  });
}

async function ignoreMissing(path: string): Promise<void> {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

/**
 * Persistent display cache for settled ACP threads.
 *
 * Payload files are generation named. The file is completely written and
 * renamed before SQLite points at it, so a crash can leave an orphan file but
 * can never make the current row refer to partially written content.
 */
export class ThreadSnapshotStore {
  readonly enabled: boolean;
  private readonly rootPath: string;
  private readonly database?: DatabaseSync;
  private readonly maxPayloadBytes: number;
  private readonly maxMemoryBytes: number;
  private readonly maxMemoryEntries: number;
  /** Insertion order is access order: oldest entry is the LRU victim. */
  private readonly memorySnapshots = new Map<string, MemorySnapshotEntry>();
  private memorySnapshotBytes = 0;

  constructor(options: ThreadSnapshotStoreOptions = {}) {
    this.enabled = options.enabled ?? process.env.PIPPER_THREAD_SNAPSHOTS !== "0";
    this.rootPath = options.rootPath ?? join(app.getPath("userData"), "thread-snapshots");
    this.database = options.database;
    this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_THREAD_SNAPSHOT_CACHE_BYTES;
    this.maxMemoryBytes = options.maxMemoryBytes ?? DEFAULT_THREAD_SNAPSHOT_MEMORY_BYTES;
    this.maxMemoryEntries = options.maxMemoryEntries ?? DEFAULT_THREAD_SNAPSHOT_MEMORY_ENTRIES;
  }

  private db(): DatabaseSync {
    return this.database ?? getDb();
  }

  load(thread: Thread): LoadedThreadSnapshot | null {
    if (!this.enabled) return null;
    const cached = this.memorySnapshots.get(thread.id);
    if (cached) {
      if (
        cached.snapshot.agentSessionId === thread.agent_session_id &&
        cached.snapshot.agentId === thread.agent_id
      ) {
        this.memorySnapshots.delete(thread.id);
        this.memorySnapshots.set(thread.id, cached);
        this.scheduleTouch(thread.id);
        return cached.snapshot;
      }
      this.removeMemorySnapshot(thread.id);
    }
    const row = this.db()
      .prepare("SELECT * FROM thread_snapshots WHERE thread_id = ?")
      .get(thread.id) as ThreadSnapshotRow | undefined;
    if (!row) return null;
    if (
      row.schema_version !== THREAD_SNAPSHOT_SCHEMA_VERSION ||
      row.agent_session_id !== thread.agent_session_id ||
      row.agent_id !== thread.agent_id
    ) {
      void this.delete(thread.id).catch(() => undefined);
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(row.slice_json);
      if (!validSlice(parsed)) throw new Error("Invalid thread snapshot slice");
      const slice = settledSlice(parsed);
      if (slice.entries.length !== row.entry_count) {
        throw new Error("Thread snapshot entry count mismatch");
      }
      const snapshot = {
        threadId: row.thread_id,
        agentSessionId: row.agent_session_id,
        agentId: row.agent_id,
        slice,
        payloadPath: row.payload_path,
        payloadBytes: row.payload_bytes,
        updatedAt: Date.now(),
      };
      // Disk LRU bookkeeping must not sit on the click-to-snapshot-paint path.
      this.scheduleTouch(thread.id, snapshot.updatedAt);
      this.cacheMemorySnapshot(snapshot, Buffer.byteLength(row.slice_json, "utf8"));
      return snapshot;
    } catch {
      void this.delete(thread.id).catch(() => undefined);
      return null;
    }
  }

  async loadPayloads(
    snapshot: LoadedThreadSnapshot,
    toolCallIds?: Iterable<string>,
  ): Promise<Map<string, ToolCallPayload>> {
    const payloads = new Map<string, ToolCallPayload>();
    for await (const [id, payload] of this.readPayloadEntries(snapshot, toolCallIds)) {
      payloads.set(id, payload);
    }
    return payloads;
  }

  private async *readPayloadEntries(
    snapshot: LoadedThreadSnapshot,
    toolCallIds?: Iterable<string>,
  ): AsyncGenerator<[string, ToolCallPayload]> {
    const remaining = toolCallIds ? new Set(toolCallIds) : null;
    if (remaining?.size === 0) return;
    const input = createReadStream(snapshot.payloadPath);
    const lines = createInterface({ input: input.pipe(createGunzip()), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) continue;
      const value: unknown = JSON.parse(line);
      if (!Array.isArray(value) || typeof value[0] !== "string") {
        throw new Error("Invalid thread snapshot payload record");
      }
      if (remaining && !remaining.has(value[0])) continue;
      yield [value[0], (value[1] ?? {}) as ToolCallPayload];
      if (remaining) {
        remaining.delete(value[0]);
        if (remaining.size === 0) break;
      }
    }
  }

  async write(input: ThreadSnapshotWriteInput): Promise<LoadedThreadSnapshot | null> {
    if (!this.enabled || input.slice.isStreaming) return null;
    const snapshotSlice = settledSlice(input.slice);
    await mkdir(this.rootPath, { recursive: true });
    const now = Date.now();
    const generation = `${now}-${Math.random().toString(16).slice(2)}`;
    const safeThreadId = input.threadId.replace(/[^A-Za-z0-9._-]/g, "_");
    const finalPath = join(this.rootPath, `${safeThreadId}-${generation}.jsonl.gz`);
    const tempPath = `${finalPath}.tmp`;

    const liveToolCallIds = new Set(Object.keys(snapshotSlice.toolCalls));
    const overrides = input.payloads;
    const baseEntries = input.baseSnapshot ? this.readPayloadEntries(input.baseSnapshot) : null;

    async function* records() {
      let index = 0;
      if (baseEntries) {
        for await (const entry of baseEntries) {
          if (!liveToolCallIds.has(entry[0]) || overrides.has(entry[0])) continue;
          yield `${JSON.stringify(entry)}\n`;
          index += 1;
          if (index % 8 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
      for (const entry of overrides) {
        if (!liveToolCallIds.has(entry[0])) continue;
        yield `${JSON.stringify(entry)}\n`;
        index += 1;
        if (index % 8 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    try {
      await pipeline(
        Readable.from(records()),
        createGzip(),
        createWriteStream(tempPath, { flags: "wx" }),
      );
      await rename(tempPath, finalPath);
      const payloadBytes = (await stat(finalPath)).size;
      const sliceJson = JSON.stringify(snapshotSlice);
      const previous = this.db()
        .prepare("SELECT payload_path, created_at FROM thread_snapshots WHERE thread_id = ?")
        .get(input.threadId) as Pick<ThreadSnapshotRow, "payload_path" | "created_at"> | undefined;

      this.db()
        .prepare(
          `INSERT INTO thread_snapshots (
             thread_id, schema_version, agent_session_id, agent_id, entry_count,
             slice_json, payload_path, payload_bytes, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(thread_id) DO UPDATE SET
             schema_version = excluded.schema_version,
             agent_session_id = excluded.agent_session_id,
             agent_id = excluded.agent_id,
             entry_count = excluded.entry_count,
             slice_json = excluded.slice_json,
             payload_path = excluded.payload_path,
             payload_bytes = excluded.payload_bytes,
             updated_at = excluded.updated_at`,
        )
        .run(
          input.threadId,
          THREAD_SNAPSHOT_SCHEMA_VERSION,
          input.agentSessionId,
          input.agentId,
          snapshotSlice.entries.length,
          sliceJson,
          finalPath,
          payloadBytes,
          previous?.created_at ?? now,
          now,
        );

      if (previous?.payload_path && previous.payload_path !== finalPath) {
        await ignoreMissing(previous.payload_path);
      }
      await this.enforceLimit(input.threadId);
      const snapshot: LoadedThreadSnapshot = {
        threadId: input.threadId,
        agentSessionId: input.agentSessionId,
        agentId: input.agentId,
        slice: snapshotSlice,
        payloadPath: finalPath,
        payloadBytes,
        updatedAt: now,
      };
      this.cacheMemorySnapshot(snapshot, Buffer.byteLength(sliceJson, "utf8"));
      return snapshot;
    } catch (error) {
      await ignoreMissing(tempPath).catch(() => undefined);
      const current = this.db()
        .prepare("SELECT payload_path FROM thread_snapshots WHERE thread_id = ?")
        .get(input.threadId) as Pick<ThreadSnapshotRow, "payload_path"> | undefined;
      if (current?.payload_path !== finalPath) {
        await ignoreMissing(finalPath).catch(() => undefined);
      }
      throw error;
    }
  }

  async delete(threadId: string): Promise<void> {
    if (!this.enabled) return;
    this.removeMemorySnapshot(threadId);
    const row = this.db()
      .prepare("SELECT payload_path FROM thread_snapshots WHERE thread_id = ?")
      .get(threadId) as Pick<ThreadSnapshotRow, "payload_path"> | undefined;
    this.db().prepare("DELETE FROM thread_snapshots WHERE thread_id = ?").run(threadId);
    if (row?.payload_path) await ignoreMissing(row.payload_path);
  }

  /** Warm likely next threads after the current thread has painted. */
  preload(threads: readonly Thread[]): number {
    let loaded = 0;
    for (const thread of threads) {
      if (this.memorySnapshots.has(thread.id)) continue;
      if (this.load(thread)) loaded += 1;
    }
    return loaded;
  }

  memoryCacheStats(): { entries: number; bytes: number; threadIds: string[] } {
    return {
      entries: this.memorySnapshots.size,
      bytes: this.memorySnapshotBytes,
      threadIds: [...this.memorySnapshots.keys()],
    };
  }

  private touch(threadId: string, timestamp = Date.now()): void {
    this.db()
      .prepare("UPDATE thread_snapshots SET updated_at = ? WHERE thread_id = ?")
      .run(timestamp, threadId);
  }

  private scheduleTouch(threadId: string, timestamp = Date.now()): void {
    setImmediate(() => {
      try {
        this.touch(threadId, timestamp);
      } catch {
        // LRU freshness is best effort and never invalidates a readable snapshot.
      }
    });
  }

  private cacheMemorySnapshot(snapshot: LoadedThreadSnapshot, bytes: number): void {
    this.removeMemorySnapshot(snapshot.threadId);
    if (this.maxMemoryBytes <= 0 || this.maxMemoryEntries <= 0 || bytes > this.maxMemoryBytes) {
      return;
    }
    this.memorySnapshots.set(snapshot.threadId, { snapshot, bytes });
    this.memorySnapshotBytes += bytes;
    while (
      this.memorySnapshots.size > this.maxMemoryEntries ||
      this.memorySnapshotBytes > this.maxMemoryBytes
    ) {
      const oldestThreadId = this.memorySnapshots.keys().next().value as string | undefined;
      if (!oldestThreadId) break;
      this.removeMemorySnapshot(oldestThreadId);
    }
  }

  private removeMemorySnapshot(threadId: string): void {
    const cached = this.memorySnapshots.get(threadId);
    if (!cached) return;
    this.memorySnapshots.delete(threadId);
    this.memorySnapshotBytes -= cached.bytes;
  }

  private async enforceLimit(protectedThreadId: string): Promise<void> {
    let total = (
      this.db()
        .prepare("SELECT COALESCE(SUM(payload_bytes), 0) AS total FROM thread_snapshots")
        .get() as {
        total: number;
      }
    ).total;
    if (total <= this.maxPayloadBytes) return;
    const rows = this.db()
      .prepare(
        "SELECT thread_id, payload_path, payload_bytes FROM thread_snapshots WHERE thread_id != ? ORDER BY updated_at ASC",
      )
      .all(protectedThreadId) as Array<
      Pick<ThreadSnapshotRow, "thread_id" | "payload_path" | "payload_bytes">
    >;
    for (const row of rows) {
      if (total <= this.maxPayloadBytes) break;
      this.db().prepare("DELETE FROM thread_snapshots WHERE thread_id = ?").run(row.thread_id);
      this.removeMemorySnapshot(row.thread_id);
      await ignoreMissing(row.payload_path);
      total -= row.payload_bytes;
    }
  }

  /** Used by tests and cleanup diagnostics. */
  payloadFileName(snapshot: LoadedThreadSnapshot): string {
    return basename(snapshot.payloadPath);
  }
}
