import { afterEach, describe, expect, test, vi } from "vitest";
import type { AcpBridgeEvent, AcpSessionState } from "../../contracts/acp.ts";

function emptyState(threadId = "t1"): AcpSessionState {
  return {
    projectId: "p1",
    threadId,
    agentId: "pipper-mock",
    agentSessionId: `session-${threadId}`,
    cwd: "/tmp",
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
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.resetModules();
});

describe("agent-terminal-store", () => {
  test("applyTerminalOutput appends and replaces correctly", async () => {
    const { useAgentTerminalStore } = await import("./agent-terminal-store.ts");
    useAgentTerminalStore.getState().reset();
    useAgentTerminalStore.getState().applyTerminalOutput("term-1", "hello ", true);
    useAgentTerminalStore.getState().applyTerminalOutput("term-1", "world", true);
    expect(useAgentTerminalStore.getState().getOutput("term-1")).toBe("hello world");
    useAgentTerminalStore.getState().applyTerminalOutput("term-1", "RESET", false);
    expect(useAgentTerminalStore.getState().getOutput("term-1")).toBe("RESET");
    useAgentTerminalStore.getState().clear("term-1");
    expect(useAgentTerminalStore.getState().getOutput("term-1")).toBe("");
  });

  test("real connect() path appends each terminal-output event exactly once", async () => {
    let bridgeHandler: ((payload: AcpBridgeEvent) => void) | null = null;
    const onEvent = vi.fn((handler: (payload: AcpBridgeEvent) => void) => {
      bridgeHandler = handler;
      return vi.fn();
    });
    const agentApi = {
      onEvent,
      getState: vi.fn(async () => emptyState()),
      getCapabilities: vi.fn(async () => null),
      switchThread: vi.fn(),
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

    const agentMod = await import("./agent-store.ts");
    const terminalMod = await import("./agent-terminal-store.ts");
    terminalMod.useAgentTerminalStore.getState().reset();
    agentMod.useAgentStore.setState({
      state: null,
      snapshot: null,
      uiRequest: null,
      permissionRequest: null,
      isConnecting: false,
      error: null,
    });

    await agentMod.useAgentStore.getState().connect();

    // Exactly one IPC listener from connect — not a second subscribe() listener
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(bridgeHandler).toBeTruthy();

    bridgeHandler!({
      type: "terminal-output",
      terminalId: "term-x",
      output: "hello",
      append: true,
    });

    expect(terminalMod.useAgentTerminalStore.getState().getOutput("term-x")).toBe("hello");

    bridgeHandler!({
      type: "terminal-output",
      terminalId: "term-x",
      output: " world",
      append: true,
    });

    // Would be "hellohello worldworld" if dual writers were still registered
    expect(terminalMod.useAgentTerminalStore.getState().getOutput("term-x")).toBe("hello world");
  });

  test("reconnect unsubscribes previous bridge listener so events do not double-fire", async () => {
    const cleanups: Array<ReturnType<typeof vi.fn>> = [];
    let activeHandler: ((payload: AcpBridgeEvent) => void) | null = null;
    const onEvent = vi.fn((handler: (payload: AcpBridgeEvent) => void) => {
      activeHandler = handler;
      const cleanup = vi.fn(() => {
        if (activeHandler === handler) activeHandler = null;
      });
      cleanups.push(cleanup);
      return cleanup;
    });
    const agentApi = {
      onEvent,
      getState: vi.fn(async () => emptyState()),
      getCapabilities: vi.fn(async () => null),
      switchThread: vi.fn(),
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

    const agentMod = await import("./agent-store.ts");
    const terminalMod = await import("./agent-terminal-store.ts");
    terminalMod.useAgentTerminalStore.getState().reset();
    agentMod.useAgentStore.setState({
      state: null,
      snapshot: null,
      uiRequest: null,
      permissionRequest: null,
      isConnecting: false,
      error: null,
    });

    await agentMod.useAgentStore.getState().connect();
    await agentMod.useAgentStore.getState().connect();

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(cleanups[0]).toHaveBeenCalled();

    activeHandler!({
      type: "terminal-output",
      terminalId: "term-y",
      output: "once",
      append: true,
    });
    expect(terminalMod.useAgentTerminalStore.getState().getOutput("term-y")).toBe("once");
  });
});
