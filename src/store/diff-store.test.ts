import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  DIFF_RETAINED_BYTES_BUDGET,
  diffThreadBytes,
  setDiffRetainedBytesBudget,
  useDiffStore,
} from "./diff-store";
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

  test("ingests a diff tool call without opening the panel", () => {
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
    expect(state.isOpen).toBe(false);
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

  test("a new file diff in the same thread does not reopen the tab", () => {
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
    expect(state.isOpen).toBe(false);
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

  test("opening the panel is scoped to the active thread and closes on switch", () => {
    useDiffStore.getState().ingestToolCalls("thread-1", {
      "tc-a": editToolCall("/repo/a.ts", "old", "new"),
    });
    useDiffStore.getState().open();
    expect(useDiffStore.getState().isOpen).toBe(true);
    expect(useDiffStore.getState().threads["thread-1"]?.isOpen).toBe(true);

    // Ingesting another thread switches the projection and closes the panel.
    useDiffStore.getState().ingestToolCalls("thread-3", {
      "tc-c": editToolCall("/repo/c.ts", "x", "y"),
    });
    expect(useDiffStore.getState().isOpen).toBe(false);

    // Open thread-3's diffs, then come back to thread-1: still closed, even
    // though thread-1 was opened before leaving it.
    useDiffStore.getState().open();
    expect(useDiffStore.getState().isOpen).toBe(true);
    expect(useDiffStore.getState().threads["thread-3"]?.isOpen).toBe(true);

    useDiffStore.getState().activateThread("thread-1");
    expect(useDiffStore.getState().isOpen).toBe(false);
    expect(useDiffStore.getState().threads["thread-1"]?.isOpen).toBe(false);
  });

  test("close only affects the active thread", () => {
    useDiffStore.getState().ingestToolCalls("thread-1", {
      "tc-a": editToolCall("/repo/a.ts", "old", "new"),
    });
    useDiffStore.getState().open();
    useDiffStore.getState().ingestToolCalls("thread-3", {
      "tc-c": editToolCall("/repo/c.ts", "x", "y"),
    });
    expect(useDiffStore.getState().isOpen).toBe(false);

    useDiffStore.getState().open();
    useDiffStore.getState().close();
    expect(useDiffStore.getState().isOpen).toBe(false);
    expect(useDiffStore.getState().threads["thread-3"]?.isOpen).toBe(false);

    // thread-1's stored open flag is untouched by closing thread-3; activation
    // will reset it anyway.
    expect(useDiffStore.getState().threads["thread-1"]?.isOpen).toBe(true);
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

  test("summarizes final ACP diff blocks once per assistant message", () => {
    const summary = useDiffStore.getState().recordTurnSummary("thread-1", "assistant-1", {
      "tc-a": editToolCall("/repo/a.ts", "const a = 1;\n", "const a = 2;\nconst b = 3;\n"),
      "tc-b": editToolCall("/repo/b.ts", "old\n", "new\n"),
    });

    expect(summary).toMatchObject({
      key: "assistant-1",
      additions: 3,
      deletions: 2,
      files: [
        { path: "/repo/a.ts", additions: 2, deletions: 1 },
        { path: "/repo/b.ts", additions: 1, deletions: 1 },
      ],
    });
    expect(useDiffStore.getState().summaries["assistant-1"]).toEqual(summary);
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

  describe("byte budget", () => {
    afterEach(() => setDiffRetainedBytesBudget(DIFF_RETAINED_BYTES_BUDGET));

    function text(seed: string, length = 2048): string {
      let out = seed;
      while (out.length < length) out += `\n${seed}:${out.length}`;
      return out.slice(0, length);
    }

    function threadCalls(i: number) {
      return {
        [`a-${i}`]: {
          ...editToolCall(`/repo/${i}/a.ts`, text(`old-a-${i}`), text(`new-a-${i}`)),
          toolCallId: `a-${i}`,
        },
        [`b-${i}`]: {
          ...editToolCall(`/repo/${i}/b.ts`, text(`old-b-${i}`), text(`new-b-${i}`)),
          toolCallId: `b-${i}`,
        },
      };
    }

    test("viewing diffs across many threads stays within the byte budget", () => {
      // Four 2,048-char texts in UTF-16, plus a little for the two paths.
      const perThread = 4 * 2048 * 2 + 64;
      setDiffRetainedBytesBudget(perThread * 3);
      for (let i = 0; i < 20; i++) {
        const store = useDiffStore.getState();
        store.activateThread(`thread-${i}`);
        store.ingestToolCalls(`thread-${i}`, threadCalls(i));
        const threads = useDiffStore.getState().threads;
        const retained = Object.values(threads).reduce((sum, t) => sum + diffThreadBytes(t), 0);
        expect(retained).toBeLessThanOrEqual(perThread * 3 + 256);
      }
      const threads = useDiffStore.getState().threads;
      expect(threads["thread-19"]?.order).toHaveLength(2);
      // Only the oldest threads give up their texts: exactly what fits stays.
      expect(threads["thread-18"]?.order).toHaveLength(2);
      expect(Object.values(threads).filter((t) => t.order.length > 0)).toHaveLength(3);
      expect(threads["thread-0"]?.evicted).toBe(true);
      expect(threads["thread-0"]?.files).toEqual({});

      // Background ingestion never releases the active (pinned) thread, even
      // once it is the least recently used.
      for (let i = 20; i < 26; i++) {
        useDiffStore.getState().ingestToolCalls(`thread-${i}`, threadCalls(i), false);
      }
      const after = useDiffStore.getState();
      expect(after.threadId).toBe("thread-19");
      expect(after.threads["thread-19"]?.order).toHaveLength(2);
      expect(after.threads["thread-19"]?.evicted).toBeUndefined();
    });

    test("an evicted thread rebuilds exact files without new unseen counts", () => {
      setDiffRetainedBytesBudget(4 * 2048 * 2 + 256);
      const store = useDiffStore.getState();
      store.activateThread("thread-0");
      store.ingestToolCalls("thread-0", threadCalls(0));
      store.recordTurnSummary("thread-0", "a-0", threadCalls(0));
      const original = useDiffStore.getState().files;
      const activePath = useDiffStore.getState().threads["thread-0"]!.activePath;
      const unseen = useDiffStore.getState().unseenCount;

      // Activating another thread unpins thread-0; its texts are released.
      useDiffStore.getState().activateThread("thread-1");
      useDiffStore.getState().ingestToolCalls("thread-1", threadCalls(1));
      const evicted = useDiffStore.getState().threads["thread-0"]!;
      expect(evicted.evicted).toBe(true);
      expect(evicted.summaries["a-0"]).toBeDefined();

      useDiffStore.getState().activateThread("thread-0");
      expect(useDiffStore.getState().files).toEqual({});
      useDiffStore.getState().ingestToolCalls("thread-0", threadCalls(0));
      const restored = useDiffStore.getState();
      expect(restored.order).toEqual(["/repo/0/a.ts", "/repo/0/b.ts"]);
      for (const path of restored.order) {
        expect(restored.files[path]!.oldText).toBe(original[path]!.oldText);
        expect(restored.files[path]!.newText).toBe(original[path]!.newText);
      }
      expect(restored.activePath).toBe(activePath);
      expect(restored.unseenCount).toBe(unseen);
      expect(restored.threads["thread-0"]?.evicted).toBeUndefined();
    });
  });
});
