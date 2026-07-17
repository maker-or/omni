import { afterEach, describe, expect, test, vi } from "vitest";
import { makeWorkspaceKey, useTerminalStore } from "./terminal-store";

function resetStore() {
  useTerminalStore.setState({
    sessions: [],
    activeSessionId: null,
    workspaceKey: null,
    stashByWorkspace: {},
    listenerInitialized: false,
  });
}

afterEach(() => {
  resetStore();
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe("terminal store session behavior", () => {
  test("creates sessions with stable titles, cwd, and active selection", () => {
    const ids = ["term-1", "term-2"];
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => ids.shift() ?? "term-fallback");

    useTerminalStore.getState().createSession("/tmp/project-a");
    useTerminalStore.getState().createSession("/tmp/project-b");

    expect(useTerminalStore.getState().sessions).toEqual([
      { id: "term-2", title: "Terminal 2", cwd: "/tmp/project-b", history: "" },
      { id: "term-1", title: "Terminal 1", cwd: "/tmp/project-a", history: "" },
    ]);
    expect(useTerminalStore.getState().activeSessionId).toBe("term-2");
  });

  test("closing the active session kills its pty and selects the first remaining session", () => {
    const kill = vi.fn();
    (globalThis as any).window = { omni: { terminal: { kill } } };
    useTerminalStore.setState({
      sessions: [
        { id: "term-1", title: "Terminal 1", history: "" },
        { id: "term-2", title: "Terminal 2", history: "" },
        { id: "term-3", title: "Terminal 3", history: "" },
      ],
      activeSessionId: "term-2",
    });

    useTerminalStore.getState().closeSession("term-2");

    expect(kill).toHaveBeenCalledWith("term-2");
    expect(useTerminalStore.getState().sessions.map((session) => session.id)).toEqual([
      "term-1",
      "term-3",
    ]);
    expect(useTerminalStore.getState().activeSessionId).toBe("term-1");
  });

  test("clearing sessions kills every active pty", () => {
    const kill = vi.fn();
    (globalThis as any).window = { omni: { terminal: { kill } } };
    useTerminalStore.setState({
      sessions: [
        { id: "term-1", title: "Terminal 1", history: "" },
        { id: "term-2", title: "Terminal 2", history: "" },
      ],
      activeSessionId: "term-2",
    });

    useTerminalStore.getState().clearSessions();

    expect(kill).toHaveBeenCalledWith("term-1");
    expect(kill).toHaveBeenCalledWith("term-2");
    expect(useTerminalStore.getState().sessions).toEqual([]);
    expect(useTerminalStore.getState().activeSessionId).toBeNull();
  });

  test("switching workspace kills the visible ptys and stashes their sessions", () => {
    const kill = vi.fn();
    (globalThis as any).window = { omni: { terminal: { kill } } };
    const keyA = makeWorkspaceKey("project-1", "/repo");
    const keyB = makeWorkspaceKey("project-1", "/repo/worktrees/feature");
    useTerminalStore.setState({
      workspaceKey: keyA,
      sessions: [
        { id: "term-a-1", title: "Terminal 1", cwd: "/repo", history: "old output" },
        { id: "term-a-2", title: "Terminal 2", cwd: "/repo", history: "" },
      ],
      activeSessionId: "term-a-2",
    });

    const newActiveId = useTerminalStore.getState().setWorkspace(keyB, "/repo/worktrees/feature");

    expect(kill).toHaveBeenCalledWith("term-a-1");
    expect(kill).toHaveBeenCalledWith("term-a-2");
    // Workspace B has no stash: the bucket starts empty.
    expect(newActiveId).toBeNull();
    expect(useTerminalStore.getState().sessions).toEqual([]);
    expect(useTerminalStore.getState().workspaceKey).toBe(keyB);
    expect(useTerminalStore.getState().stashByWorkspace[keyA]).toEqual([
      { title: "Terminal 1", history: "old output" },
      { title: "Terminal 2", history: "" },
    ]);
  });

  test("returning to a workspace restores its stashed sessions with fresh ptys in the workspace cwd", () => {
    const ids = ["term-b-1", "term-a-new-1", "term-a-new-2"];
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => ids.shift() ?? "term-fallback");
    const kill = vi.fn();
    (globalThis as any).window = { omni: { terminal: { kill } } };
    const keyA = makeWorkspaceKey("project-1", "/repo");
    const keyB = makeWorkspaceKey("project-1", "/repo/worktrees/feature");
    useTerminalStore.setState({
      workspaceKey: keyA,
      sessions: [
        { id: "term-a-1", title: "Terminal 1", cwd: "/repo", history: "root scrollback" },
        { id: "term-a-2", title: "Terminal 2", cwd: "/repo", history: "" },
      ],
      activeSessionId: "term-a-1",
    });

    useTerminalStore.getState().setWorkspace(keyB, "/repo/worktrees/feature");
    useTerminalStore.getState().createSession("/repo/worktrees/feature");
    const restoredActiveId = useTerminalStore.getState().setWorkspace(keyA, "/repo");

    expect(useTerminalStore.getState().sessions).toEqual([
      { id: "term-a-new-1", title: "Terminal 1", cwd: "/repo", history: "root scrollback" },
      { id: "term-a-new-2", title: "Terminal 2", cwd: "/repo", history: "" },
    ]);
    expect(restoredActiveId).toBe("term-a-new-1");
    expect(useTerminalStore.getState().workspaceKey).toBe(keyA);
    // A's stash was consumed; B's terminal is stashed for its own return.
    expect(useTerminalStore.getState().stashByWorkspace[keyA]).toBeUndefined();
    expect(useTerminalStore.getState().stashByWorkspace[keyB]).toEqual([
      { title: "Terminal 1", history: "" },
    ]);
    expect(kill).toHaveBeenCalledWith("term-b-1");
  });

  test("re-entering the current workspace is a no-op", () => {
    const kill = vi.fn();
    (globalThis as any).window = { omni: { terminal: { kill } } };
    const keyA = makeWorkspaceKey("project-1", "/repo");
    useTerminalStore.setState({
      workspaceKey: keyA,
      sessions: [{ id: "term-a-1", title: "Terminal 1", cwd: "/repo", history: "keep" }],
      activeSessionId: "term-a-1",
    });

    const activeId = useTerminalStore.getState().setWorkspace(keyA, "/repo");

    expect(activeId).toBe("term-a-1");
    expect(kill).not.toHaveBeenCalled();
    expect(useTerminalStore.getState().sessions.map((session) => session.id)).toEqual(["term-a-1"]);
  });

  test("global data listener is registered once and appends payloads to matching history", () => {
    let onDataHandler: ((payload: { sessionId: string; data: string }) => void) | null = null;
    const onData = vi.fn((handler: (payload: { sessionId: string; data: string }) => void) => {
      onDataHandler = handler;
    });
    (globalThis as any).window = { omni: { terminal: { onData } } };
    useTerminalStore.setState({
      sessions: [{ id: "term-1", title: "Terminal 1", history: "" }],
    });

    useTerminalStore.getState().initializeGlobalListener();
    useTerminalStore.getState().initializeGlobalListener();
    onDataHandler?.({ sessionId: "term-1", data: "hello" });

    expect(onData).toHaveBeenCalledTimes(1);
    expect(useTerminalStore.getState().listenerInitialized).toBe(true);
    expect(useTerminalStore.getState().sessions[0]?.history).toBe("hello");
  });

  test("history is bounded when terminal output grows too large", () => {
    useTerminalStore.setState({
      sessions: [{ id: "term-1", title: "Terminal 1", history: "a".repeat(150000) }],
    });

    useTerminalStore.getState().appendHistory("term-1", "b".repeat(60000));

    const history = useTerminalStore.getState().sessions[0]?.history ?? "";
    expect(history).toHaveLength(100000);
    expect(history).toBe(`${"a".repeat(40000)}${"b".repeat(60000)}`);
  });
});
