import { describe, expect, test } from "vitest";
import { useDiffStore } from "./diff-store";
import type { AcpToolCallState } from "../../contracts/acp.ts";

function editToolCall(path: string, oldText: string | null, newText: string): AcpToolCallState {
  return {
    toolCallId: `tc-${path}`,
    title: "Edit",
    kind: "edit",
    status: "completed",
    content: [{ type: "diff", path, oldText, newText } as never],
  };
}

describe("diff-store", () => {
  test("ingests a diff tool call and auto-opens", () => {
    useDiffStore.setState({
      threadId: null,
      files: {},
      order: [],
      activePath: null,
      isOpen: false,
      unseenCount: 0,
    });

    useDiffStore.getState().ingestToolCalls("thread-1", {
      "tc-a": editToolCall("/repo/a.ts", "old", "new"),
    });

    const state = useDiffStore.getState();
    expect(state.order).toEqual(["/repo/a.ts"]);
    expect(state.files["/repo/a.ts"]).toMatchObject({ oldText: "old", newText: "new" });
    expect(state.isOpen).toBe(true);
    expect(state.activePath).toBe("/repo/a.ts");
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

  test("switching threads clears diffs from the previous thread", () => {
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
  });
});
