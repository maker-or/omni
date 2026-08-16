import { afterEach, describe, expect, test, vi } from "vitest";
import { makeWorkspaceKey, useTerminalStore } from "./terminal-store";

function resetStore() {
  useTerminalStore.setState({
    sessions: [],
    workspaceKey: null,
    stashByWorkspace: {},
    historyControlRemainders: {},
    nextSessionNumber: 1,
    tabsRevision: 0,
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
      {
        id: "terminal:term-2",
        title: "Terminal 2",
        cwd: "/tmp/project-b",
        status: "starting",
        history: "",
      },
      {
        id: "terminal:term-1",
        title: "Terminal 1",
        cwd: "/tmp/project-a",
        status: "starting",
        history: "",
      },
    ]);
  });

  test("closing a session kills its pty and returns the first remaining session", () => {
    const kill = vi.fn();
    (globalThis as any).window = { omni: { terminal: { kill } } };
    useTerminalStore.setState({
      sessions: [
        { id: "term-1", title: "Terminal 1", history: "" },
        { id: "term-2", title: "Terminal 2", history: "" },
        { id: "term-3", title: "Terminal 3", history: "" },
      ],
    });

    const nextSessionId = useTerminalStore.getState().closeSession("term-2");

    expect(kill).toHaveBeenCalledWith("term-2");
    expect(useTerminalStore.getState().sessions.map((session) => session.id)).toEqual([
      "term-1",
      "term-3",
    ]);
    expect(nextSessionId).toBe("term-1");
  });

  test("terminal titles remain unique after close and create cycles", () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("term-1")
      .mockReturnValueOnce("term-2")
      .mockReturnValueOnce("term-3");
    (globalThis as any).window = { omni: { terminal: { kill: vi.fn() } } };

    const firstId = useTerminalStore.getState().createSession();
    useTerminalStore.getState().createSession();
    useTerminalStore.getState().closeSession(firstId);
    useTerminalStore.getState().createSession();

    expect(useTerminalStore.getState().sessions.map((session) => session.title)).toEqual([
      "Terminal 3",
      "Terminal 2",
    ]);
  });

  test("clearing sessions kills every active pty", () => {
    const kill = vi.fn();
    (globalThis as any).window = { omni: { terminal: { kill } } };
    useTerminalStore.setState({
      sessions: [
        { id: "term-1", title: "Terminal 1", history: "" },
        { id: "term-2", title: "Terminal 2", history: "" },
      ],
    });

    useTerminalStore.getState().clearSessions();

    expect(kill).toHaveBeenCalledWith("term-1");
    expect(kill).toHaveBeenCalledWith("term-2");
    expect(useTerminalStore.getState().sessions).toEqual([]);
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
    });

    const newActiveId = useTerminalStore.getState().setWorkspace(keyB, "/repo/worktrees/feature");

    expect(kill).toHaveBeenCalledWith("term-a-1");
    expect(kill).toHaveBeenCalledWith("term-a-2");
    // Workspace B has no stash: the bucket starts empty.
    expect(newActiveId).toBeNull();
    expect(useTerminalStore.getState().sessions).toEqual([]);
    expect(useTerminalStore.getState().workspaceKey).toBe(keyB);
    expect(useTerminalStore.getState().stashByWorkspace[keyA]).toEqual([
      { id: "term-a-1", title: "Terminal 1", history: "old output" },
      { id: "term-a-2", title: "Terminal 2", history: "" },
    ]);
  });

  test("returning to a workspace restores stable session ids with fresh ptys in the workspace cwd", () => {
    const ids = ["term-b-1"];
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
    });

    useTerminalStore.getState().setWorkspace(keyB, "/repo/worktrees/feature");
    useTerminalStore.getState().createSession("/repo/worktrees/feature");
    const restoredActiveId = useTerminalStore.getState().setWorkspace(keyA, "/repo");

    expect(useTerminalStore.getState().sessions).toEqual([
      {
        id: "term-a-1",
        title: "Terminal 1",
        cwd: "/repo",
        status: "starting",
        history: "root scrollback",
      },
      {
        id: "term-a-2",
        title: "Terminal 2",
        cwd: "/repo",
        status: "starting",
        history: "",
      },
    ]);
    expect(restoredActiveId).toBe("term-a-1");
    expect(useTerminalStore.getState().workspaceKey).toBe(keyA);
    // A's stash was consumed; B's terminal is stashed for its own return.
    expect(useTerminalStore.getState().stashByWorkspace[keyA]).toBeUndefined();
    expect(useTerminalStore.getState().stashByWorkspace[keyB]).toEqual([
      { id: "terminal:term-b-1", title: "Terminal 1", history: "" },
    ]);
    expect(kill).toHaveBeenCalledWith("terminal:term-b-1");
  });

  test("re-entering the current workspace is a no-op", () => {
    const kill = vi.fn();
    (globalThis as any).window = { omni: { terminal: { kill } } };
    const keyA = makeWorkspaceKey("project-1", "/repo");
    useTerminalStore.setState({
      workspaceKey: keyA,
      sessions: [{ id: "term-a-1", title: "Terminal 1", cwd: "/repo", history: "keep" }],
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
    expect(history).toHaveLength(200000);
    expect(history).toBe(`${"a".repeat(140000)}${"b".repeat(60000)}`);
  });

  test("recovery history strips terminal control sequences", () => {
    useTerminalStore.setState({
      sessions: [{ id: "term-1", title: "Terminal 1", history: "" }],
    });

    useTerminalStore
      .getState()
      .appendHistory("term-1", "\u001b[31mred\u001b[0m\r\n\u001b]0;title\u0007plain");

    expect(useTerminalStore.getState().sessions[0]?.history).toBe("red\r\nplain");
  });

  test("recovery history strips control sequences split across output chunks", () => {
    useTerminalStore.setState({
      sessions: [{ id: "term-1", title: "Terminal 1", history: "" }],
    });

    useTerminalStore.getState().appendHistory("term-1", "before\u001b[");
    useTerminalStore.getState().appendHistory("term-1", "31mred\u001b[0mafter");

    expect(useTerminalStore.getState().sessions[0]?.history).toBe("beforeredafter");
  });

  test("orphan output is a referential no-op", () => {
    const sessions = [{ id: "term-1", title: "Terminal 1", history: "" }];
    useTerminalStore.setState({ sessions });

    useTerminalStore.getState().appendHistory("missing", "ignored");

    expect(useTerminalStore.getState().sessions).toBe(sessions);
  });

  test("global exit events persist completion state while the view is hidden", () => {
    let onExitHandler:
      | ((payload: { sessionId: string; exitCode: number; signal?: number }) => void)
      | null = null;
    const onData = vi.fn();
    const onExit = vi.fn(
      (handler: (payload: { sessionId: string; exitCode: number; signal?: number }) => void) => {
        onExitHandler = handler;
      },
    );
    (globalThis as any).window = { omni: { terminal: { onData, onExit } } };
    useTerminalStore.setState({
      sessions: [{ id: "term-1", title: "Terminal 1", status: "running", history: "output\n" }],
    });

    useTerminalStore.getState().initializeGlobalListener();
    onExitHandler?.({ sessionId: "term-1", exitCode: 2 });

    expect(useTerminalStore.getState().sessions[0]).toMatchObject({
      status: "exited",
      exitCode: 2,
    });
    expect(useTerminalStore.getState().sessions[0]?.history).toContain(
      "[Process completed (exit 2)]",
    );
  });
});
