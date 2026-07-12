import { afterEach, describe, expect, test, vi } from "vitest";
import type { AcpBridgeEvent, AcpSessionState, SubagentRunSnapshot } from "../../contracts/acp.ts";

function sessionState(threadId: string): AcpSessionState {
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
  };
}

function run(runId: string, status: SubagentRunSnapshot["status"]): SubagentRunSnapshot {
  return {
    runId,
    parentSessionId: "session-thread-a",
    sessionId: `sub-${runId}`,
    agentId: "codex-acp",
    task: "audit the auth flow",
    status,
    depth: 1,
    startedAt: 1,
    finishedAt: status === "running" || status === "queued" ? null : 2,
    resultPreview: status === "finished" ? "done" : null,
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
    subagentRuns: [],
  });
  return mod.useAgentStore;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.resetModules();
});

describe("subagent runs in the agent store", () => {
  test("subagent-runs bridge events update the store, including while a thread switch is pending", async () => {
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
      getCapabilities: vi.fn(async () => ({
        promptCapabilities: { image: true, embeddedContext: true },
      })),
      getRunningThreads: vi.fn(async () => []),
      switchThread: vi.fn(async () => switchGate),
      sendPrompt: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
    };
    (globalThis as any).window = { omni: { agent: agentApi } };

    const store = await loadStore();
    await store.getState().connect();

    bridgeHandler!({ type: "subagent-runs", runs: [run("r1", "running")] });
    expect(store.getState().subagentRuns.map((r) => r.runId)).toEqual(["r1"]);

    // Subagent activity is global — it must keep flowing while the panel is
    // switching threads (when most per-thread events are deliberately dropped).
    const switching = store.getState().switchThread("thread-b");
    bridgeHandler!({
      type: "subagent-runs",
      runs: [run("r1", "finished"), run("r2", "queued")],
    });
    expect(store.getState().subagentRuns.map((r) => [r.runId, r.status])).toEqual([
      ["r1", "finished"],
      ["r2", "queued"],
    ]);

    resolveSwitch!();
    await switching;
  });
});
