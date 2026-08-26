import { describe, expect, test } from "vitest";
import {
  contentHasDiff,
  extractTerminalIds,
  hydrateToolCall,
  leanToolCallsEqual,
  mergeToolCallPayload,
  payloadFromSessionUpdate,
  previewFromToolBodies,
  stripToolPayloadFromSessionUpdate,
  toLeanToolCall,
} from "./tool-call-payload";

describe("tool-call-payload", () => {
  test("toLeanToolCall drops content and rawOutput and keeps a title-sized preview", () => {
    const lean = toLeanToolCall({
      toolCallId: "tc1",
      title: "Search repo",
      kind: "search",
      status: "completed",
      rawInput: { query: "renderer" },
      content: [{ type: "content", content: { type: "text", text: "first hit\nsecond hit" } }],
      rawOutput: { padding: "x".repeat(10_000) },
    });

    expect(lean.content).toBeUndefined();
    expect(lean.rawOutput).toBeUndefined();
    expect(lean.title).toBe("Search repo");
    expect(lean.rawInput).toEqual({ query: "renderer" });
    expect(lean.hasPayload).toBe(true);
    expect(lean.outputPreview).toBe("first hit second hit");
  });

  test("toLeanToolCall records terminals and diffs without keeping bodies", () => {
    const lean = toLeanToolCall({
      toolCallId: "tc2",
      title: "Edit file",
      kind: "edit",
      status: "completed",
      content: [
        { type: "terminal", terminalId: "term-1" },
        { type: "diff", path: "/repo/a.ts", oldText: "a", newText: "b" },
      ],
    });

    expect(lean.content).toBeUndefined();
    expect(lean.terminalIds).toEqual(["term-1"]);
    expect(lean.hasDiff).toBe(true);
  });

  test("already-lean tool calls keep identity", () => {
    const lean = {
      toolCallId: "tc3",
      title: "Read",
      status: "pending" as const,
    };
    expect(toLeanToolCall(lean)).toBe(lean);
  });

  test("leanToolCallsEqual ignores dropped bodies", () => {
    const left = toLeanToolCall({
      toolCallId: "tc4",
      title: "Read",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "ok" } }],
    });
    const right = toLeanToolCall({
      toolCallId: "tc4",
      title: "Read",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "ok" } }],
    });
    expect(leanToolCallsEqual(left, right)).toBe(true);
  });

  test("payloadFromSessionUpdate ignores non-tool updates", () => {
    expect(
      payloadFromSessionUpdate({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hi" },
      }),
    ).toBeNull();
  });

  test("payloadFromSessionUpdate and merge keep the latest body", () => {
    const first = payloadFromSessionUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "tc5",
      rawInput: { q: "one" },
    });
    expect(first?.toolCallId).toBe("tc5");
    const merged = mergeToolCallPayload(first?.payload, {
      rawOutput: { matches: 2 },
      content: [{ type: "content", content: { type: "text", text: "done" } }],
    });
    expect(merged.rawInput).toEqual({ q: "one" });
    expect(merged.rawOutput).toEqual({ matches: 2 });
    const hydrated = hydrateToolCall(
      { toolCallId: "tc5", title: "Search", status: "completed" },
      merged,
    );
    expect(hydrated.rawOutput).toEqual({ matches: 2 });
    expect(hydrated.content).toHaveLength(1);
  });

  test("preview and extract helpers do not stringify huge objects", () => {
    const huge = { padding: "x".repeat(50_000) };
    expect(previewFromToolBodies(undefined, huge)).toBe("{padding}");
    expect(extractTerminalIds([{ type: "terminal", terminalId: "t" }])).toEqual(["t"]);
    expect(contentHasDiff([{ type: "diff", path: "/a.ts", oldText: "", newText: "b" }])).toBe(true);
  });

  test("renderer session updates omit parked tool bodies", () => {
    const lean = stripToolPayloadFromSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "tc6",
      title: "Read",
      status: "completed",
      rawInput: { path: "/large" },
      rawOutput: { padding: "x".repeat(100_000) },
      content: [{ type: "content", content: { type: "text", text: "done" } }],
    });

    expect(lean).toMatchObject({
      sessionUpdate: "tool_call_update",
      toolCallId: "tc6",
      title: "Read",
      status: "completed",
    });
    expect("rawInput" in lean).toBe(false);
    expect("rawOutput" in lean).toBe(false);
    expect("content" in lean).toBe(false);
  });
});
