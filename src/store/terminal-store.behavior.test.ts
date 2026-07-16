import { afterEach, describe, expect, test, vi } from "vitest";
import { useTerminalStore } from "./terminal-store";

function resetStore() {
  useTerminalStore.setState({
    sessions: [],
    activeSessionId: null,
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

  test("restarts terminals in the selected workspace", () => {
    const ids = ["term-new-1", "term-new-2"];
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => ids.shift() ?? "term-fallback");
    const kill = vi.fn();
    (globalThis as any).window = { omni: { terminal: { kill } } };
    useTerminalStore.setState({
      sessions: [
        { id: "term-old-1", title: "Terminal 1", cwd: "/repo", history: "old output" },
        { id: "term-old-2", title: "Terminal 2", cwd: "/repo", history: "" },
      ],
      activeSessionId: "term-old-2",
    });

    useTerminalStore.getState().restartSessionsIn("/repo/worktrees/feature");

    expect(kill).toHaveBeenCalledWith("term-old-1");
    expect(kill).toHaveBeenCalledWith("term-old-2");
    expect(useTerminalStore.getState().sessions).toEqual([
      { id: "term-new-1", title: "Terminal 1", cwd: "/repo/worktrees/feature", history: "" },
      { id: "term-new-2", title: "Terminal 2", cwd: "/repo/worktrees/feature", history: "" },
    ]);
    expect(useTerminalStore.getState().activeSessionId).toBe("term-new-2");
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
