import { afterAll, expect, test, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { createHighlighter } from "shiki";
import type { AcpToolCallState } from "../contracts/acp.ts";
import type { ThreadSessionRuntime } from "./thread-session-registry.ts";
import { createEmptySessionSlice } from "../src/lib/acp-session-reducer.ts";
import { highlightedCodeCache } from "../src/lib/highlight-cache.ts";

vi.mock("electron", () => ({
  app: { getPath: () => process.env.PIPPER_RESOURCE_USERDATA ?? process.env.TMPDIR ?? "/tmp" },
}));

import { ThreadSnapshotStore } from "./thread-snapshot-store.ts";
import { AgentConnectionManager } from "./agent-connection-manager.ts";
import { SubagentManager } from "./subagents/subagent-manager.ts";

const enabled = process.env.PIPPER_RESOURCE_BENCH === "1";
const measurements: Record<string, unknown> = {};
const root = enabled ? mkdtempSync(join(tmpdir(), "pipper-resource-bench-")) : null;

function memory() {
  if (!global.gc) throw new Error("Run the benchmark with --execArgv=--expose-gc");
  global.gc();
  return process.memoryUsage();
}

afterAll(() => {
  if (!enabled) return;
  if (process.env.PIPPER_RESOURCE_REPORT) {
    writeFileSync(
      process.env.PIPPER_RESOURCE_REPORT,
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          measurements,
        },
        null,
        2,
      ),
    );
  }
  if (root) rmSync(root, { recursive: true, force: true });
});

test.skipIf(!enabled)(
  "measure the production highlight cache using real repository source",
  async () => {
    const highlighter = await createHighlighter({
      langs: ["typescript"],
      themes: ["github-light", "github-dark"],
    });
    // Use actual source, split into 8 KiB code blocks as in long chat transcripts.
    // Freeze the input across before/after runs even when the implementation changes.
    const source = process.env.PIPPER_RESOURCE_FIXTURE
      ? readFileSync(process.env.PIPPER_RESOURCE_FIXTURE, "utf8")
      : execFileSync("git", ["show", "HEAD:electron/agent-connection-manager.ts"], {
          encoding: "utf8",
        });
    const before = memory();
    const started = performance.now();
    let generatedBytes = 0;
    for (let index = 0; index < 400; index++) {
      const offset = (index * 1021) % (source.length - 8192);
      const code = `// block ${index}\n${source.slice(offset, offset + 8192)}`;
      const html = highlighter.codeToHtml(code, {
        lang: "typescript",
        themes: { light: "github-light", dark: "github-dark" },
        defaultColor: false,
      });
      generatedBytes += Buffer.byteLength(html);
      highlightedCodeCache.set(`typescript\0${code}`, html);
    }
    const elapsedMs = performance.now() - started;
    const after = memory();
    measurements.highlightCache = {
      blocks: 400,
      sourceSha256: createHash("sha256").update(source).digest("hex"),
      generatedBytes,
      elapsedMs,
      before,
      after,
      retainedHeapBytes: after.heapUsed - before.heapUsed,
      entries: highlightedCodeCache.size,
    };
    expect(highlightedCodeCache.get("missing")).toBeUndefined();
    highlighter.dispose();
    highlightedCodeCache.clear();
  },
  120_000,
);

test.skipIf(!enabled)("measure completed subagent transcript retention", async () => {
  let session = 0;
  const manager = new SubagentManager({
    baseDir: root!,
    listAgents: () => [
      {
        id: "bench",
        name: "bench",
        displayName: "Bench",
        command: "bench",
        args: [],
        available: true,
      },
    ],
    host: {
      baseMcpServers: () => [],
      emitEvent: () => {},
      acquireConnection: async () => ({
        agentId: "bench",
        agentCapabilities: {},
        agent: {
          notify: async () => {},
          request: async (method, params) => {
            if (method === "session/new") return { sessionId: `sub-${session++}` };
            if (method === "session/prompt") {
              manager.handleSessionUpdate(params.sessionId, {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: randomBytes(384 * 1024).toString("base64") },
              });
              manager.handleSessionUpdate(params.sessionId, {
                sessionUpdate: "tool_call",
                toolCallId: "write",
                title: "Write",
                rawInput: { text: randomBytes(384 * 1024).toString("base64") },
              });
            }
            return {};
          },
        },
      }),
    },
  });
  const internal = manager as any;
  // Avoid starting an MCP listener; exercise the real run lifecycle with a
  // scripted ACP transport and maxDepth=1 (children get no nested MCP tool).
  internal.tokens.set("bench", { sessionId: "parent", cwd: root!, depth: 0 });
  internal.config.maxDepth = 1;
  const before = memory();
  for (let index = 0; index < 24; index++) {
    expect(
      (await internal.runSubagent("bench", { agent_id: "bench", task: "memory workload" })).length,
    ).toBe(512 * 1024);
  }
  const after = memory();
  measurements.completedSubagents = {
    runs: 24,
    before,
    after,
    retainedHeapBytes: after.heapUsed - before.heapUsed,
  };
  manager.dispose();
});

test.skipIf(!enabled)(
  "measure snapshot disk budget using real SQLite rows and gzip sidecars",
  async () => {
    const path = join(root!, "snapshots.sqlite");
    const database = new DatabaseSync(path);
    database.exec(`CREATE TABLE thread_snapshots (
    thread_id TEXT PRIMARY KEY, schema_version INTEGER, agent_session_id TEXT,
    agent_id TEXT, entry_count INTEGER, slice_json TEXT, payload_path TEXT,
    payload_bytes INTEGER, created_at INTEGER, updated_at INTEGER
  )`);
    const store = new ThreadSnapshotStore({
      rootPath: join(root!, "disk-payloads"),
      database,
      maxPayloadBytes: 64 * 1024,
    });
    for (let index = 0; index < 24; index++) {
      const id = `disk-${index}`;
      await store.write({
        threadId: id,
        agentSessionId: id,
        agentId: "bench",
        slice: createEmptySessionSlice({
          entries: [
            {
              type: "agent_text",
              id,
              messageId: null,
              text: randomBytes(24 * 1024).toString("base64"),
            },
          ],
        }),
        payloads: new Map(),
      });
    }
    const row = database
      .prepare(
        "SELECT COUNT(*) AS rows, SUM(length(CAST(slice_json AS BLOB)) + payload_bytes) AS bytes FROM thread_snapshots",
      )
      .get();
    database.close();
    const files = [
      path,
      ...readdirSync(join(root!, "disk-payloads")).map((name) =>
        join(root!, "disk-payloads", name),
      ),
    ];
    measurements.snapshotDisk = {
      threads: 24,
      budgetBytes: 64 * 1024,
      retained: row,
      logicalBytes: files.reduce((sum, file) => sum + statSync(file).size, 0),
      allocatedBytes: files.reduce((sum, file) => sum + statSync(file).blocks * 512, 0),
    };
  },
);

test.skipIf(!enabled)(
  "measure main-process retention after hydrating twelve persisted sessions",
  async () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`CREATE TABLE thread_snapshots (
    thread_id TEXT PRIMARY KEY, schema_version INTEGER, agent_session_id TEXT,
    agent_id TEXT, entry_count INTEGER, slice_json TEXT, payload_path TEXT,
    payload_bytes INTEGER, created_at INTEGER, updated_at INTEGER
  )`);
    const store = new ThreadSnapshotStore({ rootPath: root!, database, maxMemoryEntries: 0 });
    const manager = new AgentConnectionManager({
      sendToRenderer: () => {},
      setWindowTitle: () => {},
    });
    const internal = manager as unknown as {
      sessions: {
        register: (runtime: ThreadSessionRuntime) => void;
        values: () => Iterable<ThreadSessionRuntime>;
      };
      snapshotStore: ThreadSnapshotStore;
    };
    internal.snapshotStore = store;
    for (let index = 0; index < 12; index++) {
      const threadId = `thread-${index}`;
      const toolCalls: Record<string, AcpToolCallState> = {
        read: { toolCallId: "read", title: "Read file", hasPayload: true },
      };
      const slice = createEmptySessionSlice({ toolCalls });
      const snapshot = await store.write({
        threadId,
        agentSessionId: threadId,
        agentId: "bench",
        slice,
        payloads: new Map([["read", { rawOutput: randomBytes(1024 * 1024).toString("base64") }]]),
      });
      internal.sessions.register({
        threadId,
        agentSessionId: threadId,
        agentId: "bench",
        projectId: "bench",
        cwd: root!,
        slice,
        editorText: "",
        promptInFlight: false,
        activeTurnId: null,
        monitorUpdateCount: 0,
        emittedToolCalls: null,
        snapshotPayloadSource: snapshot!,
      });
    }
    const before = memory();
    const started = performance.now();
    for (let index = 0; index < 12; index++) {
      const calls = await manager.getToolCalls(`thread-${index}`, ["read"]);
      expect(typeof calls.read?.rawOutput).toBe("string");
    }
    const after = memory();
    const parkedPayloads = [...internal.sessions.values()].reduce(
      (sum, runtime) => sum + (runtime.toolPayloads?.size ?? 0),
      0,
    );
    measurements.payloadHydration = {
      sessions: 12,
      elapsedMs: performance.now() - started,
      before,
      after,
      retainedHeapBytes: after.heapUsed - before.heapUsed,
      parkedPayloads,
    };
    database.close();
  },
  120_000,
);
