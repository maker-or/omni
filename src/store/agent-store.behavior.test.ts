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
    messages: [],
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
    expect(store.getState().state?.messages.some((m) => m.id === "stale")).toBeFalsy();

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
      messages: [
        { id: "m1", role: "user", text: "hi", thought: "", toolCallIds: [], streaming: false },
      ],
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
});
