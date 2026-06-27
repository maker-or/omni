import { afterEach, describe, expect, test, vi } from "vitest";
import type { AgentBridgeEvent, AgentRuntimeSnapshot } from "../../contracts/agent.ts";

function snapshot(
  threadId: string,
  patch: Partial<AgentRuntimeSnapshot> = {},
): AgentRuntimeSnapshot {
  return {
    projectId: "project-1",
    threadId,
    sessionFile: null,
    sessionId: `session-${threadId}`,
    sessionName: `Session ${threadId}`,
    cwd: "/tmp/project",
    model: null,
    thinkingLevel: null,
    isStreaming: false,
    isCompacting: false,
    isRetrying: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    messages: [],
    messageEntryRefs: [],
    streamingMessage: null,
    queue: { steering: [], followUp: [] },
    commands: [],
    models: [],
    stats: null,
    status: {},
    workingMessage: null,
    workingVisible: false,
    hiddenThinkingLabel: null,
    title: null,
    editorText: "",
    ...patch,
  } as AgentRuntimeSnapshot;
}

async function loadStore() {
  vi.resetModules();
  const mod = await import("./agent-store.ts");
  mod.useAgentStore.setState({
    snapshot: null,
    uiRequest: null,
    isConnecting: false,
    error: null,
  });
  return mod.useAgentStore;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.resetModules();
});

describe("agent store bridge behavior", () => {
  test("keeps ui request lifecycle responsive while a thread switch is pending", async () => {
    let bridgeHandler: ((payload: AgentBridgeEvent) => void) | null = null;
    let currentSnapshot = snapshot("thread-a");
    let resolveSwitch: (() => void) | null = null;
    const switchGate = new Promise<void>((resolve) => {
      resolveSwitch = resolve;
    });
    const agentApi = {
      onEvent: vi.fn((handler: (payload: AgentBridgeEvent) => void) => {
        bridgeHandler = handler;
        return vi.fn();
      }),
      getState: vi.fn(async () => currentSnapshot),
      switchThread: vi.fn(async () => switchGate),
      respondToUiRequest: vi.fn(async () => {}),
      sendPrompt: vi.fn(async () => {}),
      replacePrompt: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
      createThread: vi.fn(),
      cycleModel: vi.fn(),
      setModel: vi.fn(),
      cycleThinkingLevel: vi.fn(),
      setThinkingLevel: vi.fn(),
      compact: vi.fn(),
      setEditorText: vi.fn(),
      pasteToEditor: vi.fn(),
      reportEditorText: vi.fn(),
    };
    (globalThis as any).window = { omni: { agent: agentApi } };

    const store = await loadStore();
    await store.getState().connect();

    const switching = store.getState().switchThread("thread-b");
    await vi.waitFor(() => expect(agentApi.switchThread).toHaveBeenCalledWith("thread-b"));

    bridgeHandler?.({ type: "status", key: "phase", text: "old thread noise" });
    expect(store.getState().snapshot?.status.phase).toBeUndefined();

    bridgeHandler?.({
      type: "ui-request",
      request: {
        id: "request-1",
        kind: "confirm",
        title: "Continue?",
        message: "Approve while switching",
      },
    });
    expect(store.getState().uiRequest?.id).toBe("request-1");

    bridgeHandler?.({ type: "ui-response", requestId: "request-1", value: true });
    expect(store.getState().uiRequest).toBeNull();

    currentSnapshot = snapshot("thread-b", { status: { phase: "new thread" } });
    resolveSwitch?.();
    await switching;

    expect(store.getState().snapshot?.threadId).toBe("thread-b");
    expect(store.getState().snapshot?.status.phase).toBe("new thread");
    expect(store.getState().error).toBeNull();
  });

  test("ignores stale snapshots while waiting for the requested thread snapshot", async () => {
    let bridgeHandler: ((payload: AgentBridgeEvent) => void) | null = null;
    let currentSnapshot = snapshot("thread-a");
    let resolveSwitch: (() => void) | null = null;
    const switchGate = new Promise<void>((resolve) => {
      resolveSwitch = resolve;
    });
    const agentApi = {
      onEvent: vi.fn((handler: (payload: AgentBridgeEvent) => void) => {
        bridgeHandler = handler;
        return vi.fn();
      }),
      getState: vi.fn(async () => currentSnapshot),
      switchThread: vi.fn(async () => switchGate),
      respondToUiRequest: vi.fn(),
      sendPrompt: vi.fn(),
      replacePrompt: vi.fn(),
      abort: vi.fn(),
      createThread: vi.fn(),
      cycleModel: vi.fn(),
      setModel: vi.fn(),
      cycleThinkingLevel: vi.fn(),
      setThinkingLevel: vi.fn(),
      compact: vi.fn(),
      setEditorText: vi.fn(),
      pasteToEditor: vi.fn(),
      reportEditorText: vi.fn(),
    };
    (globalThis as any).window = { omni: { agent: agentApi } };

    const store = await loadStore();
    await store.getState().connect();

    const switching = store.getState().switchThread("thread-b");
    await vi.waitFor(() => expect(agentApi.switchThread).toHaveBeenCalledWith("thread-b"));

    bridgeHandler?.({ type: "snapshot", snapshot: snapshot("thread-a", { title: "stale" }) });
    expect(store.getState().snapshot?.title).toBeNull();

    bridgeHandler?.({ type: "snapshot", snapshot: snapshot("thread-b", { title: "fresh" }) });
    expect(store.getState().snapshot?.threadId).toBe("thread-b");
    expect(store.getState().snapshot?.title).toBe("fresh");

    currentSnapshot = snapshot("thread-b", { title: "fresh" });
    resolveSwitch?.();
    await switching;
  });

  test("surfaces switch-thread failures and accepts later bridge events after pending target clears", async () => {
    let bridgeHandler: ((payload: AgentBridgeEvent) => void) | null = null;
    const agentApi = {
      onEvent: vi.fn((handler: (payload: AgentBridgeEvent) => void) => {
        bridgeHandler = handler;
        return vi.fn();
      }),
      getState: vi.fn(async () => snapshot("thread-a")),
      switchThread: vi.fn(async () => {
        throw new Error("runtime refused switch");
      }),
      respondToUiRequest: vi.fn(),
      sendPrompt: vi.fn(),
      replacePrompt: vi.fn(),
      abort: vi.fn(),
      createThread: vi.fn(),
      cycleModel: vi.fn(),
      setModel: vi.fn(),
      cycleThinkingLevel: vi.fn(),
      setThinkingLevel: vi.fn(),
      compact: vi.fn(),
      setEditorText: vi.fn(),
      pasteToEditor: vi.fn(),
      reportEditorText: vi.fn(),
    };
    (globalThis as any).window = { omni: { agent: agentApi } };

    const store = await loadStore();
    await store.getState().connect();
    await store.getState().switchThread("thread-b");

    expect(store.getState().snapshot?.threadId).toBe("thread-a");
    expect(store.getState().error).toBe("runtime refused switch");

    bridgeHandler?.({ type: "status", key: "phase", text: "still connected" });
    expect(store.getState().snapshot?.status.phase).toBe("still connected");
  });
});
