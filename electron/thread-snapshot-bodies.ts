import { createReadStream } from "node:fs";
import { open, rename, unlink, type FileHandle } from "node:fs/promises";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { createGunzip, deflateRaw, inflateRaw } from "node:zlib";

const deflateRawAsync = promisify(deflateRaw);
const inflateRawAsync = promisify(inflateRaw);

/**
 * Indexed body storage for thread snapshots.
 *
 * A segment file is a concatenation of independently deflated records, one
 * per body: `deflateRaw(JSON.stringify([id, body]))`. The index (stored with
 * the snapshot row) maps each id to `[file, offset, length]`, so reading a
 * body inflates only that record, and persisting a new turn appends only the
 * changed bodies to a new segment while older segments are carried forward.
 *
 * Segments are immutable once renamed into place. A generation is the set of
 * segments its index references; segments may be shared by consecutive
 * generations of the same thread.
 */
export type BodyLocation = readonly [file: number, offset: number, length: number];

export interface IndexedBodies {
  /** Absolute segment paths and their byte sizes. */
  files: ReadonlyArray<readonly [path: string, bytes: number]>;
  bodies: ReadonlyMap<string, BodyLocation>;
}

export class ThreadSnapshotBodiesUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ThreadSnapshotBodiesUnavailableError";
  }
}

export function serializeBodyIndex(index: IndexedBodies): string {
  return JSON.stringify({
    v: 1,
    files: index.files,
    bodies: Object.fromEntries(index.bodies),
  });
}

export function parseBodyIndex(json: string): IndexedBodies {
  const value = JSON.parse(json) as {
    v?: unknown;
    files?: unknown;
    bodies?: unknown;
  };
  if (value.v !== 1 || !Array.isArray(value.files) || !value.bodies) {
    throw new Error("Invalid thread snapshot body index");
  }
  const files = value.files.map((file: unknown) => {
    if (
      !Array.isArray(file) ||
      typeof file[0] !== "string" ||
      !Number.isSafeInteger(file[1]) ||
      (file[1] as number) < 0
    ) {
      throw new Error("Invalid thread snapshot body file");
    }
    return [file[0], file[1] as number] as const;
  });
  const bodies = new Map<string, BodyLocation>();
  for (const [id, location] of Object.entries(value.bodies as Record<string, unknown>)) {
    if (
      !Array.isArray(location) ||
      location.length !== 3 ||
      !location.every((part) => Number.isSafeInteger(part) && (part as number) >= 0) ||
      (location[0] as number) >= files.length
    ) {
      throw new Error("Invalid thread snapshot body location");
    }
    bodies.set(id, location as unknown as BodyLocation);
  }
  return { files, bodies };
}

async function openForRead(path: string): Promise<FileHandle> {
  try {
    return await open(path, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ThreadSnapshotBodiesUnavailableError(`Snapshot body file is missing: ${path}`, {
        cause: error,
      });
    }
    throw error;
  }
}

async function readRange(handle: FileHandle, offset: number, length: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length);
  let read = 0;
  while (read < length) {
    const { bytesRead } = await handle.read(buffer, read, length - read, offset + read);
    if (bytesRead === 0) {
      throw new ThreadSnapshotBodiesUnavailableError("Snapshot body file is truncated");
    }
    read += bytesRead;
  }
  return buffer;
}

/**
 * Read the compressed bytes of selected records, grouped per file and in
 * offset order. Records that are adjacent on disk are fetched with one read.
 */
export async function readCompressedBodies(
  index: IndexedBodies,
  ids: Iterable<string>,
  onRecord: (id: string, compressed: Buffer) => void | Promise<void>,
): Promise<void> {
  const byFile = new Map<number, Array<[string, number, number]>>();
  for (const id of ids) {
    const location = index.bodies.get(id);
    if (!location) continue;
    const [file, offset, length] = location;
    let list = byFile.get(file);
    if (!list) byFile.set(file, (list = []));
    list.push([id, offset, length]);
  }
  for (const [file, records] of byFile) {
    records.sort((a, b) => a[1] - b[1]);
    const handle = await openForRead(index.files[file]![0]);
    try {
      let start = 0;
      while (start < records.length) {
        // Coalesce a run of contiguous records into one positional read.
        let end = start + 1;
        while (
          end < records.length &&
          records[end]![1] === records[end - 1]![1] + records[end - 1]![2]
        ) {
          end += 1;
        }
        const first = records[start]!;
        const last = records[end - 1]!;
        const span = await readRange(handle, first[1], last[1] + last[2] - first[1]);
        for (let i = start; i < end; i++) {
          const [id, offset, length] = records[i]!;
          await onRecord(id, span.subarray(offset - first[1], offset - first[1] + length));
        }
        start = end;
      }
    } finally {
      await handle.close();
    }
  }
}

export async function decodeBodyRecord(id: string, compressed: Buffer): Promise<unknown> {
  let value: unknown;
  try {
    value = JSON.parse((await inflateRawAsync(compressed)).toString("utf8"));
  } catch (error) {
    throw new ThreadSnapshotBodiesUnavailableError("Snapshot body record is corrupt", {
      cause: error,
    });
  }
  if (!Array.isArray(value) || value[0] !== id) {
    throw new ThreadSnapshotBodiesUnavailableError("Snapshot body record does not match its index");
  }
  return value[1] ?? {};
}

export async function readIndexedBodies(
  index: IndexedBodies,
  ids: Iterable<string>,
): Promise<Map<string, unknown>> {
  const result = new Map<string, unknown>();
  await readCompressedBodies(index, ids, async (id, compressed) => {
    result.set(id, await decodeBodyRecord(id, compressed));
  });
  return result;
}

/**
 * Legacy (schema 1) sidecar: one gzip stream of `[id, body]` JSON lines.
 * Selected reads still scan, but stop once every requested id was found.
 */
export async function* readLegacyBodies(
  path: string,
  ids?: Iterable<string>,
): AsyncGenerator<[string, unknown]> {
  const remaining = ids ? new Set(ids) : null;
  if (remaining?.size === 0) return;
  const input = createReadStream(path);
  const opened = new Promise<void>((resolve, reject) => {
    input.once("open", () => resolve());
    input.once("error", reject);
  });
  try {
    await opened;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ThreadSnapshotBodiesUnavailableError(`Snapshot body file is missing: ${path}`, {
        cause: error,
      });
    }
    throw error;
  }
  const gunzip = createGunzip();
  // `pipe()` does not forward source errors. Without this, a read error after
  // open leaves the reader (and any write copying from it) pending forever.
  input.once("error", (error) => gunzip.destroy(error));
  const lines = createInterface({ input: input.pipe(gunzip), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line) continue;
      const value: unknown = JSON.parse(line);
      if (!Array.isArray(value) || typeof value[0] !== "string") {
        throw new Error("Invalid thread snapshot payload record");
      }
      if (remaining && !remaining.has(value[0])) continue;
      yield [value[0], value[1] ?? {}];
      if (remaining) {
        remaining.delete(value[0]);
        if (remaining.size === 0) break;
      }
    }
  } finally {
    lines.close();
    input.destroy();
    gunzip.destroy();
  }
}

/** Writes one new segment; nothing is visible at `path` until `commit`. */
export class SegmentWriter {
  private offset = 0;
  private closed = false;
  readonly path: string;
  private readonly tempPath: string;
  private readonly handle: FileHandle;

  private constructor(path: string, tempPath: string, handle: FileHandle) {
    this.path = path;
    this.tempPath = tempPath;
    this.handle = handle;
  }

  static async create(path: string): Promise<SegmentWriter> {
    const tempPath = `${path}.tmp`;
    return new SegmentWriter(path, tempPath, await open(tempPath, "wx"));
  }

  get bytes(): number {
    return this.offset;
  }

  async append(id: string, body: unknown): Promise<readonly [offset: number, length: number]> {
    return this.appendCompressed(await deflateRawAsync(JSON.stringify([id, body])));
  }

  /** Copy an already-encoded record (segment compaction) without re-encoding. */
  async appendCompressed(compressed: Buffer): Promise<readonly [offset: number, length: number]> {
    const offset = this.offset;
    let written = 0;
    while (written < compressed.length) {
      const { bytesWritten } = await this.handle.write(
        compressed,
        written,
        compressed.length - written,
        offset + written,
      );
      written += bytesWritten;
    }
    this.offset += compressed.length;
    return [offset, compressed.length];
  }

  async commit(): Promise<number> {
    this.closed = true;
    await this.handle.close();
    await rename(this.tempPath, this.path);
    return this.offset;
  }

  async abort(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      await this.handle.close().catch(() => undefined);
    }
    await unlink(this.tempPath).catch(() => undefined);
  }
}
