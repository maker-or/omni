import { afterAll, describe, expect, test, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  app: {
    getPath: () => process.env.PIPPER_LIBRARY_PATH ?? process.env.TMPDIR ?? "/tmp",
    connect: vi.fn(),
  },
}));

import { AgentConnectionManager } from "./agent-connection-manager.ts";
import { getLaunchStateIoStats, readLaunchState } from "./launch-state.ts";
import { createProject } from "./projects.ts";
import { createThread } from "./threads.ts";
import { createEmptySessionSlice } from "../src/lib/acp-session-reducer.ts";
import { SessionRetentionTracker } from "../src/lib/session-retention.ts";
import type { ThreadSessionRuntime } from "./thread-session-registry.ts";
import type { LiveConnection } from "./connection-lifecycle.ts";
import type { Thread } from "../contracts/threads.ts";

// One library root for the file: db.ts caches its handle on first use.
const root = mkdtempSync(join(tmpdir(), "pipper-navigation-"));
process.env.PIPPER_LIBRARY_PATH = root;

afterAll(async () => {
  const { closeDb } = await import("./db.ts");
  closeDb();
  delete process.env.PIPPER_LIBRARY_PATH;
  rmSync(root, { recursive: true, force: true });
});

const AGENT_ID = "pipper-mock";

function residentManager(threads: Thread[], cwd: string): AgentConnectionManager {
  const manager = new AgentConnectionManager({
    sendToRenderer: () => {},
    setWindowTitle: () => {},
  });
  const internals = manager as unknown as {
    lifecycle: { setActive: (live: LiveConnection) => void };
    sessions: { register: (runtime: ThreadSessionRuntime) => void };
  };
  internals.lifecycle.setActive({ agentId: AGENT_ID } as LiveConnection);
  for (const thread of threads) {
    internals.sessions.register({
      threadId: thread.id,
      agentSessionId: thread.agent_session_id,
      agentId: AGENT_ID,
      projectId: thread.project_id,
      cwd,
      slice: { ...createEmptySessionSlice(), isStreaming: false },
      editorText: "",
      promptInFlight: false,
      activeTurnId: null,
      monitorUpdateCount: 0,
      toolPayloads: new Map(),
      retention: new SessionRetentionTracker(),
      emittedToolCalls: null,
      agentReady: true,
      snapshotRestored: false,
      payloadsReady: true,
      snapshotDirty: false,
      payloadRevision: 0,
    });
  }
  return manager;
}

describe("navigation commit", () => {
  test("each resident switch performs one launch-state write and no disk reads", async () => {
    const projectPath = join(root, "repo");
    mkdirSync(projectPath, { recursive: true });
    const project = createProject({ name: "nav", path: projectPath, icon: "folder" });
    const threads = Array.from({ length: 3 }, (_, index) =>
      createThread(project.id, `T${index}`, AGENT_ID, `session-${index}`),
    );
    const manager = residentManager(threads, projectPath);

    // Warm-up: the first activation loads the mirror from disk.
    await manager.switchThread(threads[0]!.id);
    const before = getLaunchStateIoStats();

    const order = [1, 2, 0, 1, 2, 0, 1, 2, 0, 1].map((index) => threads[index]!.id);
    for (const threadId of order) await manager.switchThread(threadId);

    const after = getLaunchStateIoStats();
    expect(after.diskWrites - before.diskWrites).toBe(order.length);
    expect(after.diskReads - before.diskReads).toBe(0);

    const committed = await readLaunchState();
    expect(committed).toMatchObject({
      projectId: project.id,
      threadId: threads[1]!.id,
      activeThreadId: threads[1]!.id,
      selectedWorktreePathByProject: { [project.id]: projectPath },
    });
    expect(committed.openThreadIds).toHaveLength(3);
    expect(committed.threadSwitchHistory.slice(0, 3)).toEqual([
      threads[1]!.id,
      threads[0]!.id,
      threads[2]!.id,
    ]);

    // Re-activating the thread that is already active changes nothing on disk.
    await manager.switchThread(threads[1]!.id);
    expect(getLaunchStateIoStats().diskWrites).toBe(after.diskWrites);

    // A restart restores the same committed revision and fields.
    vi.resetModules();
    const restarted = await import("./launch-state.ts");
    expect(await restarted.readLaunchState()).toEqual(committed);
  });
});
