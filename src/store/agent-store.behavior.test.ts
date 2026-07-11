import { afterEach, describe, expect, test, vi } from "vitest";
import type { AcpBridgeEvent, AcpSessionState } from "../../contracts/acp.ts";

function sessionState(threadId: string, patch: Partial<AcpSessionState> = {}): AcpSessionState {
  return {
    projectId: "project-1",
    threadId,
    agentId: "pipper-mock",
    agentSessionId: `session-${threadId}`,
    cwd: "/tmp/project",
    title: null,
    configOptions: [],
    commands: [],
    entries: [],
    toolCalls: {},
    plan: null,
    usage: null,
    currentModeId: null,
    isStreaming: false,
    isCompacting: false,
    editorText: "",
    authRequiredMessage: null,
    switchingAgent: false,
    ...patch,
  };
}

async function loadStore() {
  vi.resetModules();
  const mod = await import("./agent-store.ts");
  mod.useAgentStore.setState({
    state: null,
    snapshot: null,
    uiRequest: null,
    permissionRequest: null,
    isConnecting: false,
    error: null,
  });
  return mod.useAgentStore;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.resetModules();
});

describe("agent store ACP bridge behavior", () => {
  test("keeps permission UI responsive while a thread switch is pending", async () => {
    let bridgeHandler: ((payload: AcpBridgeEvent) => void) | null = null;
    let currentState = sessionState("thread-a");
    let resolveSwitch: (() => void) | null = null;
    const switchGate = new Promise<void>((resolve) => {
      resolveSwitch = resolve;
    });
    const agentApi = {
      onEvent: vi.fn((handler: (payload: AcpBridgeEvent) => void) => {
        bridgeHandler = handler;
        return vi.fn();
      }),
      getState: vi.fn(async () => currentState),
      getCapabilities: vi.fn(async () => ({
        promptCapabilities: { image: true, embeddedContext: true },
      })),
      switchThread: vi.fn(async () => switchGate),
      respondToPermission: vi.fn(async () => {}),
      sendPrompt: vi.fn(async () => {}),
      replacePrompt: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
      createThread: vi.fn(),
      setConfigOption: vi.fn(),
      setEditorText: vi.fn(),
      pasteToEditor: vi.fn(),
      reportEditorText: vi.fn(),
    };
    (globalThis as any).window = { omni: { agent: agentApi } };

    const store = await loadStore();
    await store.getState().connect();

    const switching = store.getState().switchThread("thread-b");
    await vi.waitFor(() => expect(agentApi.switchThread).toHaveBeenCalledWith("thread-b"));

    // Stale session-update for old thread is ignored during pending switch
    bridgeHandler?.({
      type: "session-update",
      sessionId: "session-thread-a",
      threadId: "thread-a",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "stale",
        content: { type: "text", text: "noise" },
      },
    });
    expect(
      store.getState().state?.entries.some((e) => e.type === "agent_text" && e.text === "noise"),
    ).toBeFalsy();

    bridgeHandler?.({
      type: "permission-request",
      request: {
        sessionId: "session-thread-a",
        toolCall: { toolCallId: "t1", title: "Edit file" },
        options: [
          { optionId: "allow", name: "Allow once", kind: "allow_once" },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
      },
    });
    expect(store.getState().uiRequest?.sessionId).toBe("session-thread-a");
    expect(store.getState().permissionRequest?.sessionId).toBe("session-thread-a");

    bridgeHandler?.({ type: "permission-resolved", sessionId: "session-thread-a" });
    expect(store.getState().uiRequest).toBeNull();

    currentState = sessionState("thread-b", {
      entries: [{ type: "user_text", id: "m1", messageId: null, text: "hi" }],
    });
    resolveSwitch?.();
    await switching;

    expect(store.getState().state?.threadId).toBe("thread-b");
    expect(store.getState().snapshot?.threadId).toBe("thread-b");
    expect(store.getState().error).toBeNull();
  });

  test("ignores stale session-state while waiting for the requested thread", async () => {
    let bridgeHandler: ((payload: AcpBridgeEvent) => void) | null = null;
    let currentState = sessionState("thread-a");
    let resolveSwitch: (() => void) | null = null;
    const switchGate = new Promise<void>((resolve) => {
      resolveSwitch = resolve;
    });
    const agentApi = {
      onEvent: vi.fn((handler: (payload: AcpBridgeEvent) => void) => {
        bridgeHandler = handler;
        return vi.fn();
      }),
      getState: vi.fn(async () => currentState),
      getCapabilities: vi.fn(async () => null),
      switchThread: vi.fn(async () => switchGate),
      respondToPermission: vi.fn(),
      sendPrompt: vi.fn(),
      replacePrompt: vi.fn(),
      abort: vi.fn(),
      createThread: vi.fn(),
      setConfigOption: vi.fn(),
      setEditorText: vi.fn(),
      pasteToEditor: vi.fn(),
      reportEditorText: vi.fn(),
    };
    (globalThis as any).window = { omni: { agent: agentApi } };

    const store = await loadStore();
    await store.getState().connect();

    const switching = store.getState().switchThread("thread-b");
    await vi.waitFor(() => expect(agentApi.switchThread).toHaveBeenCalledWith("thread-b"));

    bridgeHandler?.({
      type: "session-state",
      state: sessionState("thread-a", { title: "stale" }),
    });
    expect(store.getState().state?.title).toBeNull();

    bridgeHandler?.({
      type: "session-state",
      state: sessionState("thread-b", { title: "fresh" }),
    });
    expect(store.getState().state?.threadId).toBe("thread-b");
    expect(store.getState().state?.title).toBe("fresh");

    currentState = sessionState("thread-b", { title: "fresh" });
    resolveSwitch?.();
    await switching;
  });

  test("tracks which threads are running across open tabs", async () => {
    let bridgeHandler: ((payload: AcpBridgeEvent) => void) | null = null;
    let resolveSwitch: (() => void) | null = null;
    const switchGate = new Promise<void>((resolve) => {
      resolveSwitch = resolve;
    });
    const agentApi = {
      onEvent: vi.fn((handler: (payload: AcpBridgeEvent) => void) => {
        bridgeHandler = handler;
        return vi.fn();
      }),
      getState: vi.fn(async () => sessionState("thread-a")),
      getCapabilities: vi.fn(async () => null),
      // A background run is already in flight when the renderer connects.
      getRunningThreads: vi.fn(async () => ["thread-b"]),
      switchThread: vi.fn(async () => switchGate),
      respondToPermission: vi.fn(),
      sendPrompt: vi.fn(),
      replacePrompt: vi.fn(),
      abort: vi.fn(),
      createThread: vi.fn(),
      setConfigOption: vi.fn(),
      setEditorText: vi.fn(),
      pasteToEditor: vi.fn(),
      reportEditorText: vi.fn(),
    };
    (globalThis as any).window = { omni: { agent: agentApi } };

    const store = await loadStore();
    await store.getState().connect();

    // Initial sync reflects the in-flight background thread, not just the active one.
    expect(store.getState().runningThreadIds).toEqual(["thread-b"]);

    // A second thread starts working; both tabs should now report running.
    bridgeHandler?.({ type: "running-threads", threadIds: ["thread-a", "thread-b"] });
    expect(store.getState().runningThreadIds).toEqual(["thread-a", "thread-b"]);

    // Running state stays live even while a thread switch is pending (not dropped as stale).
    store.getState().switchThread("thread-b");
    await vi.waitFor(() => expect(agentApi.switchThread).toHaveBeenCalledWith("thread-b"));
    bridgeHandler?.({ type: "running-threads", threadIds: ["thread-b"] });
    expect(store.getState().runningThreadIds).toEqual(["thread-b"]);

    // When the last run ends, no tab reports running.
    bridgeHandler?.({ type: "running-threads", threadIds: [] });
    expect(store.getState().runningThreadIds).toEqual([]);

    resolveSwitch?.();
  });

  test("surfaces switch-thread failures", async () => {
    const agentApi = {
      onEvent: vi.fn((_handler: (payload: AcpBridgeEvent) => void) => vi.fn()),
      getState: vi.fn(async () => sessionState("thread-a")),
      getCapabilities: vi.fn(async () => null),
      switchThread: vi.fn(async () => {
        throw new Error("runtime refused switch");
      }),
      respondToPermission: vi.fn(),
      sendPrompt: vi.fn(),
      replacePrompt: vi.fn(),
      abort: vi.fn(),
      createThread: vi.fn(),
      setConfigOption: vi.fn(),
      setEditorText: vi.fn(),
      pasteToEditor: vi.fn(),
      reportEditorText: vi.fn(),
    };
    (globalThis as any).window = { omni: { agent: agentApi } };

    const store = await loadStore();
    await store.getState().connect();
    await store.getState().switchThread("thread-b");

    expect(store.getState().state?.threadId).toBe("thread-a");
    expect(store.getState().error).toBe("runtime refused switch");
  });

  test("queues concurrent questions and answers them one at a time", async () => {
    let bridgeHandler: ((payload: AcpBridgeEvent) => void) | null = null;
    const respondToPermission = vi.fn(async () => {});
    const agentApi = {
      onEvent: vi.fn((handler: (payload: AcpBridgeEvent) => void) => {
        bridgeHandler = handler;
        return vi.fn();
      }),
      getState: vi.fn(async () => sessionState("thread-a")),
      getCapabilities: vi.fn(async () => null),
      switchThread: vi.fn(),
      respondToPermission,
      sendPrompt: vi.fn(),
      replacePrompt: vi.fn(),
      abort: vi.fn(),
      createThread: vi.fn(),
      setConfigOption: vi.fn(),
      setEditorText: vi.fn(),
      pasteToEditor: vi.fn(),
      reportEditorText: vi.fn(),
    };
    (globalThis as any).window = { omni: { agent: agentApi } };

    const store = await loadStore();
    await store.getState().connect();

    // Two threads each raise a question. The second must not clobber the first.
    bridgeHandler?.({
      type: "permission-request",
      request: {
        sessionId: "session-thread-a",
        threadId: "thread-a",
        toolCall: { toolCallId: "t1", title: "Edit file A" },
        options: [
          { optionId: "allow-a", name: "Allow", kind: "allow_once" },
          { optionId: "reject-a", name: "Reject", kind: "reject_once" },
        ],
      },
    });
    bridgeHandler?.({
      type: "permission-request",
      request: {
        sessionId: "session-thread-b",
        threadId: "thread-b",
        toolCall: { toolCallId: "t2", title: "Edit file B" },
        options: [{ optionId: "allow-b", name: "Allow", kind: "allow_once" }],
      },
    });

    // Both are held; the head (first to arrive) carries its originating thread.
    expect(store.getState().uiRequestQueue.map((r) => r.sessionId)).toEqual([
      "session-thread-a",
      "session-thread-b",
    ]);
    expect(store.getState().uiRequest?.threadId).toBe("thread-a");

    // Answering the head maps the chosen option name back to its optionId and
    // dequeues it, promoting the next question.
    await store.getState().respondToUiRequest({ requestId: "session-thread-a", value: "Reject" });
    expect(respondToPermission).toHaveBeenCalledWith({
      sessionId: "session-thread-a",
      optionId: "reject-a",
      cancelled: false,
    });
    expect(store.getState().uiRequestQueue.map((r) => r.sessionId)).toEqual(["session-thread-b"]);
    expect(store.getState().uiRequest?.threadId).toBe("thread-b");

    // A re-ask for the same session replaces in place instead of duplicating.
    bridgeHandler?.({
      type: "permission-request",
      request: {
        sessionId: "session-thread-b",
        threadId: "thread-b",
        toolCall: { toolCallId: "t2", title: "Edit file B" },
        options: [{ optionId: "allow-b", name: "Allow", kind: "allow_once" }],
      },
    });
    expect(store.getState().uiRequestQueue).toHaveLength(1);

    // Resolving the last one from the bridge empties the queue.
    bridgeHandler?.({ type: "permission-resolved", sessionId: "session-thread-b" });
    expect(store.getState().uiRequestQueue).toEqual([]);
    expect(store.getState().uiRequest).toBeNull();
  });
});
