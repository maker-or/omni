import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useAgentStore, type AgentPanelSnapshot } from "./agent-store";
import { useWorkspaceViewStore } from "./workspace-view-store";
import {
  completedBackgroundThreads,
  startThreadCompletionWatcher,
  useThreadCompletionStore,
} from "./thread-completion-store";

function viewing(threadId: string | null) {
  useAgentStore.setState({
    snapshot: threadId ? ({ threadId } as unknown as AgentPanelSnapshot) : null,
  });
}

function running(threadIds: string[]) {
  useAgentStore.setState({ runningThreadIds: threadIds });
}

describe("completedBackgroundThreads", () => {
  test("reports threads that left the running set", () => {
    expect(completedBackgroundThreads(["a", "b", "c"], ["b"], [])).toEqual(["a", "c"]);
  });

  test("ignores threads the user is viewing or switching to", () => {
    expect(completedBackgroundThreads(["a", "b", "c"], [], ["a", null, "c"])).toEqual(["b"]);
  });

  test("a thread that merely started is not a completion", () => {
    expect(completedBackgroundThreads([], ["a"], [])).toEqual([]);
  });
});

describe("thread completion watcher", () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    useThreadCompletionStore.getState().clear();
    useWorkspaceViewStore.setState({ requestedThreadId: null });
    useAgentStore.setState({ runningThreadIds: [], snapshot: null, pendingThreadTarget: null });
  });

  afterEach(() => {
    stop?.();
    stop = null;
  });

  test("queues background completions in completion order and toasts each", () => {
    const onCompleted = vi.fn();
    viewing("a");
    running(["a", "b", "c"]);
    stop = startThreadCompletionWatcher(onCompleted);

    running(["a", "b"]);
    running(["a"]);

    expect(useThreadCompletionStore.getState().queue).toEqual(["c", "b"]);
    expect(onCompleted.mock.calls.map(([id]) => id)).toEqual(["c", "b"]);
  });

  test("the viewed thread finishing is not announced", () => {
    const onCompleted = vi.fn();
    viewing("a");
    running(["a", "b"]);
    stop = startThreadCompletionWatcher(onCompleted);

    running(["b"]);

    expect(useThreadCompletionStore.getState().queue).toEqual([]);
    expect(onCompleted).not.toHaveBeenCalled();
  });

  test("a thread the user is switching to finishing is not announced", () => {
    viewing("a");
    running(["a", "b"]);
    stop = startThreadCompletionWatcher();
    useWorkspaceViewStore.setState({ requestedThreadId: "b" });

    running(["a"]);

    expect(useThreadCompletionStore.getState().queue).toEqual([]);
  });

  test("viewing a queued thread by any route dequeues it", () => {
    viewing("a");
    running(["a", "b", "c"]);
    stop = startThreadCompletionWatcher();
    running([]);
    expect(useThreadCompletionStore.getState().queue).toEqual(["b", "c"]);

    viewing("c");

    expect(useThreadCompletionStore.getState().queue).toEqual(["b"]);
  });

  test("closing a running tab is not a completion", () => {
    const onCompleted = vi.fn();
    viewing("a");
    running(["a", "b"]);
    stop = startThreadCompletionWatcher(onCompleted);

    useThreadCompletionStore.getState().dismissThread("b");
    running(["a"]);

    expect(useThreadCompletionStore.getState().queue).toEqual([]);
    expect(onCompleted).not.toHaveBeenCalled();
    // The suppression was consumed: a later run of the same thread announces.
    running(["a", "b"]);
    running(["a"]);
    expect(useThreadCompletionStore.getState().queue).toEqual(["b"]);
  });

  test("dismissing a queued thread removes it and a restart clears the suppression", () => {
    viewing("a");
    running(["a", "b"]);
    stop = startThreadCompletionWatcher();
    running(["a"]);
    expect(useThreadCompletionStore.getState().queue).toEqual(["b"]);

    useThreadCompletionStore.getState().dismissThread("b");
    expect(useThreadCompletionStore.getState().queue).toEqual([]);

    // Starting again means the earlier dismissal no longer applies.
    running(["a", "b"]);
    expect(useThreadCompletionStore.getState().suppressed).toEqual([]);
    running(["a"]);
    expect(useThreadCompletionStore.getState().queue).toEqual(["b"]);
  });

  test("a completion is queued once even if the running set flaps", () => {
    viewing("a");
    running(["a", "b"]);
    stop = startThreadCompletionWatcher();
    running(["a"]);
    running(["a", "b"]);
    running(["a"]);
    expect(useThreadCompletionStore.getState().queue).toEqual(["b"]);
  });
});
