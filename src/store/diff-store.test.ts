import { beforeEach, describe, expect, test } from "vitest";
import { useDiffStore } from "./diff-store";
import type { AcpToolCallState } from "../../contracts/acp.ts";

function editToolCall(
  path: string,
  oldText: string | null,
  newText: string,
  status: AcpToolCallState["status"] = "completed",
): AcpToolCallState {
  return {
    toolCallId: `tc-${path}`,
    title: "Edit",
    kind: "edit",
    status,
    content: [{ type: "diff", path, oldText, newText } as never],
  };
}

describe("diff-store", () => {
  beforeEach(() => {
    useDiffStore.setState({
      threadId: null,
      files: {},
      order: [],
      activePath: null,
      isOpen: false,
      unseenCount: 0,
      threads: {},
    });
  });

  test("ingests a diff tool call and auto-opens", () => {
    useDiffStore.setState({
      threadId: null,
      files: {},
      order: [],
      activePath: null,
      isOpen: false,
      unseenCount: 0,
    });

    const metrics = useDiffStore.getState().ingestToolCalls("thread-1", {
      "tc-a": editToolCall("/repo/a.ts", "old", "new"),
    });

    const state = useDiffStore.getState();
    expect(state.order).toEqual(["/repo/a.ts"]);
    expect(state.files["/repo/a.ts"]).toMatchObject({ oldText: "old", newText: "new" });
    expect(state.isOpen).toBe(true);
    expect(state.activePath).toBe("/repo/a.ts");
    expect(metrics).toMatchObject({
      toolCallCount: 1,
      extractedFileCount: 1,
      changedFileCount: 1,
      fileCount: 1,
    });
    expect(metrics?.serializedUtf16Bytes).toBeGreaterThan(0);
    expect(metrics?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("dedupes unchanged diff content and does not reopen a closed tab", () => {
    useDiffStore.setState({
      threadId: "thread-1",
      files: { "/repo/a.ts": { path: "/repo/a.ts", oldText: "old", newText: "new", updatedAt: 0 } },
      order: ["/repo/a.ts"],
      activePath: "/repo/a.ts",
      isOpen: false,
      unseenCount: 0,
    });

    useDiffStore.getState().ingestToolCalls("thread-1", {
      "tc-a": editToolCall("/repo/a.ts", "old", "new"),
    });

    expect(useDiffStore.getState().isOpen).toBe(false);
  });

  test("a new file diff in the same thread reopens the tab", () => {
    useDiffStore.setState({
      threadId: "thread-1",
      files: { "/repo/a.ts": { path: "/repo/a.ts", oldText: "old", newText: "new", updatedAt: 0 } },
      order: ["/repo/a.ts"],
      activePath: "/repo/a.ts",
      isOpen: false,
      unseenCount: 0,
    });

    useDiffStore.getState().ingestToolCalls("thread-1", {
      "tc-a": editToolCall("/repo/a.ts", "old", "new"),
      "tc-b": editToolCall("/repo/b.ts", null, "brand new file"),
    });

    const state = useDiffStore.getState();
    expect(state.order).toEqual(["/repo/a.ts", "/repo/b.ts"]);
    expect(state.isOpen).toBe(true);
    expect(state.activePath).toBe("/repo/b.ts");
  });

  test("shows partial in-flight diffs and updates them when the tool completes", () => {
    useDiffStore.setState({
      threadId: "thread-1",
      files: {},
      order: [],
      activePath: null,
      isOpen: false,
      unseenCount: 0,
    });

    useDiffStore.getState().ingestToolCalls("thread-1", {
      "tc-a": editToolCall("/repo/a.ts", "old", "ne", "in_progress"),
    });

    let state = useDiffStore.getState();
    expect(state.order).toEqual(["/repo/a.ts"]);
    expect(state.files["/repo/a.ts"]).toMatchObject({ newText: "ne" });

    useDiffStore.getState().ingestToolCalls("thread-1", {
      "tc-a": editToolCall("/repo/a.ts", "old", "new", "completed"),
    });

    state = useDiffStore.getState();
    expect(state.order).toEqual(["/repo/a.ts"]);
    expect(state.files["/repo/a.ts"]).toMatchObject({ oldText: "old", newText: "new" });
  });

  test("keeps diffs separate when switching threads", () => {
    useDiffStore.setState({
      threadId: "thread-1",
      files: { "/repo/a.ts": { path: "/repo/a.ts", oldText: "old", newText: "new", updatedAt: 0 } },
      order: ["/repo/a.ts"],
      activePath: "/repo/a.ts",
      isOpen: true,
      unseenCount: 0,
    });

    useDiffStore.getState().ingestToolCalls("thread-2", {
      "tc-c": editToolCall("/repo/c.ts", "x", "y"),
    });

    const state = useDiffStore.getState();
    expect(state.threadId).toBe("thread-2");
    expect(state.order).toEqual(["/repo/c.ts"]);
    expect(state.files["/repo/a.ts"]).toBeUndefined();
    expect(useDiffStore.getState().threads["thread-1"]?.files["/repo/a.ts"]).toBeDefined();

    useDiffStore.getState().ingestToolCalls("thread-1", {
      "tc-a": editToolCall("/repo/a.ts", "old", "new"),
    });
    expect(useDiffStore.getState().order).toEqual(["/repo/a.ts"]);
    expect(useDiffStore.getState().files["/repo/a.ts"]).toBeDefined();
  });

  test("accepts nested file-edit shapes", () => {
    useDiffStore.setState({
      threadId: null,
      files: {},
      order: [],
      activePath: null,
      isOpen: false,
      unseenCount: 0,
    });

    useDiffStore.getState().ingestToolCalls("thread-1", {
      "tc-nested": {
        toolCallId: "tc-nested",
        title: "Edit",
        status: "completed",
        content: [
          {
            type: "file_edit",
            content: [{ path: "/repo/nested.ts", old_text: "a", new_text: "b" }],
          } as never,
        ],
      },
    });

    expect(useDiffStore.getState().files["/repo/nested.ts"]).toMatchObject({
      oldText: "a",
      newText: "b",
    });
  });

  test("ingests background thread diffs without changing the active view", () => {
    useDiffStore.getState().ingestToolCalls("thread-1", {
      "tc-a": editToolCall("/repo/a.ts", "old", "new"),
    });

    useDiffStore
      .getState()
      .ingestToolCalls("thread-2", { "tc-b": editToolCall("/repo/b.ts", "old", "new") }, false);

    const state = useDiffStore.getState();
    expect(state.threadId).toBe("thread-1");
    expect(state.files["/repo/a.ts"]).toBeDefined();
    expect(state.threads["thread-2"]?.files["/repo/b.ts"]).toBeDefined();
  });

  test("clear removes the active diff projection and retained thread data", () => {
    useDiffStore.getState().ingestToolCalls("thread-1", {
      "tc-a": editToolCall("/repo/a.ts", "old", "new"),
    });

    useDiffStore.getState().clear();

    expect(useDiffStore.getState()).toMatchObject({
      threadId: null,
      files: {},
      order: [],
      activePath: null,
      isOpen: false,
      threads: {},
    });
  });

  test("caps retained background thread diffs", () => {
    for (let i = 0; i < 101; i++) {
      useDiffStore.getState().ingestToolCalls(`thread-${i}`, {}, false);
    }
    expect(Object.keys(useDiffStore.getState().threads)).toHaveLength(100);
  });
});
