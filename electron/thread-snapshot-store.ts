import { randomUUID } from "node:crypto";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { app } from "electron";
import type { DatabaseSync } from "node:sqlite";
import type { AcpEntry } from "../contracts/acp.ts";
import type { Thread } from "../contracts/threads.ts";
import {
  createEmptySessionSlice,
  trimSessionSlice,
  type AcpSessionSlice,
} from "../src/lib/acp-session-reducer.ts";
import type { ToolCallPayload } from "../src/lib/tool-call-payload.ts";
import { getDb } from "./db.ts";
import {
  SegmentWriter,
  ThreadSnapshotBodiesUnavailableError,
  parseBodyIndex,
  readCompressedBodies,
  readIndexedBodies,
  readLegacyBodies,
  serializeBodyIndex,
  type BodyLocation,
  type IndexedBodies,
} from "./thread-snapshot-bodies.ts";
import { applicationStorage } from "./storage-maintenance.ts";
import { ensureThreadSnapshotSchema, UNACCOUNTED_SNAPSHOT_ROWS } from "./thread-snapshot-schema.ts";

export { ThreadSnapshotBodiesUnavailableError } from "./thread-snapshot-bodies.ts";

/**
 * 2: bodies live in indexed segment files and large user images are stored
 * as bodies referenced from the transcript. 1 (legacy, still readable): one
 * gzip JSON-lines sidecar per generation and images inline in `slice_json`.
 * Builds that only understand 1 discard version-2 rows as a cache miss.
 */
export const THREAD_SNAPSHOT_SCHEMA_VERSION = 2;
const LEGACY_SCHEMA_VERSION = 1;
export const DEFAULT_THREAD_SNAPSHOT_CACHE_BYTES = 512 * 1024 * 1024;
export const DEFAULT_THREAD_SNAPSHOT_MEMORY_BYTES = 32 * 1024 * 1024;
export const DEFAULT_THREAD_SNAPSHOT_MEMORY_ENTRIES = 4;
/** Images at least this long (base64 chars) are stored as bodies, not inline. */
export const SNAPSHOT_INLINE_IMAGE_CHARS = 8 * 1024;
const IMAGE_BODY_PREFIX = "pipper-image:";
/** Rewrite carried segments once this many are referenced, or half are dead. */
const MAX_SEGMENTS_PER_GENERATION = 8;
const MIN_COMPACTION_BYTES = 256 * 1024;
const ORPHAN_GRACE_MS = 60 * 60 * 1000;
const DEFAULT_MAINTENANCE_DELAY_MS = 30_000;
const DEFAULT_MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Rows re-accounted per idle step; each step reads and rewrites those rows. */
const BACKFILL_ROWS_PER_STEP = 4;
const GENERATION_FILE = /-\d+-[0-9a-f]+\.(?:jsonl\.gz|seg)(?:\.tmp)?$/;

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
  written_at: number | null;
  payload_index_json: string | null;
}

export type ThreadSnapshotBodies =
  | { kind: "legacy"; path: string }
  | { kind: "indexed"; index: IndexedBodies };

export interface LoadedThreadSnapshot {
  threadId: string;
  agentSessionId: string;
  agentId: string;
  /**
   * Lean, settled slice. Large user images are placeholders
   * (`{ data: "", ref }`) until `loadImages` returns their content.
   */
  slice: AcpSessionSlice;
  /** Newest body file of this generation ("" when it has no bodies). */
  payloadPath: string;
  /** Bytes of every body file this generation references. */
  payloadBytes: number;
  /** LRU recency (touched on load). */
  updatedAt: number;
  /** When this content was written; drives display-cache freshness metrics. */
  writtenAt?: number;
  bodies?: ThreadSnapshotBodies;
}

export interface ThreadSnapshotWriteInput {
  threadId: string;
  agentSessionId: string;
  agentId: string;
  slice: AcpSessionSlice;
  payloads: ReadonlyMap<string, ToolCallPayload>;
  /**
   * Generation the new one is derived from. Indexed generations are carried
   * forward without being read; a legacy generation is converted once.
   */
  baseSnapshot?: LoadedThreadSnapshot | null;
}

/** Waits while database maintenance holds the storage write lock. */
export interface StorageWriteGate {
  acquireWrite(): Promise<() => void>;
}

interface ThreadSnapshotStoreOptions {
  rootPath?: string;
  database?: DatabaseSync;
  maxPayloadBytes?: number;
  maxMemoryBytes?: number;
  maxMemoryEntries?: number;
  enabled?: boolean;
  /** Resident runtimes can still depend on the immutable payload sidecar. */
  isPinned?: (threadId: string) => boolean;
  writeGate?: StorageWriteGate;
  /** First scheduled maintenance (backfill + orphan cleanup); 0 disables scheduling. */
  maintenanceDelayMs?: number;
  maintenanceIntervalMs?: number;
}

interface MemorySnapshotEntry {
  snapshot: LoadedThreadSnapshot;
  bytes: number;
}

export interface ThreadSnapshotStorageUsage {
  rows: number;
  transcriptBytes: number;
  bodyBytes: number;
  /** Bytes of resident (pinned) threads; never evicted for the budget. */
  pinnedBytes: number;
  evictableBytes: number;
  budgetBytes: number;
  /** Rows whose counts still need to be backfilled. */
  unaccountedRows: number;
  /** Files whose deletion waits for a reader to finish. */
  deferredDeletes: number;
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

function bodyFiles(snapshot: LoadedThreadSnapshot): string[] {
  const bodies = snapshot.bodies;
  if (!bodies) return snapshot.payloadPath ? [snapshot.payloadPath] : [];
  return bodies.kind === "legacy" ? [bodies.path] : bodies.index.files.map(([path]) => path);
}

function isImageBodyId(id: string): boolean {
  return id.startsWith(IMAGE_BODY_PREFIX);
}

/** Image references in a slice, newest entry first. */
export function snapshotImageRefs(slice: AcpSessionSlice): string[] {
  const refs: string[] = [];
  for (let index = slice.entries.length - 1; index >= 0; index -= 1) {
    const entry = slice.entries[index]!;
    if (entry.type !== "user_text" || !entry.images) continue;
    for (const image of entry.images) if (image.ref && !image.data) refs.push(image.ref);
  }
  return refs;
}

/**
 * Replace image placeholders with loaded content. Entries without a loaded
 * reference keep their identity so renderer caches stay valid.
 */
export function hydrateSnapshotImages(
  entries: readonly AcpEntry[],
  images: ReadonlyMap<string, string>,
): AcpEntry[] | null {
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.type !== "user_text" || !entry.images?.some((image) => !image.data && image.ref)) {
      return entry;
    }
    let entryChanged = false;
    const hydrated = entry.images.map((image) => {
      const data = !image.data && image.ref ? images.get(image.ref) : undefined;
      if (data === undefined) return image;
      entryChanged = true;
      return { ...image, data };
    });
    if (!entryChanged) return entry;
    changed = true;
    return { ...entry, images: hydrated };
  });
  return changed ? next : null;
}

/**
 * Persistent display cache for settled ACP threads.
 *
 * Body files are generation named and immutable. A new generation is
 * completely written and renamed before SQLite points at it, so a crash can
 * leave an unreferenced file but never a row referring to partial content.
 * Files that are still being read when a newer generation or an eviction
 * releases them are deleted once their readers finish.
 */
export class ThreadSnapshotStore {
  readonly enabled: boolean;
  private readonly rootPath: string;
  private readonly database?: DatabaseSync;
  private schemaReady = false;
  private readonly maxPayloadBytes: number;
  private readonly maxMemoryBytes: number;
  private readonly maxMemoryEntries: number;
  /** Insertion order is access order: oldest entry is the LRU victim. */
  private readonly memorySnapshots = new Map<string, MemorySnapshotEntry>();
  private memorySnapshotBytes = 0;
  private readonly isPinned: (threadId: string) => boolean;
  private readonly writeGate?: StorageWriteGate;
  /** Open reader/writer references per body file. */
  private readonly fileLeases = new Map<string, number>();
  /** Unreferenced files waiting for their leases (or a failed unlink) to clear. */
  private readonly deferredDeletes = new Set<string>();
  /** Concurrent body reads of one generation share a single file pass. */
  private readonly pendingBodyReads = new Map<
    LoadedThreadSnapshot,
    { ids: Set<string>; result: Promise<Map<string, unknown>> }
  >();
  /** Recency touches are batched into one statement per tick. */
  private readonly pendingTouches = new Map<string, number>();
  private touchTask: ReturnType<typeof setImmediate> | null = null;
  private readonly imageRefs = new WeakMap<object, string>();
  private activeWrites = 0;
  private readonly maintenanceDelayMs: number;
  private readonly maintenanceIntervalMs: number;
  private maintenanceTimer: ReturnType<typeof setTimeout> | null = null;
  private maintenanceRun: Promise<void> | null = null;
  private disposed = false;

  constructor(options: ThreadSnapshotStoreOptions = {}) {
    this.enabled = options.enabled ?? process.env.PIPPER_THREAD_SNAPSHOTS !== "0";
    this.rootPath = options.rootPath ?? join(app.getPath("userData"), "thread-snapshots");
    this.database = options.database;
    this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_THREAD_SNAPSHOT_CACHE_BYTES;
    this.maxMemoryBytes = options.maxMemoryBytes ?? DEFAULT_THREAD_SNAPSHOT_MEMORY_BYTES;
    this.maxMemoryEntries = options.maxMemoryEntries ?? DEFAULT_THREAD_SNAPSHOT_MEMORY_ENTRIES;
    this.isPinned = options.isPinned ?? (() => false);
    // The application database's snapshot writes wait out maintenance.
    this.writeGate = options.writeGate ?? (options.database ? undefined : applicationStorage);
    // An injected database belongs to its caller (tests, benchmarks), which
    // runs maintenance explicitly unless it opts into scheduling.
    this.maintenanceDelayMs =
      options.maintenanceDelayMs ?? (options.database ? 0 : DEFAULT_MAINTENANCE_DELAY_MS);
    this.maintenanceIntervalMs = options.maintenanceIntervalMs ?? DEFAULT_MAINTENANCE_INTERVAL_MS;
  }

  private db(): DatabaseSync {
    const db = this.database ?? getDb();
    if (!this.schemaReady) {
      ensureThreadSnapshotSchema(db);
      this.schemaReady = true;
      this.scheduleMaintenance(this.maintenanceDelayMs);
    }
    return db;
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
      .prepare(
        `SELECT thread_id, schema_version, agent_session_id, agent_id, entry_count,
                slice_json, payload_path, payload_bytes, created_at, updated_at,
                written_at, payload_index_json
         FROM thread_snapshots WHERE thread_id = ?`,
      )
      .get(thread.id) as ThreadSnapshotRow | undefined;
    if (!row) return null;
    if (
      (row.schema_version !== THREAD_SNAPSHOT_SCHEMA_VERSION &&
        row.schema_version !== LEGACY_SCHEMA_VERSION) ||
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
      const bodies: ThreadSnapshotBodies =
        row.schema_version === LEGACY_SCHEMA_VERSION
          ? { kind: "legacy", path: row.payload_path }
          : { kind: "indexed", index: parseBodyIndex(row.payload_index_json ?? "") };
      const snapshot: LoadedThreadSnapshot = {
        threadId: row.thread_id,
        agentSessionId: row.agent_session_id,
        agentId: row.agent_id,
        slice,
        payloadPath: row.payload_path,
        payloadBytes: row.payload_bytes,
        updatedAt: Date.now(),
        writtenAt: row.written_at ?? row.updated_at,
        bodies,
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

  /**
   * Tool bodies of one generation. Requests for the same generation made in
   * the same tick share one read; indexed generations read only the
   * requested records.
   */
  async loadPayloads(
    snapshot: LoadedThreadSnapshot,
    toolCallIds?: Iterable<string>,
  ): Promise<Map<string, ToolCallPayload>> {
    const bodies = toolCallIds
      ? await this.readBodies(snapshot, [...toolCallIds])
      : await this.readAllBodies(snapshot);
    const payloads = new Map<string, ToolCallPayload>();
    for (const [id, body] of bodies) {
      if (!isImageBodyId(id)) payloads.set(id, body as ToolCallPayload);
    }
    return payloads;
  }

  /** Content of image placeholders (`image.ref`) in this generation's slice. */
  async loadImages(
    snapshot: LoadedThreadSnapshot,
    refs: Iterable<string>,
  ): Promise<Map<string, string>> {
    const images = new Map<string, string>();
    const ids = [...refs].filter(isImageBodyId);
    if (ids.length === 0) return images;
    for (const [id, body] of await this.readBodies(snapshot, ids)) {
      if (typeof body === "string") images.set(id, body);
    }
    return images;
  }

  private readBodies(
    snapshot: LoadedThreadSnapshot,
    ids: readonly string[],
  ): Promise<Map<string, unknown>> {
    if (ids.length === 0) return Promise.resolve(new Map());
    let batch = this.pendingBodyReads.get(snapshot);
    if (!batch) {
      const batchIds = new Set<string>();
      // Lease before yielding: a replacement or eviction that runs before the
      // read starts must not unlink this generation's files.
      const release = this.lease(bodyFiles(snapshot));
      const result = new Promise<void>((resolve) => setImmediate(resolve))
        .then(() => {
          this.pendingBodyReads.delete(snapshot);
          return this.readBodiesNow(snapshot, batchIds);
        })
        .finally(release);
      batch = { ids: batchIds, result };
      this.pendingBodyReads.set(snapshot, batch);
    }
    for (const id of ids) batch.ids.add(id);
    return batch.result.then((all) => {
      const selected = new Map<string, unknown>();
      for (const id of ids) if (all.has(id)) selected.set(id, all.get(id));
      return selected;
    });
  }

  private async readBodiesNow(
    snapshot: LoadedThreadSnapshot,
    ids: ReadonlySet<string>,
  ): Promise<Map<string, unknown>> {
    const bodies = snapshot.bodies ?? { kind: "legacy" as const, path: snapshot.payloadPath };
    if (bodies.kind === "indexed") return readIndexedBodies(bodies.index, ids);
    const result = new Map<string, unknown>();
    for await (const [id, body] of readLegacyBodies(bodies.path, ids)) result.set(id, body);
    return result;
  }

  private async readAllBodies(snapshot: LoadedThreadSnapshot): Promise<Map<string, unknown>> {
    const release = this.lease(bodyFiles(snapshot));
    try {
      const bodies = snapshot.bodies ?? { kind: "legacy" as const, path: snapshot.payloadPath };
      if (bodies.kind === "indexed") {
        return await readIndexedBodies(bodies.index, bodies.index.bodies.keys());
      }
      const result = new Map<string, unknown>();
      for await (const [id, body] of readLegacyBodies(bodies.path)) result.set(id, body);
      return result;
    } finally {
      release();
    }
  }

  async write(input: ThreadSnapshotWriteInput): Promise<LoadedThreadSnapshot | null> {
    if (!this.enabled || input.slice.isStreaming) return null;
    const releaseGate = this.writeGate ? await this.writeGate.acquireWrite() : () => undefined;
    this.activeWrites += 1;
    try {
      return await this.writeNow(input);
    } finally {
      this.activeWrites -= 1;
      releaseGate();
    }
  }

  private async writeNow(input: ThreadSnapshotWriteInput): Promise<LoadedThreadSnapshot | null> {
    const db = this.db();
    const base = input.baseSnapshot ?? null;
    const baseBodies =
      base?.bodies ?? (base ? { kind: "legacy" as const, path: base.payloadPath } : null);
    const baseIndex = baseBodies?.kind === "indexed" ? baseBodies.index : null;
    const { slice: snapshotSlice, images } = this.externalizeImages(
      settledSlice(input.slice),
      baseIndex,
    );
    await mkdir(this.rootPath, { recursive: true });
    const now = Date.now();
    const generation = `${now}-${Math.random().toString(16).slice(2)}`;
    const safeThreadId = input.threadId.replace(/[^A-Za-z0-9._-]/g, "_");
    const segmentPath = join(this.rootPath, `${safeThreadId}-${generation}.seg`);

    // Bodies this generation must contain: every tool record with a body and
    // every image placeholder in the persisted transcript.
    const live = new Set(Object.keys(snapshotSlice.toolCalls));
    for (const ref of snapshotImageRefs(snapshotSlice)) live.add(ref);
    const overrides = new Map<string, unknown>();
    for (const [id, payload] of input.payloads) if (live.has(id)) overrides.set(id, payload);
    for (const [ref, data] of images) overrides.set(ref, data);

    const releaseBase = base ? this.lease(bodyFiles(base)) : () => undefined;
    // In-flight output: orphan cleanup must not treat it as abandoned.
    const releaseOutput = this.lease([segmentPath, `${segmentPath}.tmp`]);
    let writer: SegmentWriter | null = null;
    let committedPath: string | null = null;
    try {
      const entries = new Map<string, { file: string; offset: number; length: number }>();
      if (baseIndex) {
        for (const [id, [file, offset, length]] of baseIndex.bodies) {
          if (!live.has(id) || overrides.has(id)) continue;
          entries.set(id, { file: baseIndex.files[file]![0], offset, length });
        }
        const sizes = new Map(baseIndex.files);
        const carriedFiles = new Set([...entries.values()].map((entry) => entry.file));
        // Never commit a generation that points at a segment that is gone:
        // fail the write so the caller can rewrite from in-memory bodies.
        for (const file of carriedFiles) {
          await stat(file).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
            throw new ThreadSnapshotBodiesUnavailableError(
              `Snapshot body file is missing: ${file}`,
              { cause: error },
            );
          });
        }
        const carriedFileBytes = [...carriedFiles].reduce((sum, file) => sum + sizes.get(file)!, 0);
        const liveBytes = [...entries.values()].reduce((sum, entry) => sum + entry.length, 0);
        if (
          carriedFiles.size >= MAX_SEGMENTS_PER_GENERATION ||
          (carriedFileBytes >= MIN_COMPACTION_BYTES && liveBytes * 2 < carriedFileBytes)
        ) {
          // Too fragmented or mostly dead: copy live records (still encoded)
          // into the new segment so superseded segments can be released.
          writer = await SegmentWriter.create(segmentPath);
          const copyWriter = writer;
          await readCompressedBodies(baseIndex, entries.keys(), async (id, compressed) => {
            const [offset, length] = await copyWriter.appendCompressed(compressed);
            entries.set(id, { file: segmentPath, offset, length });
          });
        }
      } else if (baseBodies?.kind === "legacy" && baseBodies.path) {
        // One-time conversion of a schema-1 generation.
        writer = await SegmentWriter.create(segmentPath);
        let index = 0;
        for await (const [id, body] of readLegacyBodies(baseBodies.path)) {
          if (!live.has(id) || overrides.has(id)) continue;
          const [offset, length] = await writer.append(id, body);
          entries.set(id, { file: segmentPath, offset, length });
          index += 1;
          if (index % 8 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
      if (overrides.size > 0) {
        writer ??= await SegmentWriter.create(segmentPath);
        for (const [id, body] of overrides) {
          const [offset, length] = await writer.append(id, body);
          entries.set(id, { file: segmentPath, offset, length });
        }
      }
      let segmentBytes = 0;
      if (writer) {
        segmentBytes = await writer.commit();
        committedPath = segmentPath;
        writer = null;
      }

      const fileSizes = new Map(baseIndex?.files ?? []);
      if (committedPath) fileSizes.set(committedPath, segmentBytes);
      const files: Array<readonly [string, number]> = [];
      const fileIndex = new Map<string, number>();
      const bodies = new Map<string, BodyLocation>();
      for (const [id, entry] of entries) {
        let file = fileIndex.get(entry.file);
        if (file === undefined) {
          file = files.length;
          fileIndex.set(entry.file, file);
          files.push([entry.file, fileSizes.get(entry.file)!]);
        }
        bodies.set(id, [file, entry.offset, entry.length]);
      }
      const index: IndexedBodies = { files, bodies };
      const payloadBytes = files.reduce((sum, [, bytes]) => sum + bytes, 0);
      const payloadPath = committedPath ?? files.at(-1)?.[0] ?? "";
      const sliceJson = JSON.stringify(snapshotSlice);
      const previousFiles = this.referencedFiles(input.threadId);
      this.commitRow(db, {
        threadId: input.threadId,
        agentSessionId: input.agentSessionId,
        agentId: input.agentId,
        entryCount: snapshotSlice.entries.length,
        sliceJson,
        payloadPath,
        payloadBytes,
        indexJson: serializeBodyIndex(index),
        files,
        now,
      });
      const kept = new Set(files.map(([path]) => path));
      // The base generation is no longer read by this write; only other
      // readers can still defer deleting the files it no longer shares.
      releaseBase();
      await this.removeFiles([...previousFiles].filter((path) => !kept.has(path)));
      await this.enforceLimit(input.threadId);
      const snapshot: LoadedThreadSnapshot = {
        threadId: input.threadId,
        agentSessionId: input.agentSessionId,
        agentId: input.agentId,
        slice: snapshotSlice,
        payloadPath,
        payloadBytes,
        updatedAt: now,
        writtenAt: now,
        bodies: { kind: "indexed", index },
      };
      this.cacheMemorySnapshot(snapshot, Buffer.byteLength(sliceJson, "utf8"));
      return snapshot;
    } catch (error) {
      await writer?.abort();
      if (committedPath && !this.referencedFiles(input.threadId).has(committedPath)) {
        await this.removeFiles([committedPath]).catch(() => undefined);
      }
      throw error;
    } finally {
      releaseBase();
      releaseOutput();
    }
  }

  /**
   * Store large images as bodies. An image that already carries a reference
   * present in the base generation is unchanged content and is not rewritten.
   */
  private externalizeImages(
    slice: AcpSessionSlice,
    baseIndex: IndexedBodies | null,
  ): { slice: AcpSessionSlice; images: Map<string, string> } {
    const images = new Map<string, string>();
    let changed = false;
    const entries = slice.entries.map((entry) => {
      if (entry.type !== "user_text" || !entry.images?.length) return entry;
      let entryChanged = false;
      const next = entry.images.map((image) => {
        if (!image.ref && image.data.length < SNAPSHOT_INLINE_IMAGE_CHARS) return image;
        // Reducer image objects are immutable, so an object seen by an earlier
        // write keeps its reference and is not stored again.
        const ref = image.ref ?? this.imageRefs.get(image) ?? `${IMAGE_BODY_PREFIX}${randomUUID()}`;
        this.imageRefs.set(image, ref);
        if (image.data && !baseIndex?.bodies.has(ref)) images.set(ref, image.data);
        if (!image.data && image.ref) return image;
        entryChanged = true;
        return { data: "", mimeType: image.mimeType, ref };
      });
      if (!entryChanged) return entry;
      changed = true;
      return { ...entry, images: next };
    });
    return { slice: changed ? { ...slice, entries } : slice, images };
  }

  private commitRow(
    db: DatabaseSync,
    row: {
      threadId: string;
      agentSessionId: string;
      agentId: string;
      entryCount: number;
      sliceJson: string;
      payloadPath: string;
      payloadBytes: number;
      indexJson: string;
      files: ReadonlyArray<readonly [string, number]>;
      now: number;
    },
  ): void {
    // Content, its exact byte counts and the file registry change together.
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        `INSERT INTO thread_snapshots (
           thread_id, schema_version, agent_session_id, agent_id, entry_count,
           slice_json, payload_path, payload_bytes, created_at, updated_at,
           slice_bytes, accounted_at, written_at, payload_index_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           schema_version = excluded.schema_version,
           agent_session_id = excluded.agent_session_id,
           agent_id = excluded.agent_id,
           entry_count = excluded.entry_count,
           slice_json = excluded.slice_json,
           payload_path = excluded.payload_path,
           payload_bytes = excluded.payload_bytes,
           updated_at = excluded.updated_at,
           slice_bytes = excluded.slice_bytes,
           accounted_at = excluded.accounted_at,
           written_at = excluded.written_at,
           payload_index_json = excluded.payload_index_json`,
      ).run(
        row.threadId,
        THREAD_SNAPSHOT_SCHEMA_VERSION,
        row.agentSessionId,
        row.agentId,
        row.entryCount,
        row.sliceJson,
        row.payloadPath,
        row.payloadBytes,
        row.now,
        row.now,
        Buffer.byteLength(row.sliceJson, "utf8"),
        row.now,
        row.now,
        row.indexJson,
      );
      db.prepare("DELETE FROM thread_snapshot_files WHERE thread_id = ?").run(row.threadId);
      const insert = db.prepare(
        "INSERT INTO thread_snapshot_files (path, thread_id, bytes) VALUES (?, ?, ?)",
      );
      for (const [path, bytes] of row.files) insert.run(path, row.threadId, bytes);
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // SQLite may already have rolled the transaction back.
      }
      throw error;
    }
  }

  /** Files the current row of a thread references, including legacy rows. */
  private referencedFiles(threadId: string): Set<string> {
    const db = this.db();
    const files = new Set(
      (
        db
          .prepare("SELECT path FROM thread_snapshot_files WHERE thread_id = ?")
          .all(threadId) as Array<{
          path: string;
        }>
      ).map((row) => row.path),
    );
    // Legacy and not-yet-accounted rows have no registry entries.
    const legacy = db
      .prepare(
        `SELECT payload_path FROM thread_snapshots
         WHERE thread_id = ? AND (${UNACCOUNTED_SNAPSHOT_ROWS})`,
      )
      .get(threadId) as { payload_path: string } | undefined;
    if (legacy?.payload_path) files.add(legacy.payload_path);
    return files;
  }

  async delete(threadId: string): Promise<void> {
    if (!this.enabled) return;
    this.removeMemorySnapshot(threadId);
    const files = this.referencedFiles(threadId);
    // Cascades to thread_snapshot_files.
    this.db().prepare("DELETE FROM thread_snapshots WHERE thread_id = ?").run(threadId);
    await this.removeFiles(files);
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

  /** Budget categories from the narrow index; no transcript rows are read. */
  storageUsage(): ThreadSnapshotStorageUsage {
    const rows = this.db()
      .prepare(
        `SELECT thread_id, slice_bytes, payload_bytes,
                (${UNACCOUNTED_SNAPSHOT_ROWS}) AS unaccounted
         FROM thread_snapshots INDEXED BY idx_thread_snapshots_budget`,
      )
      .all() as Array<{
      thread_id: string;
      slice_bytes: number | null;
      payload_bytes: number;
      unaccounted: number;
    }>;
    const usage: ThreadSnapshotStorageUsage = {
      rows: rows.length,
      transcriptBytes: 0,
      bodyBytes: 0,
      pinnedBytes: 0,
      evictableBytes: 0,
      budgetBytes: this.maxPayloadBytes,
      unaccountedRows: 0,
      deferredDeletes: this.deferredDeletes.size,
    };
    const exact = this.unaccountedSliceBytes();
    for (const row of rows) {
      const sliceBytes = row.unaccounted ? exact.get(row.thread_id)! : row.slice_bytes!;
      if (row.unaccounted) usage.unaccountedRows += 1;
      usage.transcriptBytes += sliceBytes;
      usage.bodyBytes += row.payload_bytes;
      if (this.isPinned(row.thread_id)) usage.pinnedBytes += sliceBytes + row.payload_bytes;
      else usage.evictableBytes += sliceBytes + row.payload_bytes;
    }
    return usage;
  }

  /**
   * Exact UTF-8 transcript bytes of rows whose stored count cannot be trusted
   * yet. Read-only; the backfill persists them in idle maintenance.
   */
  private unaccountedSliceBytes(): Map<string, number> {
    const rows = this.db()
      .prepare(
        `SELECT thread_id, length(CAST(slice_json AS BLOB)) AS bytes
         FROM thread_snapshots WHERE thread_id IN (
           SELECT thread_id FROM thread_snapshots INDEXED BY idx_thread_snapshots_budget
           WHERE ${UNACCOUNTED_SNAPSHOT_ROWS}
         )`,
      )
      .all() as Array<{ thread_id: string; bytes: number }>;
    return new Map(rows.map((row) => [row.thread_id, row.bytes]));
  }

  /**
   * Persist exact counts and the file registry for rows written by code that
   * did not maintain them. Each step is one short transaction.
   */
  backfillAccounting(limit = BACKFILL_ROWS_PER_STEP): number {
    const db = this.db();
    const pending = db
      .prepare(
        `SELECT thread_id FROM thread_snapshots INDEXED BY idx_thread_snapshots_budget
         WHERE ${UNACCOUNTED_SNAPSHOT_ROWS} LIMIT ?`,
      )
      .all(limit) as Array<{ thread_id: string }>;
    for (const { thread_id: threadId } of pending) {
      const row = db
        .prepare(
          `SELECT schema_version, payload_path, payload_bytes, payload_index_json,
                  length(CAST(slice_json AS BLOB)) AS slice_bytes, updated_at
           FROM thread_snapshots WHERE thread_id = ?`,
        )
        .get(threadId) as
        | {
            schema_version: number;
            payload_path: string;
            payload_bytes: number;
            payload_index_json: string | null;
            slice_bytes: number;
            updated_at: number;
          }
        | undefined;
      if (!row) continue;
      let files: Array<readonly [string, number]> = [];
      let payloadBytes = row.payload_bytes;
      if (row.schema_version === THREAD_SNAPSHOT_SCHEMA_VERSION && row.payload_index_json) {
        try {
          files = [...parseBodyIndex(row.payload_index_json).files];
          payloadBytes = files.reduce((sum, [, bytes]) => sum + bytes, 0);
        } catch {
          files = [];
        }
      } else if (row.payload_path) {
        files = [[row.payload_path, row.payload_bytes]];
      }
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          `UPDATE thread_snapshots
           SET slice_bytes = ?, payload_bytes = ?, accounted_at = updated_at,
               written_at = COALESCE(written_at, updated_at)
           WHERE thread_id = ? AND updated_at = ?`,
        ).run(row.slice_bytes, payloadBytes, threadId, row.updated_at);
        db.prepare("DELETE FROM thread_snapshot_files WHERE thread_id = ?").run(threadId);
        const insert = db.prepare(
          "INSERT OR REPLACE INTO thread_snapshot_files (path, thread_id, bytes) VALUES (?, ?, ?)",
        );
        for (const [path, bytes] of files) insert.run(path, threadId, bytes);
        db.exec("COMMIT");
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // SQLite may already have rolled the transaction back.
        }
        throw error;
      }
    }
    return pending.length;
  }

  private touch(entries: ReadonlyMap<string, number>): void {
    const db = this.db();
    // Keep accounted rows accounted; an unaccounted row stays flagged.
    const statement = db.prepare(
      `UPDATE thread_snapshots
       SET accounted_at = CASE WHEN accounted_at = updated_at THEN ?1 ELSE accounted_at END,
           updated_at = ?1
       WHERE thread_id = ?2`,
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const [threadId, timestamp] of entries) statement.run(timestamp, threadId);
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // SQLite may already have rolled the transaction back.
      }
      throw error;
    }
  }

  private scheduleTouch(threadId: string, timestamp = Date.now()): void {
    this.pendingTouches.set(threadId, timestamp);
    if (this.touchTask) return;
    this.touchTask = setImmediate(() => {
      this.touchTask = null;
      const entries = new Map(this.pendingTouches);
      this.pendingTouches.clear();
      try {
        this.touch(entries);
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

  /**
   * Evict least-recent snapshots until the budget holds. Totals come from the
   * stored per-row counts via the covering budget index; rows not yet
   * backfilled are measured exactly instead of being left out.
   */
  private async enforceLimit(protectedThreadId: string): Promise<void> {
    const db = this.db();
    const exact = this.unaccountedSliceBytes();
    const totals = db
      .prepare(
        `SELECT COALESCE(SUM(slice_bytes), 0) AS slice_bytes,
                COALESCE(SUM(payload_bytes), 0) AS payload_bytes
         FROM thread_snapshots INDEXED BY idx_thread_snapshots_budget
         WHERE NOT (${UNACCOUNTED_SNAPSHOT_ROWS})`,
      )
      .get() as { slice_bytes: number; payload_bytes: number };
    const unaccountedPayload = db
      .prepare(
        `SELECT COALESCE(SUM(payload_bytes), 0) AS bytes
         FROM thread_snapshots INDEXED BY idx_thread_snapshots_budget
         WHERE ${UNACCOUNTED_SNAPSHOT_ROWS}`,
      )
      .get() as { bytes: number };
    let total = totals.slice_bytes + totals.payload_bytes + unaccountedPayload.bytes;
    for (const bytes of exact.values()) total += bytes;
    if (total <= this.maxPayloadBytes) return;
    const rows = db
      .prepare(
        `SELECT thread_id, slice_bytes, payload_bytes, (${UNACCOUNTED_SNAPSHOT_ROWS}) AS unaccounted
         FROM thread_snapshots INDEXED BY idx_thread_snapshots_budget
         ORDER BY updated_at ASC`,
      )
      .all() as Array<{
      thread_id: string;
      slice_bytes: number | null;
      payload_bytes: number;
      unaccounted: number;
    }>;
    for (const row of rows) {
      if (total <= this.maxPayloadBytes) break;
      // This is a display-cache budget, not permission to discard a resident
      // runtime's backing payload. The newest snapshot is also always kept.
      if (row.thread_id === protectedThreadId || this.isPinned(row.thread_id)) continue;
      const files = this.referencedFiles(row.thread_id);
      db.prepare("DELETE FROM thread_snapshots WHERE thread_id = ?").run(row.thread_id);
      this.removeMemorySnapshot(row.thread_id);
      await this.removeFiles(files);
      total -= (row.unaccounted ? exact.get(row.thread_id)! : row.slice_bytes!) + row.payload_bytes;
    }
  }

  /** Reference body files for the duration of a read or write. */
  private lease(paths: Iterable<string>): () => void {
    const leased = [...paths].filter(Boolean);
    for (const path of leased) this.fileLeases.set(path, (this.fileLeases.get(path) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const path of leased) {
        const count = (this.fileLeases.get(path) ?? 1) - 1;
        if (count > 0) {
          this.fileLeases.set(path, count);
          continue;
        }
        this.fileLeases.delete(path);
        if (this.deferredDeletes.has(path)) {
          void this.removeFiles([path]).catch(() => undefined);
        }
      }
    };
  }

  /** Delete unreferenced files now, or once their last reader finishes. */
  private async removeFiles(paths: Iterable<string>): Promise<void> {
    for (const path of paths) {
      if (!path) continue;
      if (this.fileLeases.has(path)) {
        this.deferredDeletes.add(path);
        continue;
      }
      try {
        await ignoreMissing(path);
        this.deferredDeletes.delete(path);
      } catch (error) {
        // e.g. a Windows sharing violation: retried by scheduled maintenance.
        this.deferredDeletes.add(path);
        console.warn("[thread-snapshot] could not delete body file:", error);
      }
    }
  }

  private scheduleMaintenance(delayMs: number): void {
    if (this.disposed || this.maintenanceTimer || this.maintenanceDelayMs <= 0) return;
    this.maintenanceTimer = setTimeout(() => {
      this.maintenanceTimer = null;
      void this.runMaintenance()
        .catch((error) => console.warn("[thread-snapshot] maintenance failed:", error))
        .finally(() => this.scheduleMaintenance(this.maintenanceIntervalMs));
    }, delayMs);
    this.maintenanceTimer.unref?.();
  }

  /**
   * Idle maintenance: backfill legacy accounting in short steps, retry
   * deferred deletions and reclaim abandoned generation files.
   */
  runMaintenance(): Promise<void> {
    this.maintenanceRun ??= (async () => {
      while (!this.disposed && this.backfillAccounting() > 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      await this.cleanupOrphans();
    })().finally(() => {
      this.maintenanceRun = null;
    });
    return this.maintenanceRun;
  }

  async cleanupOrphans(): Promise<void> {
    if (this.activeWrites > 0) return;
    const db = this.db();
    const referenced = new Set(
      (db.prepare("SELECT path FROM thread_snapshot_files").all() as Array<{ path: string }>).map(
        (row) => row.path,
      ),
    );
    for (const row of db
      .prepare(
        `SELECT payload_path FROM thread_snapshots WHERE thread_id IN (
           SELECT thread_id FROM thread_snapshots INDEXED BY idx_thread_snapshots_budget
           WHERE ${UNACCOUNTED_SNAPSHOT_ROWS})`,
      )
      .all() as Array<{ payload_path: string }>) {
      referenced.add(row.payload_path);
    }
    await this.removeFiles([...this.deferredDeletes].filter((path) => !referenced.has(path)));
    let entries;
    try {
      entries = await readdir(this.rootPath, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const cutoff = Date.now() - ORPHAN_GRACE_MS;
    for (const entry of entries) {
      // Only Pipper generation files; never follow symlinks. Recent files get
      // a grace period in case another app instance is still writing them.
      if (!entry.isFile() || !GENERATION_FILE.test(entry.name)) continue;
      const path = join(this.rootPath, entry.name);
      if (referenced.has(path) || this.fileLeases.has(path)) continue;
      try {
        if ((await stat(path)).mtimeMs < cutoff) await this.removeFiles([path]);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  /** Stop scheduled maintenance (tests and shutdown). */
  dispose(): void {
    this.disposed = true;
    if (this.maintenanceTimer) clearTimeout(this.maintenanceTimer);
    this.maintenanceTimer = null;
  }

  /** Used by tests and cleanup diagnostics. */
  payloadFileName(snapshot: LoadedThreadSnapshot): string {
    return basename(snapshot.payloadPath);
  }
}
