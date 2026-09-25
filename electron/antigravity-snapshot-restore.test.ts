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
import { readOpenTabsState } from "./open-tabs.ts";
import { ActivationSupersededError } from "./activation.ts";
import { appendLocalUserMessage, createEmptySessionSlice } from "../src/lib/acp-session-reducer.ts";
import { SessionRetentionTracker } from "../src/lib/session-retention.ts";
import type { ThreadSessionRuntime } from "./thread-session-registry.ts";
import type { LiveConnection } from "./connection-lifecycle.ts";
import type { AcpBridgeEvent } from "../contracts/acp.ts";
import type { Thread } from "../contracts/threads.ts";
import type { SessionUpdate } from "@agentclientprotocol/sdk";

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
    // A restored snapshot is settled history, not an in-flight turn.
    slice: {
      ...appendLocalUserMessage(createEmptySessionSlice(), "saved history", "saved"),
      isStreaming: false,
    },
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
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({ type: "user_text", text: "saved history" });
    const published = events.filter((event) => event.type === "session-state").at(-1);
    expect(
      published?.type === "session-state" ? published.state.entries[0] : undefined,
    ).toMatchObject({ text: "saved history" });
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
    expect(manager.getState().entries[0]).toMatchObject({
      type: "user_text",
      text: "saved history",
    });
    // The fallback still reconciles the open tab that switchThreadCore would
    // have recorded, so a project with no prior tab shows this thread's tab.
    expect((await readOpenTabsState()).openThreadIds).toContain(thread.id);
  });

  test("late replay updates do not alter the preserved transcript", async () => {
    const project = createProject({
      name: "late-replay",
      path: join(root, "late-replay"),
      icon: "folder",
    });
    const thread = createThread(project.id, "Late", "antigravity-acp", "pipper-agy-late");
    const { manager } = makeManager();
    const runtime = seedSnapshotRuntime(manager, thread, project.id);
    stubAgentSwitch(manager, "antigravity-acp");
    await expect(manager.switchThread(thread.id)).rejects.toThrow("earlier CLI bridge");

    // The abandoned session/load can keep streaming under the same session id;
    // those updates must not be written into the restored saved history.
    await (
      manager as unknown as {
        handleSessionUpdate: (sessionId: string, update: SessionUpdate) => Promise<void>;
      }
    ).handleSessionUpdate(thread.agent_session_id, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "late replay" },
    } as SessionUpdate);

    expect(runtime.slice.entries).toHaveLength(1);
    expect(runtime.slice.entries[0]).toMatchObject({ text: "saved history" });
  });

  test("a prompt on a snapshot-only thread is rejected without a phantom message", async () => {
    const project = createProject({ name: "prompt", path: join(root, "prompt"), icon: "folder" });
    const thread = createThread(project.id, "Prompt", "antigravity-acp", "pipper-agy-prompt");
    const { manager } = makeManager();
    const runtime = seedSnapshotRuntime(manager, thread, project.id);
    stubAgentSwitch(manager, "antigravity-acp");
    await expect(manager.switchThread(thread.id)).rejects.toThrow("earlier CLI bridge");

    await expect(manager.sendPrompt({ threadId: thread.id, message: "hello" })).rejects.toThrow(
      "not ready",
    );
    expect(runtime.slice.entries).toHaveLength(1);
    expect(runtime.slice.entries[0]).toMatchObject({ text: "saved history" });
    expect(runtime.slice.isStreaming).toBe(false);
  });

  test("a superseded project activation is not reported as a snapshot-only launch", async () => {
    const project = createProject({
      name: "superseded",
      path: join(root, "superseded"),
      icon: "folder",
    });
    const thread = createThread(project.id, "Superseded", "antigravity-acp", "pipper-agy-super");
    const { manager } = makeManager();
    seedSnapshotRuntime(manager, thread, project.id);
    vi.spyOn(
      manager as unknown as { switchThreadInternal: (...args: unknown[]) => Promise<unknown> },
      "switchThreadInternal",
    ).mockRejectedValue(new ActivationSupersededError());

    await expect(manager.activateProject(project.id, thread.id)).rejects.toBeInstanceOf(
      ActivationSupersededError,
    );
  });

  test("pending local entries are dropped when an in-progress load fails", () => {
    const project = createProject({
      name: "pending",
      path: join(root, "pending"),
      icon: "folder",
    });
    const thread = createThread(project.id, "Pending", "antigravity-acp", "pipper-agy-pending");
    const { manager } = makeManager();
    const runtime = seedSnapshotRuntime(manager, thread, project.id);
    const optimistic = appendLocalUserMessage(runtime.slice, "queued while loading", "pending");
    runtime.slice = optimistic;
    runtime.pendingLocalEntries = [optimistic.entries.at(-1)!];
    const internal = manager as unknown as {
      loadingSessionThreads: Set<string>;
      preserveSnapshotRuntimeAfterFailure: (
        threadId: string,
        runtime: ThreadSessionRuntime,
      ) => boolean;
    };
    internal.loadingSessionThreads.add(thread.id);

    expect(internal.preserveSnapshotRuntimeAfterFailure(thread.id, runtime)).toBe(true);
    expect(runtime.slice.entries).toHaveLength(1);
    expect(runtime.slice.entries[0]).toMatchObject({ text: "saved history" });
    expect(runtime.slice.isStreaming).toBe(false);
    expect(runtime.pendingLocalEntries).toEqual([]);
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
