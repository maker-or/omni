import { afterAll, describe, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  app: {
    getPath: () => process.env.PIPPER_LIBRARY_PATH ?? process.env.TMPDIR ?? "/tmp",
    connect: vi.fn(),
  },
}));

import { AgentConnectionManager } from "./agent-connection-manager.ts";
import { appendLocalUserMessage, createEmptySessionSlice } from "../src/lib/acp-session-reducer.ts";
import { SessionRetentionTracker } from "../src/lib/session-retention.ts";
import type { ThreadSessionRuntime } from "./thread-session-registry.ts";
import type { ThreadSnapshotStore } from "./thread-snapshot-store.ts";

const root = mkdtempSync(join(tmpdir(), "pipper-dispose-"));
process.env.PIPPER_LIBRARY_PATH = root;

afterAll(async () => {
  const { closeDb } = await import("./db.ts");
  closeDb();
  delete process.env.PIPPER_LIBRARY_PATH;
  rmSync(root, { recursive: true, force: true });
});

interface ManagerInternals {
  sessions: { register: (runtime: ThreadSessionRuntime) => void };
  snapshotStore: ThreadSnapshotStore;
  snapshotTimers: Map<string, ReturnType<typeof setTimeout>>;
  lifecycle: { terminateAll: () => Promise<void> };
  scheduleSnapshot: (runtime: ThreadSessionRuntime) => void;
}

function internals(manager: AgentConnectionManager): ManagerInternals {
  return manager as unknown as ManagerInternals;
}

/** A settled, resident thread with unsaved history: dispose must try to persist it. */
function seedDirtyRuntime(manager: AgentConnectionManager, threadId: string): ThreadSessionRuntime {
  const runtime: ThreadSessionRuntime = {
    threadId,
    agentSessionId: `${threadId}-session`,
    agentId: "pipper-mock",
    projectId: "project",
    cwd: root,
    slice: {
      ...appendLocalUserMessage(createEmptySessionSlice(), "unsaved", "unsaved"),
      isStreaming: false,
    },
    editorText: "",
    promptInFlight: false,
    activeTurnId: null,
    monitorUpdateCount: 0,
    toolPayloads: new Map(),
    retention: new SessionRetentionTracker(),
    emittedToolCalls: null,
    agentReady: true,
    pendingLocalEntries: [],
    payloadsReady: true,
    snapshotDirty: true,
    payloadRevision: 0,
  };
  internals(manager).sessions.register(runtime);
  return runtime;
}

describe("AgentConnectionManager.dispose", () => {
  test("a snapshot write that never settles cannot stop provider teardown", async () => {
    const manager = new AgentConnectionManager({
      sendToRenderer: () => {},
      setWindowTitle: () => {},
    });
    const { snapshotStore, lifecycle } = internals(manager);
    const write = vi.spyOn(snapshotStore, "write").mockReturnValue(new Promise(() => {}));
    const terminateAll = vi.spyOn(lifecycle, "terminateAll").mockResolvedValue();
    seedDirtyRuntime(manager, "stalled-thread");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const startedAt = Date.now();
    await manager.dispose({ snapshotFlushMs: 50 });

    expect(write).toHaveBeenCalledTimes(1);
    expect(terminateAll).toHaveBeenCalledTimes(1);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("did not finish within 50 ms"));
    warn.mockRestore();
  });

  test("flushes settled snapshots before terminating providers, then schedules no more writes", async () => {
    const manager = new AgentConnectionManager({
      sendToRenderer: () => {},
      setWindowTitle: () => {},
    });
    const order: string[] = [];
    const { snapshotStore, lifecycle } = internals(manager);
    vi.spyOn(snapshotStore, "write").mockImplementation(async (input) => {
      order.push(`write:${input.threadId}`);
      return null;
    });
    vi.spyOn(lifecycle, "terminateAll").mockImplementation(async () => {
      order.push("terminate");
    });
    const runtime = seedDirtyRuntime(manager, "flushed-thread");

    // Concurrent quit paths share one dispose.
    await Promise.all([manager.dispose(), manager.dispose()]);

    expect(order).toEqual(["write:flushed-thread", "terminate"]);
    internals(manager).scheduleSnapshot(runtime);
    expect(internals(manager).snapshotTimers.size).toBe(0);
  });
});
