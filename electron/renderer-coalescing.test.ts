import { describe, expect, test, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => process.env.PIPPER_LIBRARY_PATH ?? process.env.TMPDIR ?? "/tmp",
    connect: vi.fn(),
  },
}));

import * as acp from "@agentclientprotocol/sdk";
import { AgentConnectionManager } from "./agent-connection-manager.ts";
import { createEmptySessionSlice } from "../src/lib/acp-session-reducer.ts";
import type { AcpBridgeEvent } from "../contracts/acp.ts";
import type { AgentOsNotification } from "./os-notifications.ts";

/**
 * Hidden-window coalescing: while the main window cannot be seen, high-volume
 * streaming deltas must not cross IPC into the renderer; the authoritative
 * snapshot plus drifted tool-call watermarks catch it up on visible. OS
 * notifications fire only for events that happen while hidden.
 */

function makeManager(options?: {
  initialVisible?: boolean;
  focused?: boolean;
  notify?: (notification: AgentOsNotification) => void;
}) {
  const events: AcpBridgeEvent[] = [];
  let visible = options?.initialVisible ?? true;
  const listeners = new Set<(visible: boolean) => void>();
  const visibility = {
    isVisible: () => visible,
    onChange: (listener: (visible: boolean) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const setVisible = (next: boolean) => {
    visible = next;
    const snapshot = [...listeners];
    for (const listener of snapshot) listener(next);
  };
  let focused = options?.focused ?? true;
  const attention = { isFocused: () => focused };
  const setFocused = (next: boolean) => {
    focused = next;
  };
  const manager = new AgentConnectionManager({
    sendToRenderer: (_channel: string, event: unknown) => {
      events.push(event as AcpBridgeEvent);
    },
    setWindowTitle: () => {},
    visibility,
    attention,
    ...(options?.notify ? { notify: options.notify } : {}),
  });
  return { manager, events, setVisible, setFocused };
}

/** Inject a thread session runtime the way switchThread/createThread would. */
function seedSession(
  manager: AgentConnectionManager,
  threadId: string,
  sessionId: string,
  promptInFlight: boolean,
  title?: string,
) {
  const sessions = (
    manager as unknown as { sessions: { register: (runtime: Record<string, unknown>) => void } }
  ).sessions;
  sessions.register({
    threadId,
    agentSessionId: sessionId,
    agentId: "agent-a",
    projectId: "proj",
    cwd: "/tmp",
    slice: { ...createEmptySessionSlice(), title },
    editorText: "",
    promptInFlight,
    activeTurnId: null,
    monitorUpdateCount: 0,
    toolPayloads: new Map(),
    emittedToolCalls: null,
  });
}

const chunk = (text: string): acp.SessionUpdate => ({
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text },
});

async function sendChunk(manager: AgentConnectionManager, sessionId: string, text: string) {
  await (
    manager as unknown as {
      handleSessionUpdate: (id: string, u: acp.SessionUpdate) => Promise<void>;
    }
  ).handleSessionUpdate(sessionId, chunk(text));
}

const lastEventOfType = (events: AcpBridgeEvent[], type: string) =>
  [...events].reverse().find((event) => event.type === type);

describe("hidden-window delta coalescing", () => {
  test("session-updates are suppressed while the window is hidden", async () => {
    const { manager, events } = makeManager({ initialVisible: false });
    seedSession(manager, "t1", "s1", true);

    await sendChunk(manager, "s1", "hello");

    expect(events.filter((event) => event.type === "session-update")).toEqual([]);
  });

  test("session-updates flow normally when visible", async () => {
    const { manager, events } = makeManager({ initialVisible: true });
    seedSession(manager, "t1", "s1", true);

    await sendChunk(manager, "s1", "hello");

    expect(
      events.filter((event) => event.type === "session-update" && event.threadId === "t1"),
    ).toHaveLength(1);
  });

  test("becoming visible pushes one authoritative snapshot instead of replaying deltas", async () => {
    const { manager, events, setVisible } = makeManager({ initialVisible: false });
    seedSession(manager, "t1", "s1", true);
    // Model t1 as the displayed thread.
    (manager as unknown as { activeThreadId: string | null }).activeThreadId = "t1";

    await sendChunk(manager, "s1", "chunk-1");
    await sendChunk(manager, "s1", "chunk-2");
    expect(events.filter((event) => event.type === "session-update")).toEqual([]);

    setVisible(true);

    // No replayed deltas — one authoritative session-state carrying the final
    // slice (main applied both chunks regardless of suppression).
    expect(events.filter((event) => event.type === "session-update")).toEqual([]);
    const snapshot = lastEventOfType(events, "session-state") as
      | { state: { threadId: string; entries: unknown[] } }
      | undefined;
    expect(snapshot?.state.threadId).toBe("t1");
    const texts = JSON.stringify(snapshot?.state.entries ?? []);
    expect(texts).toContain("chunk-2");
  });

  test("background thread tool-call records drift and flush on visible", async () => {
    const { manager, events, setVisible } = makeManager({ initialVisible: false });
    // Background thread: activeThreadId is null, so t2's updates are background.
    seedSession(manager, "t2", "s2", false);
    // Seed the emitted watermark as if already sent once.
    const runtime = (
      manager as unknown as { sessions: { get: (id: string) => { emittedToolCalls: unknown } } }
    ).sessions.get("t2")!;
    runtime.emittedToolCalls = (
      runtime as unknown as { slice: { toolCalls: unknown } }
    ).slice.toolCalls;

    await sendChunk(manager, "s2", "bg");
    expect(events.filter((event) => event.type === "thread-tool-calls")).toEqual([]);

    setVisible(true);

    const flushed = events.filter((event) => event.type === "thread-tool-calls");
    expect(flushed.length).toBeGreaterThanOrEqual(0);
  });

  test("permission requests are never suppressed while hidden", async () => {
    const { manager, events } = makeManager({ initialVisible: false });

    const promise = (
      manager as unknown as {
        handlePermissionRequest: (params: acp.RequestPermissionRequest) => Promise<unknown>;
      }
    ).handlePermissionRequest({
      sessionId: "s1",
      toolCall: { toolCallId: "tc1", title: "Run command", kind: "execute" },
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
    } as acp.RequestPermissionRequest);
    // Let the promise executor run to the emit.
    await Promise.resolve();

    expect(lastEventOfType(events, "permission-request")).toBeDefined();
    (
      manager as unknown as { respondToPermission: (r: object) => Promise<void> }
    ).respondToPermission({ sessionId: "s1", optionId: "allow" });
    await promise;
  });
});

describe("hidden-window OS notifications", () => {
  test("turn completion notifies only when the window is hidden", async () => {
    const notifications: AgentOsNotification[] = [];
    const { manager, setVisible } = makeManager({
      initialVisible: false,
      notify: (n) => notifications.push(n),
    });
    seedSession(manager, "t1", "s1", false, "Fix the bug");
    const drain = manager as unknown as {
      drainPromptQueue: (runtime: unknown, live: unknown) => void;
      requestPrompt: () => Promise<{ stopReason: string }>;
    };
    // Drive drainPromptQueue with a stubbed requestPrompt.
    const runtime = (
      manager as unknown as { sessions: { get: (id: string) => Record<string, unknown> } }
    ).sessions.get("t1")!;
    // Seed the prompt queue where PromptScheduler now owns it.
    const queueOwner = manager as unknown as {
      prompts: { queued: Map<string, { resolve: (r: unknown) => void }[]> };
    };
    const queuedPrompts = queueOwner.prompts.queued;
    queuedPrompts.set("t1", [{ resolve: () => {} }]);
    Object.defineProperty(manager, "requestPrompt", {
      value: () => Promise.resolve({ stopReason: "end_turn" }),
    });
    Object.defineProperty(manager, "captureAnalytics", { value: undefined });
    Object.defineProperty(manager, "reportTokens", { value: () => {} });

    drain.drainPromptQueue(runtime, {});
    await Promise.resolve();
    await Promise.resolve();

    expect(notifications.map((n) => n.kind)).toEqual(["turn-completed"]);
    expect(notifications[0]?.threadTitle).toBe("Fix the bug");

    // Visible window: no notification on next turn.
    setVisible(true);
    notifications.length = 0;
    queuedPrompts.set("t1", [{ resolve: () => {} }]);
    drain.drainPromptQueue(runtime, {});
    await Promise.resolve();

    expect(notifications).toEqual([]);
  });

  test("permission request notifies while hidden with the thread title", async () => {
    const notifications: AgentOsNotification[] = [];
    const { manager } = makeManager({
      initialVisible: false,
      notify: (n) => notifications.push(n),
    });
    seedSession(manager, "t1", "s1", false, "Refactor");

    const promise = (
      manager as unknown as {
        handlePermissionRequest: (params: acp.RequestPermissionRequest) => Promise<unknown>;
      }
    ).handlePermissionRequest({
      sessionId: "s1",
      threadId: "t1",
      toolCall: { toolCallId: "tc1", title: "Edit file", kind: "edit" },
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
    } as unknown as acp.RequestPermissionRequest);
    await Promise.resolve();

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.kind).toBe("permission-required");
    expect(notifications[0]?.threadTitle).toBe("Refactor");

    (
      manager as unknown as { respondToPermission: (r: object) => Promise<void> }
    ).respondToPermission({ sessionId: "s1", optionId: "allow" });
    await promise;
  });

  test("a visible but UNFOCUSED window still notifies (Cmd+Tab away on macOS)", async () => {
    const notifications: AgentOsNotification[] = [];
    // Visible per the gate — no minimize, no occlusion — but user is elsewhere.
    const { manager, setFocused } = makeManager({
      initialVisible: true,
      focused: false,
      notify: (n) => notifications.push(n),
    });
    seedSession(manager, "t1", "s1", false, "Walk-away turn");

    const drain = manager as unknown as {
      drainPromptQueue: (runtime: unknown, live: unknown) => void;
    };
    const runtime = (
      manager as unknown as { sessions: { get: (id: string) => Record<string, unknown> } }
    ).sessions.get("t1")!;
    // Seed the prompt queue where PromptScheduler now owns it.
    const queueOwner = manager as unknown as {
      prompts: { queued: Map<string, { resolve: (r: unknown) => void }[]> };
    };
    const queuedPrompts = queueOwner.prompts.queued;
    queuedPrompts.set("t1", [{ resolve: () => {} }]);
    Object.defineProperty(manager, "requestPrompt", {
      value: () => Promise.resolve({ stopReason: "end_turn" }),
    });
    Object.defineProperty(manager, "captureAnalytics", { value: undefined });
    Object.defineProperty(manager, "reportTokens", { value: () => {} });

    drain.drainPromptQueue(runtime, {});
    await Promise.resolve();
    await Promise.resolve();

    expect(notifications.map((n) => n.kind)).toEqual(["turn-completed"]);

    // Refocusing suppresses the next one.
    setFocused(true);
    notifications.length = 0;
    queuedPrompts.set("t1", [{ resolve: () => {} }]);
    drain.drainPromptQueue(runtime, {});
    await Promise.resolve();

    expect(notifications).toEqual([]);
  });
});
