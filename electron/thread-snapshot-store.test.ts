import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Thread } from "../contracts/threads.ts";
import { MAX_SESSION_ENTRIES, createEmptySessionSlice } from "../src/lib/acp-session-reducer.ts";

vi.mock("electron", () => ({ app: { getPath: () => process.env.TMPDIR ?? "/tmp" } }));

import {
  SNAPSHOT_INLINE_IMAGE_CHARS,
  THREAD_SNAPSHOT_SCHEMA_VERSION,
  ThreadSnapshotStore,
  hydrateSnapshotImages,
  snapshotImageRefs,
} from "./thread-snapshot-store.ts";

let root: string;
let database: DatabaseSync;
let thread: Thread;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pipper-thread-snapshot-"));
  database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      agent_session_id TEXT NOT NULL
    );
    CREATE TABLE thread_snapshots (
      thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
      schema_version INTEGER NOT NULL,
      agent_session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      entry_count INTEGER NOT NULL,
      slice_json TEXT NOT NULL,
      payload_path TEXT NOT NULL,
      payload_bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO projects (id) VALUES ('project-1');
  `);
  thread = {
    id: "thread-1",
    project_id: "project-1",
    agent_id: "agent-1",
    agent_session_id: "session-1",
    title: "Snapshot",
    worktree_path: null,
    created_at: 1,
    last_used_at: 1,
  };
  database
    .prepare("INSERT INTO threads (id, project_id, agent_id, agent_session_id) VALUES (?, ?, ?, ?)")
    .run(thread.id, thread.project_id, thread.agent_id, thread.agent_session_id);
});

afterEach(() => {
  database.close();
  rmSync(root, { recursive: true, force: true });
});

function addThread(id: string): Thread {
  const next = { ...thread, id, agent_session_id: `session-${id}` };
  database
    .prepare("INSERT INTO threads (id, project_id, agent_id, agent_session_id) VALUES (?, ?, ?, ?)")
    .run(next.id, next.project_id, next.agent_id, next.agent_session_id);
  return next;
}

function writeInput(target: Thread, slice = createEmptySessionSlice(), payloads = new Map()) {
  return {
    threadId: target.id,
    agentSessionId: target.agent_session_id,
    agentId: target.agent_id,
    slice,
    payloads,
  };
}

/** Independent scan: transcript text in SQLite plus every referenced file on disk. */
function independentTotals() {
  const transcriptBytes = (
    database
      .prepare(
        "SELECT COALESCE(SUM(length(CAST(slice_json AS BLOB))), 0) AS bytes FROM thread_snapshots",
      )
      .get() as { bytes: number }
  ).bytes;
  const paths = (
    database.prepare("SELECT path FROM thread_snapshot_files").all() as Array<{ path: string }>
  ).map((row) => row.path);
  const bodyBytes = paths.reduce((sum, path) => sum + statSync(path).size, 0);
  return { transcriptBytes, bodyBytes };
}

function storedTotals(store: ThreadSnapshotStore) {
  const usage = store.storageUsage();
  return { transcriptBytes: usage.transcriptBytes, bodyBytes: usage.bodyBytes };
}

describe("ThreadSnapshotStore", () => {
  test("counts transcript rows in the disk budget and preserves resident payload sources", async () => {
    const pinned = new Set([thread.id]);
    const store = new ThreadSnapshotStore({
      rootPath: root,
      database,
      maxPayloadBytes: 2000,
      isPinned: (id) => pinned.has(id),
    });
    const slice = createEmptySessionSlice({
      entries: [{ type: "agent_text", id: "text", messageId: null, text: "世界".repeat(200) }],
      toolCalls: { call: { toolCallId: "call", title: "Read", hasPayload: true } },
    });
    const first = await store.write({
      threadId: thread.id,
      agentSessionId: thread.agent_session_id,
      agentId: thread.agent_id,
      slice,
      payloads: new Map([["call", { rawOutput: "x" }]]),
    });
    for (const id of ["thread-2", "thread-3"]) {
      database
        .prepare("INSERT INTO threads VALUES (?, ?, ?, ?)")
        .run(id, thread.project_id, thread.agent_id, id);
      await store.write({
        threadId: id,
        agentSessionId: id,
        agentId: thread.agent_id,
        slice,
        payloads: new Map(),
      });
    }
    expect(existsSync(first!.payloadPath)).toBe(true);
    expect(
      database.prepare("SELECT thread_id FROM thread_snapshots ORDER BY thread_id").all(),
    ).toEqual([{ thread_id: "thread-1" }, { thread_id: "thread-3" }]);
    pinned.clear();
    await store.write({
      threadId: "thread-3",
      agentSessionId: "thread-3",
      agentId: thread.agent_id,
      slice,
      payloads: new Map(),
    });
    expect(existsSync(first!.payloadPath)).toBe(false);
    expect(database.prepare("SELECT COUNT(*) AS count FROM threads").get()).toEqual({ count: 3 });
  });

  test("reclaims old orphan generations while preserving recent, referenced and unrelated files", async () => {
    const old = join(root, "orphan-123-abcdef.jsonl.gz");
    const partial = join(root, "orphan-123-abcdee.jsonl.gz.tmp");
    const recent = join(root, "recent-124-abcdef.seg");
    const unrelated = join(root, "notes.jsonl.gz");
    for (const path of [old, partial, recent, unrelated]) writeFileSync(path, "fixture");
    const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    for (const path of [old, partial, unrelated]) utimesSync(path, yesterday, yesterday);
    const store = new ThreadSnapshotStore({ rootPath: root, database });
    await store.write({
      threadId: thread.id,
      agentSessionId: thread.agent_session_id,
      agentId: thread.agent_id,
      slice: createEmptySessionSlice(),
      payloads: new Map(),
    });
    // Cleanup is scheduled maintenance, not a side effect of the first write.
    expect(existsSync(old)).toBe(true);
    await store.runMaintenance();
    expect(existsSync(old)).toBe(false);
    expect(existsSync(partial)).toBe(false);
    expect(existsSync(recent)).toBe(true);
    expect(existsSync(unrelated)).toBe(true);
  });
  test("round-trips a settled lean slice and streamed payload sidecar", async () => {
    const store = new ThreadSnapshotStore({ rootPath: root, database });
    const slice = createEmptySessionSlice({
      entries: [{ type: "agent_text", id: "entry-1", messageId: null, text: "héllo 世界" }],
      toolCalls: { call: { toolCallId: "call", title: "Read", hasPayload: true } },
    });
    const payloads = new Map([["call", { rawOutput: { text: "large output" } }]]);

    await store.write({
      threadId: thread.id,
      agentSessionId: thread.agent_session_id,
      agentId: thread.agent_id,
      slice,
      payloads,
    });

    const loaded = store.load(thread);
    expect(loaded?.slice.entries).toEqual(slice.entries);
    expect(loaded?.slice.isStreaming).toBe(false);
    expect(loaded && existsSync(loaded.payloadPath)).toBe(true);
    await expect(store.loadPayloads(loaded!)).resolves.toEqual(payloads);
  });

  test("trims an oversized slice before recording its entry count", async () => {
    const store = new ThreadSnapshotStore({ rootPath: root, database });
    const entries = Array.from({ length: MAX_SESSION_ENTRIES + 20 }, (_, index) => ({
      type: "agent_text" as const,
      id: `entry-${index}`,
      messageId: null,
      text: String(index),
    }));
    await store.write({
      threadId: thread.id,
      agentSessionId: thread.agent_session_id,
      agentId: thread.agent_id,
      slice: createEmptySessionSlice({ entries }),
      payloads: new Map(),
    });
    expect(store.load(thread)?.slice.entries).toHaveLength(MAX_SESSION_ENTRIES);
  });

  test("invalidates a snapshot when the agent session identity changes", async () => {
    const store = new ThreadSnapshotStore({ rootPath: root, database });
    await store.write({
      threadId: thread.id,
      agentSessionId: thread.agent_session_id,
      agentId: thread.agent_id,
      slice: createEmptySessionSlice(),
      payloads: new Map(),
    });
    expect(store.load({ ...thread, agent_session_id: "session-2" })).toBeNull();
    expect(database.prepare("SELECT COUNT(*) AS count FROM thread_snapshots").get()).toEqual({
      count: 0,
    });
  });

  test("rejects schema and JSON corruption without affecting the thread", async () => {
    const store = new ThreadSnapshotStore({ rootPath: root, database });
    database
      .prepare(`INSERT INTO thread_snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        thread.id,
        THREAD_SNAPSHOT_SCHEMA_VERSION,
        thread.agent_session_id,
        thread.agent_id,
        0,
        "not-json",
        join(root, "missing.gz"),
        0,
        1,
        1,
      );
    expect(store.load(thread)).toBeNull();
    expect(database.prepare("SELECT COUNT(*) AS count FROM threads").get()).toEqual({ count: 1 });
  });

  test("generation writes replace the row and remove the superseded payload", async () => {
    const store = new ThreadSnapshotStore({ rootPath: root, database });
    const input = {
      threadId: thread.id,
      agentSessionId: thread.agent_session_id,
      agentId: thread.agent_id,
      slice: createEmptySessionSlice({
        toolCalls: { a: { toolCallId: "a", title: "Read", hasPayload: true } },
      }),
    };
    await store.write({ ...input, payloads: new Map([["a", { rawOutput: "first" }]]) });
    const first = store.load(thread)!;
    await store.write({ ...input, payloads: new Map([["a", { rawOutput: "second" }]]) });
    const second = store.load(thread)!;
    expect(second.payloadPath).not.toBe(first.payloadPath);
    expect(existsSync(first.payloadPath)).toBe(false);
    expect((await store.loadPayloads(second)).get("a")?.rawOutput).toBe("second");
  });

  test("evicts the least-recent generation when the payload budget is exceeded", async () => {
    const secondThread = { ...thread, id: "thread-2", agent_session_id: "session-2" };
    database
      .prepare(
        "INSERT INTO threads (id, project_id, agent_id, agent_session_id) VALUES (?, ?, ?, ?)",
      )
      .run(
        secondThread.id,
        secondThread.project_id,
        secondThread.agent_id,
        secondThread.agent_session_id,
      );
    const store = new ThreadSnapshotStore({
      rootPath: root,
      database,
      maxPayloadBytes: 1,
    });
    const slice = createEmptySessionSlice({
      toolCalls: {
        old: { toolCallId: "old", title: "Old", hasPayload: true },
        new: { toolCallId: "new", title: "New", hasPayload: true },
      },
    });
    await store.write({
      threadId: thread.id,
      agentSessionId: thread.agent_session_id,
      agentId: thread.agent_id,
      slice,
      payloads: new Map([["old", { rawOutput: "old" }]]),
    });
    const oldPath = store.load(thread)!.payloadPath;
    await new Promise((resolve) => setTimeout(resolve, 2));
    await store.write({
      threadId: secondThread.id,
      agentSessionId: secondThread.agent_session_id,
      agentId: secondThread.agent_id,
      slice,
      payloads: new Map([["new", { rawOutput: "new" }]]),
    });

    expect(store.load(thread)).toBeNull();
    expect(existsSync(oldPath)).toBe(false);
    expect(store.load(secondThread)).not.toBeNull();
  });

  test("hydrates only requested tool payloads", async () => {
    const store = new ThreadSnapshotStore({ rootPath: root, database });
    const slice = createEmptySessionSlice({
      toolCalls: {
        a: { toolCallId: "a", title: "A", hasPayload: true },
        b: { toolCallId: "b", title: "B", hasPayload: true },
      },
    });
    await store.write({
      threadId: thread.id,
      agentSessionId: thread.agent_session_id,
      agentId: thread.agent_id,
      slice,
      payloads: new Map([
        ["a", { rawOutput: "alpha" }],
        ["b", { rawOutput: "beta" }],
      ]),
    });

    const payloads = await store.loadPayloads(store.load(thread)!, ["b"]);
    expect([...payloads.keys()]).toEqual(["b"]);
    expect(payloads.get("b")?.rawOutput).toBe("beta");
  });

  test("streams an existing generation into a new one with payload overrides", async () => {
    const store = new ThreadSnapshotStore({ rootPath: root, database });
    const firstSlice = createEmptySessionSlice({
      toolCalls: {
        a: { toolCallId: "a", title: "A", hasPayload: true },
        b: { toolCallId: "b", title: "B", hasPayload: true },
      },
    });
    const first = await store.write({
      threadId: thread.id,
      agentSessionId: thread.agent_session_id,
      agentId: thread.agent_id,
      slice: firstSlice,
      payloads: new Map([
        ["a", { rawOutput: "alpha" }],
        ["b", { rawOutput: "old-beta" }],
      ]),
    });
    const nextSlice = createEmptySessionSlice({
      toolCalls: {
        ...firstSlice.toolCalls,
        c: { toolCallId: "c", title: "C", hasPayload: true },
      },
    });
    const next = await store.write({
      threadId: thread.id,
      agentSessionId: thread.agent_session_id,
      agentId: thread.agent_id,
      slice: nextSlice,
      payloads: new Map([
        ["b", { rawOutput: "new-beta" }],
        ["c", { rawOutput: "charlie" }],
      ]),
      baseSnapshot: first,
    });

    const payloads = await store.loadPayloads(next!);
    expect(
      Object.fromEntries([...payloads].map(([id, payload]) => [id, payload.rawOutput])),
    ).toEqual({ a: "alpha", b: "new-beta", c: "charlie" });
  });

  test("keeps the in-memory preload cache within entry and byte budgets", async () => {
    const threads = [thread];
    for (let index = 2; index <= 3; index += 1) {
      const next = { ...thread, id: `thread-${index}`, agent_session_id: `session-${index}` };
      database
        .prepare(
          "INSERT INTO threads (id, project_id, agent_id, agent_session_id) VALUES (?, ?, ?, ?)",
        )
        .run(next.id, next.project_id, next.agent_id, next.agent_session_id);
      threads.push(next);
    }
    const store = new ThreadSnapshotStore({
      rootPath: root,
      database,
      maxMemoryBytes: 8 * 1024,
      maxMemoryEntries: 2,
    });
    for (const candidate of threads) {
      await store.write({
        threadId: candidate.id,
        agentSessionId: candidate.agent_session_id,
        agentId: candidate.agent_id,
        slice: createEmptySessionSlice({
          entries: [{ type: "agent_text", id: candidate.id, messageId: null, text: "cached" }],
        }),
        payloads: new Map(),
      });
    }

    expect(store.memoryCacheStats().threadIds).toEqual(["thread-2", "thread-3"]);
    expect(store.preload([threads[0]!])).toBe(1);
    const stats = store.memoryCacheStats();
    expect(stats.entries).toBe(2);
    expect(stats.bytes).toBeLessThanOrEqual(8 * 1024);
    expect(stats.threadIds).toEqual(["thread-3", "thread-1"]);
  });
  test("keeps exact byte totals through overwrite, eviction and a failed transaction", async () => {
    const store = new ThreadSnapshotStore({ rootPath: root, database, maxPayloadBytes: 6000 });
    const tools = { call: { toolCallId: "call", title: "Read", hasPayload: true } };
    const unicode = (text: string) =>
      createEmptySessionSlice({
        entries: [{ type: "agent_text", id: "t", messageId: null, text }],
        toolCalls: tools,
      });
    await store.write(
      writeInput(
        thread,
        unicode("héllo 世界 🎉".repeat(40)),
        new Map([["call", { rawOutput: "a".repeat(500) }]]),
      ),
    );
    expect(storedTotals(store)).toEqual(independentTotals());

    // Overwrite with a different size.
    await store.write(
      writeInput(thread, unicode("ü".repeat(10)), new Map([["call", { rawOutput: "b" }]])),
    );
    expect(storedTotals(store)).toEqual(independentTotals());

    // Fill past the budget so the least-recent row is evicted.
    for (const id of ["t2", "t3", "t4"]) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      await store.write(writeInput(addThread(id), unicode("世".repeat(600))));
    }
    expect(store.load(thread)).toBeNull();
    expect(storedTotals(store)).toEqual(independentTotals());
    expect(
      store.storageUsage().transcriptBytes + store.storageUsage().bodyBytes,
    ).toBeLessThanOrEqual(6000);

    // A transaction that fails after the row update must not change totals.
    const before = independentTotals();
    database.exec(
      "CREATE TRIGGER fail_files BEFORE INSERT ON thread_snapshot_files BEGIN SELECT RAISE(ABORT, 'injected'); END;",
    );
    const t4 = { ...thread, id: "t4", agent_session_id: "session-t4" };
    await expect(
      store.write(writeInput(t4, unicode("changed"), new Map([["call", { rawOutput: "c" }]]))),
    ).rejects.toThrow(/injected/);
    database.exec("DROP TRIGGER fail_files");
    expect(independentTotals()).toEqual(before);
    expect(storedTotals(store)).toEqual(before);
    expect(store.load(t4)?.slice.entries[0]).toMatchObject({ text: "世".repeat(600) });
  });

  test("reads and backfills legacy rows, then converts them on the next write", async () => {
    const legacyPath = join(root, "thread-1-1700000000000-abc123.jsonl.gz");
    writeFileSync(
      legacyPath,
      gzipSync(
        [
          JSON.stringify(["a", { rawOutput: "alpha" }]),
          JSON.stringify(["b", { rawOutput: "beta" }]),
        ].join("\n") + "\n",
      ),
    );
    const slice = createEmptySessionSlice({
      entries: [{ type: "agent_text", id: "e", messageId: null, text: "legacy 世界" }],
      toolCalls: {
        a: { toolCallId: "a", title: "A", hasPayload: true },
        b: { toolCallId: "b", title: "B", hasPayload: true },
      },
    });
    const sliceJson = JSON.stringify(slice);
    database
      .prepare(`INSERT INTO thread_snapshots VALUES (?, 1, ?, ?, 1, ?, ?, ?, 1, 5)`)
      .run(
        thread.id,
        thread.agent_session_id,
        thread.agent_id,
        sliceJson,
        legacyPath,
        statSync(legacyPath).size,
      );
    const store = new ThreadSnapshotStore({ rootPath: root, database });

    const loaded = store.load(thread)!;
    expect(loaded.bodies?.kind).toBe("legacy");
    expect((await store.loadPayloads(loaded, ["b"])).get("b")).toEqual({ rawOutput: "beta" });
    // Unaccounted rows are measured exactly before the backfill persists them.
    expect(store.storageUsage()).toMatchObject({
      unaccountedRows: 1,
      transcriptBytes: Buffer.byteLength(sliceJson),
    });
    await store.runMaintenance();
    expect(store.storageUsage().unaccountedRows).toBe(0);
    expect(storedTotals(store)).toEqual(independentTotals());

    const converted = (await store.write({
      ...writeInput(thread, slice, new Map([["b", { rawOutput: "beta-2" }]])),
      baseSnapshot: loaded,
    }))!;
    expect(converted.bodies?.kind).toBe("indexed");
    expect(existsSync(legacyPath)).toBe(false);
    expect(Object.fromEntries(await store.loadPayloads(converted))).toEqual({
      a: { rawOutput: "alpha" },
      b: { rawOutput: "beta-2" },
    });
    expect(storedTotals(store)).toEqual(independentTotals());
  });

  test("reads one body without decoding the rest of the file and appends only changes", async () => {
    const store = new ThreadSnapshotStore({ rootPath: root, database });
    const toolCalls: Record<string, { toolCallId: string; title: string; hasPayload: boolean }> =
      {};
    const payloads = new Map<string, { rawOutput: string }>();
    for (let i = 0; i < 32; i++) {
      toolCalls[`t${i}`] = { toolCallId: `t${i}`, title: `T${i}`, hasPayload: true };
      payloads.set(`t${i}`, { rawOutput: `${i}:`.padEnd(4096, String(i % 10)) });
    }
    const first = (await store.write(
      writeInput(thread, createEmptySessionSlice({ toolCalls }), payloads),
    ))!;

    toolCalls.extra = { toolCallId: "extra", title: "Extra", hasPayload: true };
    const second = (await store.write({
      ...writeInput(
        thread,
        createEmptySessionSlice({ toolCalls }),
        new Map([["extra", { rawOutput: "new" }]]),
      ),
      baseSnapshot: first,
    }))!;
    // The earlier generation's segment is carried forward, not rewritten.
    expect(existsSync(first.payloadPath)).toBe(true);
    expect(statSync(second.payloadPath).size).toBeLessThan(64);

    // Corrupt every record except t31: a scanning reader would fail.
    const location =
      second.bodies!.kind === "indexed" ? second.bodies.index.bodies.get("t31")! : null;
    const bytes = readFileSync(first.payloadPath);
    bytes.fill(0, 0, location![1]);
    writeFileSync(first.payloadPath, bytes);
    expect(await store.loadPayloads(second, ["t31", "extra"])).toEqual(
      new Map([
        ["t31", payloads.get("t31")],
        ["extra", { rawOutput: "new" }],
      ]),
    );
  });

  test("defers deleting a generation until its in-flight readers finish", async () => {
    const store = new ThreadSnapshotStore({ rootPath: root, database });
    const slice = createEmptySessionSlice({
      toolCalls: { a: { toolCallId: "a", title: "A", hasPayload: true } },
    });
    const first = (await store.write(
      writeInput(thread, slice, new Map([["a", { rawOutput: "first" }]])),
    ))!;
    // Pause the reader just before it opens the generation's files.
    let openFile!: () => void;
    const paused = new Promise<void>((resolve) => (openFile = resolve));
    const internals = store as unknown as {
      readBodiesNow: (...args: unknown[]) => Promise<Map<string, unknown>>;
    };
    const readBodiesNow = internals.readBodiesNow.bind(store);
    internals.readBodiesNow = async (...args) => {
      await paused;
      return readBodiesNow(...args);
    };
    const reading = store.loadPayloads(first, ["a"]);
    // A replacement generation commits before the queued read opens the file.
    await store.write({
      ...writeInput(thread, slice, new Map([["a", { rawOutput: "second" }]])),
      baseSnapshot: first,
    });
    expect(existsSync(first.payloadPath)).toBe(true);
    openFile();
    await expect(reading).resolves.toEqual(new Map([["a", { rawOutput: "first" }]]));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(existsSync(first.payloadPath)).toBe(false);
    // A reader that arrives after deletion gets a defined, recoverable error.
    await expect(store.loadPayloads(first, ["a"])).rejects.toMatchObject({
      name: "ThreadSnapshotBodiesUnavailableError",
    });
  });

  test("stores large images as bodies and restores their exact content", async () => {
    const store = new ThreadSnapshotStore({ rootPath: root, database });
    const large = "iVBOR".repeat(SNAPSHOT_INLINE_IMAGE_CHARS);
    const small = "tiny";
    const slice = createEmptySessionSlice({
      entries: [
        {
          type: "user_text",
          id: "u1",
          messageId: null,
          text: "look",
          images: [
            { data: large, mimeType: "image/png" },
            { data: small, mimeType: "image/png" },
          ],
        },
      ],
    });
    const written = (await store.write(writeInput(thread, slice)))!;
    const row = database
      .prepare("SELECT slice_bytes FROM thread_snapshots WHERE thread_id = ?")
      .get(thread.id) as { slice_bytes: number };
    expect(row.slice_bytes).toBeLessThan(1024);

    const loaded = store.load(thread)!;
    const refs = snapshotImageRefs(loaded.slice);
    expect(refs).toHaveLength(1);
    const images = await store.loadImages(loaded, refs);
    const entries = hydrateSnapshotImages(loaded.slice.entries, images)!;
    expect(entries[0]).toMatchObject({
      images: [
        { data: large, mimeType: "image/png" },
        { data: small, mimeType: "image/png" },
      ],
    });

    // Re-persisting hydrated content does not rewrite the stored image.
    const next = (await store.write({
      ...writeInput(thread, { ...loaded.slice, entries }),
      baseSnapshot: written,
    }))!;
    expect(next.payloadPath).toBe(written.payloadPath);
    expect(await store.loadImages(next, refs)).toEqual(new Map([[refs[0], large]]));
  });

  test("does not store the same live image again on later writes", async () => {
    const store = new ThreadSnapshotStore({ rootPath: root, database });
    const slice = createEmptySessionSlice({
      entries: [
        {
          type: "user_text",
          id: "u1",
          messageId: null,
          text: "look",
          images: [{ data: "A".repeat(SNAPSHOT_INLINE_IMAGE_CHARS * 4), mimeType: "image/png" }],
        },
      ],
    });
    const first = (await store.write(writeInput(thread, slice)))!;
    const appended = createEmptySessionSlice({
      entries: [...slice.entries, { type: "agent_text", id: "a1", messageId: null, text: "ok" }],
    });
    const second = (await store.write({ ...writeInput(thread, appended), baseSnapshot: first }))!;
    expect(second.payloadPath).toBe(first.payloadPath);
    expect(second.payloadBytes).toBe(first.payloadBytes);
  });
});
