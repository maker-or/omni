import { afterAll, expect, test, vi } from "vitest";
import { DatabaseSync, backup } from "node:sqlite";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { AcpSessionState, AcpEntry, AcpToolCallState } from "../contracts/acp.ts";
import { applySessionUpdate, createEmptySessionSlice } from "../src/lib/acp-session-reducer.ts";
import { toLeanToolCall } from "../src/lib/tool-call-payload.ts";
vi.mock("electron", () => ({ app: { getPath: () => process.env.TMPDIR ?? "/tmp" } }));
vi.mock("../src/components/ui/toast", () => ({ toast: vi.fn() }));
import { ThreadSnapshotStore, snapshotImageRefs } from "./thread-snapshot-store.ts";
import {
  rememberHydratedToolCalls,
  hydrateStoredToolCalls,
  resetToolPayloadStore,
} from "../src/store/tool-payload-store.ts";
import { toPanelSnapshot } from "../src/store/agent-store.ts";
const enabled = process.env.PIPPER_ARCHITECTURE_BENCH === "1";
const root = enabled ? mkdtempSync(join(tmpdir(), "pipper-architecture-costs-")) : null;
const report: Record<string, unknown> = {
  capturedAt: new Date().toISOString(),
  node: process.version,
  limitations:
    "Controlled component benchmarks calling actual production modules. Synthetic high-entropy payloads intentionally expose sidecar scan/rewrite cost. CPU timings are not end-to-end app or frame timings. No changes to live databases.",
};
const schema = `CREATE TABLE thread_snapshots(thread_id TEXT PRIMARY KEY,schema_version INTEGER,agent_session_id TEXT,agent_id TEXT,entry_count INTEGER,slice_json TEXT,payload_path TEXT,payload_bytes INTEGER,created_at INTEGER,updated_at INTEGER)`;
async function timed<T>(fn: () => T | Promise<T>) {
  const begin = performance.now();
  const value = await fn();
  return { ms: performance.now() - begin, value };
}
afterAll(() => {
  if (!enabled) return;
  if (process.env.PIPPER_ARCHITECTURE_REPORT)
    writeFileSync(process.env.PIPPER_ARCHITECTURE_REPORT, JSON.stringify(report, null, 2));
  if (root) rmSync(root, { recursive: true, force: true });
});

test.skipIf(!enabled)(
  "measure selective gzip hydration and snapshot rewrite amplification",
  async () => {
    const database = new DatabaseSync(":memory:");
    database.exec(schema);
    const store = new ThreadSnapshotStore({ rootPath: root!, database, maxMemoryEntries: 0 });
    const toolCalls: Record<string, AcpToolCallState> = {};
    const payloads = new Map();
    for (let i = 0; i < 128; i++) {
      const id = `tool-${i}`;
      toolCalls[id] = { toolCallId: id, title: id, status: "completed", hasPayload: true };
      payloads.set(id, { rawOutput: randomBytes(24 * 1024).toString("base64") });
    }
    const slice = createEmptySessionSlice({ toolCalls });
    let snapshot = (await store.write({
      threadId: "fixture",
      agentSessionId: "fixture",
      agentId: "bench",
      slice,
      payloads,
    }))!;
    const ids = Array.from({ length: 16 }, (_, i) => `tool-${112 + i}`);
    const trials = [];
    for (let run = 0; run < 3; run++) {
      const oneByOne = async () => {
        const result = new Map();
        for (const id of ids) {
          for (const [key, value] of await store.loadPayloads(snapshot, [id]))
            result.set(key, value);
        }
        return result;
      };
      let sequential, batch;
      if (run % 2 === 0) {
        sequential = await timed(oneByOne);
        batch = await timed(() => store.loadPayloads(snapshot, ids));
      } else {
        batch = await timed(() => store.loadPayloads(snapshot, ids));
        sequential = await timed(oneByOne);
      }
      expect(sequential.value.size).toBe(16);
      expect(batch.value).toEqual(sequential.value);
      for (const [id, value] of batch.value) expect(value).toEqual(payloads.get(id));
      trials.push({ run: run + 1, sequentialMs: sequential.ms, batchMs: batch.ms });
    }
    const rewrite = [];
    for (let i = 0; i < 3; i++) {
      const id = `added-${i}`;
      const value = { rawOutput: randomBytes(12 * 1024).toString("base64") };
      toolCalls[id] = { toolCallId: id, title: id, status: "completed", hasPayload: true };
      const previousBytes = snapshot.payloadBytes;
      const next = await timed(() =>
        store.write({
          threadId: "fixture",
          agentSessionId: "fixture",
          agentId: "bench",
          slice: createEmptySessionSlice({ toolCalls: { ...toolCalls } }),
          payloads: new Map([[id, value]]),
          baseSnapshot: snapshot,
        }),
      );
      snapshot = next.value!;
      const read = await store.loadPayloads(snapshot, ["tool-0", id]);
      expect(read.get("tool-0")).toEqual(payloads.get("tool-0"));
      expect(read.get(id)).toEqual(value);
      rewrite.push({
        ms: next.ms,
        baseCompressedBytes: previousBytes,
        changedJsonBytes: Buffer.byteLength(JSON.stringify([id, value]) + "\n"),
        newCompressedBytes: snapshot.payloadBytes,
        // Bytes this write put on disk (indexed generations append only changes).
        writtenBytes: statSync(snapshot.payloadPath).size,
      });
    }
    report.sidecar = {
      toolCount: 128,
      uncompressedBodyBytes: 128 * 32 * 1024,
      requestedIds: 16,
      trials,
      rewrite,
    };
    database.close();
  },
  120000,
);

test.skipIf(!enabled)("measure streaming history scaling and lean input size", () => {
  const update = {
    sessionUpdate: "agent_message_chunk" as const,
    content: { type: "text" as const, text: "chunk " },
  };
  const result = [];
  for (const entriesCount of [0, 500, 1500]) {
    for (const toolsCount of [0, 500]) {
      const entries: AcpEntry[] = Array.from({ length: entriesCount }, (_, i) =>
        i % 2 === 0
          ? { type: "user_text", id: `user-${i}`, messageId: null, text: "Request" }
          : { type: "agent_text", id: `agent-${i}`, messageId: null, text: "Completed response" },
      );
      const toolCalls: Record<string, AcpToolCallState> = Object.fromEntries(
        Array.from({ length: toolsCount }, (_, i) => {
          const id = `tool-${i}`;
          return [
            id,
            {
              toolCallId: id,
              title: id,
              status: "completed",
              hasPayload: true,
              outputPreview: "Small result",
            },
          ];
        }),
      );
      const fixture = () =>
        ({
          ...createEmptySessionSlice({ entries: [...entries], toolCalls: { ...toolCalls } }),
          projectId: "fixture",
          threadId: "fixture",
          agentId: "bench",
          agentSessionId: "fixture",
          cwd: "/tmp",
          isCompacting: false,
          editorText: "",
          authRequiredMessage: null,
          switchingAgent: false,
        }) satisfies AcpSessionState;
      for (let i = 0, s = fixture(); i < 100; i++) {
        s = { ...s, ...applySessionUpdate(s, update) };
        toPanelSnapshot(s);
      }
      const trials = [];
      for (let run = 0; run < 3; run++) {
        let state = fixture();
        let begin = performance.now();
        for (let i = 0; i < 1000; i++) state = { ...state, ...applySessionUpdate(state, update) };
        const reducerMs = performance.now() - begin;
        state = fixture();
        begin = performance.now();
        let view;
        for (let i = 0; i < 1000; i++) {
          state = { ...state, ...applySessionUpdate(state, update) };
          view = toPanelSnapshot(state);
        }
        const withProjectionMs = performance.now() - begin;
        expect(state.entries.at(-1)).toMatchObject({ type: "agent_text" });
        expect(view?.streamingMessage).not.toBeNull();
        trials.push({ reducerMs, withProjectionMs });
      }
      result.push({ entriesCount, toolsCount, chunks: 1000, trials });
    }
  }
  const input = "x".repeat(1024 * 1024);
  const base = { toolCallId: "size", title: "Size", status: "completed" as const };
  const rawInputBytes = Buffer.byteLength(
    JSON.stringify(toLeanToolCall({ ...base, rawInput: { code: input } })),
  );
  const rawOutputBytes = Buffer.byteLength(
    JSON.stringify(toLeanToolCall({ ...base, rawOutput: input })),
  );
  expect(rawInputBytes).toBeGreaterThan(1024 * 1024);
  expect(rawOutputBytes).toBeLessThan(1024);
  report.streaming = {
    result,
    leanToolSize: { bodyBytes: input.length, rawInputBytes, rawOutputBytes },
  };
});

test.skipIf(!enabled)("measure snapshot budget query on a live readonly database", () => {
  const path = process.env.PIPPER_ARCHITECTURE_DATABASE;
  if (!path) {
    report.budgetQuery = {
      skipped: "Provide PIPPER_ARCHITECTURE_DATABASE for readonly real-data query measurement",
    };
    return;
  }
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec("PRAGMA query_only=ON");
  const actual = db.prepare(
    `SELECT thread_id,payload_path,payload_bytes+length(CAST(slice_json AS BLOB)) AS total_bytes FROM thread_snapshots ORDER BY updated_at ASC`,
  );
  const metadataOnly = db.prepare(
    `SELECT thread_id,payload_path,payload_bytes AS total_bytes FROM thread_snapshots ORDER BY updated_at ASC`,
  );
  actual.all();
  metadataOnly.all();
  const trials = [];
  for (let run = 0; run < 10; run++) {
    let begin = performance.now();
    const rows = actual.all();
    const actualMs = performance.now() - begin;
    begin = performance.now();
    metadataOnly.all();
    const metadataOnlyMs = performance.now() - begin;
    trials.push({ actualMs, metadataOnlyMs, rows: rows.length });
  }
  const size = db
    .prepare(
      `SELECT count(*) as rows,sum(length(CAST(slice_json AS BLOB))) as transcriptBytes,sum(payload_bytes) as sidecarBytes FROM thread_snapshots`,
    )
    .get();
  const largest = db
    .prepare(
      "SELECT thread_id,length(CAST(slice_json AS BLOB)) AS bytes FROM thread_snapshots ORDER BY bytes DESC LIMIT 1",
    )
    .get() as { thread_id: string; bytes: number } | undefined;
  const restoreTrials = [];
  if (largest) {
    const read = db.prepare("SELECT slice_json FROM thread_snapshots WHERE thread_id=?");
    for (let i = 0; i < 5; i++) {
      let begin = performance.now();
      const row = read.get(largest.thread_id) as { slice_json: string };
      const sqlReadMs = performance.now() - begin;
      begin = performance.now();
      const parsed = JSON.parse(row.slice_json);
      const parseMs = performance.now() - begin;
      expect(Array.isArray(parsed.entries)).toBe(true);
      restoreTrials.push({
        sqlReadMs,
        parseMs,
        entries: parsed.entries.length,
        tools: Object.keys(parsed.toolCalls).length,
      });
    }
  }
  report.largeSnapshotRead = {
    bytes: largest?.bytes,
    trials: restoreTrials,
    scope:
      "Readonly SQL get and JSON.parse of largest local persisted transcript, not full restore/IPC/paint",
  };
  report.budgetQuery = {
    dataset: size,
    trials,
    comparison:
      "Metadata-only query omits transcript cost; it is an IO lower bound, not a correct replacement. Correct optimization must persist and transactionally maintain transcript byte counts.",
  };
  db.close();
});

test.skipIf(!enabled)("measure renderer hydrated body retention until explicit cleanup", () => {
  if (!global.gc) throw new Error("Run with --execArgv=--expose-gc");
  resetToolPayloadStore();
  global.gc();
  const before = process.memoryUsage();
  function populate() {
    for (let i = 0; i < 24; i++)
      rememberHydratedToolCalls(`retained-${i}`, {
        read: {
          toolCallId: "read",
          title: "Read",
          hasPayload: true,
          rawOutput: randomBytes(384 * 1024).toString("base64"),
        },
      });
  }
  populate();
  global.gc();
  const populated = process.memoryUsage();
  const read = hydrateStoredToolCalls("retained-0", {
    read: { toolCallId: "read", title: "Read", hasPayload: true },
  });
  expect((read.read!.rawOutput as string).length).toBe(512 * 1024);
  resetToolPayloadStore();
  global.gc();
  const cleared = process.memoryUsage();
  report.rendererPayloadRetention = {
    threads: 24,
    bytesPerThread: 512 * 1024,
    retainedHeapBytes: populated.heapUsed - before.heapUsed,
    releasedHeapBytes: populated.heapUsed - cleared.heapUsed,
    before,
    populated,
    cleared,
    scope:
      "Actual renderer cache module in a Node worker with forced GC. No time-based eviction exists; explicit cleanup is exercised. The final validation reference can retain one body during cleanup.",
  };
});

test.skipIf(!enabled)(
  "measure stored byte accounting and transcript image bodies on a private copy",
  async () => {
    const source = process.env.PIPPER_ARCHITECTURE_DATABASE;
    if (!source) {
      report.storedAccounting = { skipped: "Provide PIPPER_ARCHITECTURE_DATABASE" };
      return;
    }
    const copyPath = join(root!, "accounting-copy.sqlite");
    const input = new DatabaseSync(source, { readOnly: true });
    await backup(input, copyPath);
    input.close();
    const db = new DatabaseSync(copyPath);
    const store = new ThreadSnapshotStore({
      rootPath: join(root!, "copy-snapshots"),
      database: db,
      maxMemoryEntries: 0,
    });
    // Migration + one-time backfill (runs in idle maintenance in the app).
    let begin = performance.now();
    store.storageUsage();
    const migrationMs = performance.now() - begin;
    begin = performance.now();
    while (store.backfillAccounting(1_000) > 0);
    const backfillMs = performance.now() - begin;

    const oldExact = db.prepare(
      `SELECT thread_id,payload_path,payload_bytes+length(CAST(slice_json AS BLOB)) AS total_bytes FROM thread_snapshots ORDER BY updated_at ASC`,
    );
    const stored = db.prepare(
      `SELECT COALESCE(SUM(slice_bytes),0)+COALESCE(SUM(payload_bytes),0) AS total FROM thread_snapshots INDEXED BY idx_thread_snapshots_budget`,
    );
    const evictionOrder = db.prepare(
      `SELECT thread_id, slice_bytes + payload_bytes AS total_bytes FROM thread_snapshots INDEXED BY idx_thread_snapshots_budget ORDER BY updated_at ASC`,
    );
    const independent = (oldExact.all() as Array<{ total_bytes: number }>).reduce(
      (sum, row) => sum + row.total_bytes,
      0,
    );
    expect((stored.get() as { total: number }).total).toBe(independent);
    const trials = [];
    for (let run = 0; run < 10; run++) {
      begin = performance.now();
      oldExact.all();
      const oldExactMs = performance.now() - begin;
      begin = performance.now();
      stored.get();
      const storedTotalMs = performance.now() - begin;
      begin = performance.now();
      evictionOrder.all();
      const storedEvictionScanMs = performance.now() - begin;
      begin = performance.now();
      store.storageUsage();
      const storageUsageMs = performance.now() - begin;
      trials.push({ oldExactMs, storedTotalMs, storedEvictionScanMs, storageUsageMs });
    }

    // Re-persist the largest transcript through the store (images become bodies).
    const largest = db
      .prepare(
        `SELECT thread_id, agent_session_id, agent_id, slice_json FROM thread_snapshots ORDER BY slice_bytes DESC LIMIT 1`,
      )
      .get() as
      | { thread_id: string; agent_session_id: string; agent_id: string; slice_json: string }
      | undefined;
    let largestTranscript;
    if (largest) {
      const beforeBytes = Buffer.byteLength(largest.slice_json);
      const written = (await store.write({
        threadId: largest.thread_id,
        agentSessionId: largest.agent_session_id,
        agentId: largest.agent_id,
        slice: JSON.parse(largest.slice_json),
        payloads: new Map(),
      }))!;
      const read = db.prepare("SELECT slice_json FROM thread_snapshots WHERE thread_id=?");
      const restoreTrials = [];
      for (let i = 0; i < 5; i++) {
        begin = performance.now();
        const row = read.get(largest.thread_id) as { slice_json: string };
        const sqlReadMs = performance.now() - begin;
        begin = performance.now();
        const parsed = JSON.parse(row.slice_json);
        const parseMs = performance.now() - begin;
        begin = performance.now();
        const images = await store.loadImages(written, snapshotImageRefs(parsed));
        const imageLoadMs = performance.now() - begin;
        restoreTrials.push({ sqlReadMs, parseMs, imageLoadMs, images: images.size });
      }
      largestTranscript = {
        beforeBytes,
        afterBytes: Buffer.byteLength(
          (read.get(largest.thread_id) as { slice_json: string }).slice_json,
        ),
        bodyBytes: written.payloadBytes,
        restoreTrials,
        scope:
          "sqlReadMs + parseMs are on the paint path; imageLoadMs is asynchronous and after paint.",
      };
    }
    report.storedAccounting = {
      rows: trials.length ? (evictionOrder.all() as unknown[]).length : 0,
      exactTotalBytes: independent,
      migrationMs,
      backfillMs,
      trials,
      largestTranscript,
      scope:
        "Private backup of the provided database. Stored totals are verified equal to the old exact full-row sum before timing.",
    };
    store.dispose();
    db.close();
  },
  120000,
);
