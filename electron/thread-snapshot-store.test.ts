import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Thread } from "../contracts/threads.ts";
import { MAX_SESSION_ENTRIES, createEmptySessionSlice } from "../src/lib/acp-session-reducer.ts";

vi.mock("electron", () => ({ app: { getPath: () => process.env.TMPDIR ?? "/tmp" } }));

import { THREAD_SNAPSHOT_SCHEMA_VERSION, ThreadSnapshotStore } from "./thread-snapshot-store.ts";

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

describe("ThreadSnapshotStore", () => {
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
});
