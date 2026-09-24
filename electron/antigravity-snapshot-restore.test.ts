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
import { createProject } from "./projects.ts";
import { createThread } from "./threads.ts";
import { appendLocalUserMessage, createEmptySessionSlice } from "../src/lib/acp-session-reducer.ts";
import { SessionRetentionTracker } from "../src/lib/session-retention.ts";
import type { ThreadSessionRuntime } from "./thread-session-registry.ts";
import type { LiveConnection } from "./connection-lifecycle.ts";
import type { AcpBridgeEvent } from "../contracts/acp.ts";
import type { Thread } from "../contracts/threads.ts";

// One library root for the file: db.ts caches its handle on first use, so the
// sqlite file must outlive every test here.
const root = mkdtempSync(join(tmpdir(), "pipper-agy-restore-"));
process.env.PIPPER_LIBRARY_PATH = root;

afterAll(async () => {
  const { closeDb } = await import("./db.ts");
  closeDb();
  delete process.env.PIPPER_LIBRARY_PATH;
  rmSync(root, { recursive: true, force: true });
});

function makeManager() {
  const events: AcpBridgeEvent[] = [];
  const manager = new AgentConnectionManager({
    sendToRenderer: (event: AcpBridgeEvent) => events.push(event),
    setWindowTitle: () => {},
  });
  return { manager, events };
}

function seedSnapshotRuntime(
  manager: AgentConnectionManager,
  thread: Thread,
  projectId: string,
): ThreadSessionRuntime {
  const runtime: ThreadSessionRuntime = {
    threadId: thread.id,
    agentSessionId: thread.agent_session_id,
    agentId: thread.agent_id,
    projectId,
    cwd: root,
    slice: appendLocalUserMessage(createEmptySessionSlice(), "saved history", "saved"),
    editorText: "",
    promptInFlight: false,
    activeTurnId: null,
    monitorUpdateCount: 0,
    toolPayloads: new Map(),
    retention: new SessionRetentionTracker(),
    emittedToolCalls: null,
    agentReady: false,
    snapshotRestored: true,
    replaySlice: createEmptySessionSlice(),
    replayToolPayloads: new Map(),
    pendingLocalEntries: [],
    payloadsReady: true,
    snapshotDirty: false,
    payloadRevision: 0,
  };
  (
    manager as unknown as { sessions: { register: (runtime: ThreadSessionRuntime) => void } }
  ).sessions.register(runtime);
  return runtime;
}

function sessionsOf(manager: AgentConnectionManager) {
  return (
    manager as unknown as {
      sessions: { get: (threadId: string) => ThreadSessionRuntime | undefined };
    }
  ).sessions;
}

/** Make `switchAgent` succeed with a live connection the manager considers active. */
function stubAgentSwitch(manager: AgentConnectionManager, agentId: string): LiveConnection {
  const live = { agentId } as LiveConnection;
  vi.spyOn(manager, "switchAgent").mockImplementation(async () => {
    (
      manager as unknown as { lifecycle: { setActive: (live: LiveConnection) => void } }
    ).lifecycle.setActive(live);
    return live;
  });
  return live;
}

describe("Antigravity snapshot-restored threads", () => {
  test("a legacy CLI-bridge thread keeps its restored transcript when the session cannot be resumed", async () => {
    const project = createProject({ name: "legacy", path: join(root, "legacy"), icon: "folder" });
    const thread = createThread(project.id, "Legacy", "antigravity-acp", "pipper-agy-old");
    const { manager, events } = makeManager();
    const runtime = seedSnapshotRuntime(manager, thread, project.id);
    stubAgentSwitch(manager, "antigravity-acp");

    await expect(manager.switchThread(thread.id)).rejects.toThrow("earlier CLI bridge");

    // The runtime survives with its snapshot; the partial replay buffer is
    // dropped so a retry cannot append onto half a timeline.
    expect(sessionsOf(manager).get(thread.id)).toBe(runtime);
    expect(runtime.agentReady).toBe(false);
    expect(runtime.replaySlice).toBeUndefined();
    const state = manager.getState();
    expect(state.threadId).toBe(thread.id);
    expect(state.entries.map((entry) => entry.text)).toEqual(["saved history"]);
    const published = events.filter((event) => event.type === "session-state").at(-1);
    expect(
      published?.type === "session-state" ? published.state.entries.map((entry) => entry.text) : [],
    ).toEqual(["saved history"]);
  });

  test("project launch opens a legacy Antigravity thread snapshot-only instead of failing", async () => {
    const project = createProject({
      name: "legacy-launch",
      path: join(root, "legacy-launch"),
      icon: "folder",
    });
    const thread = createThread(project.id, "Legacy", "antigravity-acp", "pipper-agy-older");
    const { manager } = makeManager();
    seedSnapshotRuntime(manager, thread, project.id);
    stubAgentSwitch(manager, "antigravity-acp");

    // launch:complete awaits activateProject; a snapshot-only thread must not
    // reject it or the main window never gets created.
    await expect(manager.activateProject(project.id, thread.id)).resolves.toBeUndefined();
    expect(manager.getState().entries.map((entry) => entry.text)).toEqual(["saved history"]);
  });

  test("a runtime without a restored snapshot is still evicted when its agent cannot start", async () => {
    const project = createProject({ name: "dead", path: join(root, "dead"), icon: "folder" });
    const thread = createThread(project.id, "Dead", "codex-acp", "codex-session");
    const { manager } = makeManager();
    const runtime = seedSnapshotRuntime(manager, thread, project.id);
    runtime.agentId = "codex-acp";
    runtime.snapshotRestored = false;
    vi.spyOn(manager, "switchAgent").mockRejectedValue(new Error("agent unavailable"));
    vi.spyOn(
      manager as unknown as { ensureConnection: (agentId: string) => Promise<LiveConnection> },
      "ensureConnection",
    ).mockRejectedValue(new Error("no fallback"));

    await expect(manager.switchThread(thread.id)).rejects.toThrow();
    expect(sessionsOf(manager).get(thread.id)).toBeUndefined();
  });
});
