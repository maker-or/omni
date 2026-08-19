import { describe, expect, test } from "vitest";
import {
  applySessionUpdate,
  applySessionUpdateInPlace,
  applySessionUpdateUnbounded,
  createEmptySessionSlice,
  resetEntryIdCounter,
  trimSessionSlice,
} from "./acp-session-reducer";
import {
  SessionRetentionTracker,
  captureRetentionTail,
  computeRetentionMetrics,
  estimateJsonBytes,
} from "./session-retention";

describe("session retention tracker", () => {
  test("estimateJsonBytes matches JSON.stringify length for typical values", () => {
    const samples: unknown[] = [
      null,
      true,
      false,
      0,
      42,
      "hello",
      [],
      [1, 2, 3],
      {},
      { rawInput: { query: "renderer", cwd: "/tmp" } },
    ];
    for (const sample of samples) {
      expect(estimateJsonBytes(sample)).toBe(Buffer.byteLength(JSON.stringify(sample), "utf8"));
    }
  });

  test("tracker matches a full scan across a replay-shaped stream", () => {
    let state = createEmptySessionSlice();
    const tracker = new SessionRetentionTracker();
    const updates = [
      {
        sessionUpdate: "user_message_chunk" as const,
        messageId: "u1",
        content: { type: "text" as const, text: "hello" },
      },
      {
        sessionUpdate: "agent_thought_chunk" as const,
        content: { type: "text" as const, text: "thinking" },
      },
      {
        sessionUpdate: "tool_call" as const,
        toolCallId: "tc1",
        title: "Read",
        rawInput: { path: "/a.ts" },
      },
      {
        sessionUpdate: "tool_call_update" as const,
        toolCallId: "tc1",
        status: "completed" as const,
        content: [{ type: "content" as const, content: { type: "text" as const, text: "ok" } }],
      },
      {
        sessionUpdate: "agent_message_chunk" as const,
        content: { type: "text" as const, text: "done" },
      },
    ];

    for (const update of updates) {
      const previous = state;
      state = applySessionUpdateUnbounded(state, update);
      const observed = tracker.observe(previous, state, update);
      expect(observed).toEqual(computeRetentionMetrics(state));
    }

    const trimmed = trimSessionSlice(state);
    expect(tracker.recompute(trimmed)).toEqual(computeRetentionMetrics(trimmed));
    resetEntryIdCounter();
    const bounded = applySessionUpdate(createEmptySessionSlice(), updates[0]!);
    resetEntryIdCounter();
    const unbounded = trimSessionSlice(
      applySessionUpdateUnbounded(createEmptySessionSlice(), updates[0]!),
    );
    expect(bounded).toEqual(unbounded);
  });

  test("observeAfterMutation matches a full scan for in-place replay", () => {
    const mutable = createEmptySessionSlice();
    const tracker = new SessionRetentionTracker();
    const updates = [
      {
        sessionUpdate: "user_message_chunk" as const,
        messageId: "u1",
        content: { type: "text" as const, text: "hello" },
      },
      {
        sessionUpdate: "agent_message_chunk" as const,
        content: { type: "text" as const, text: "part " },
      },
      {
        sessionUpdate: "agent_message_chunk" as const,
        content: { type: "text" as const, text: "two" },
      },
      {
        sessionUpdate: "tool_call" as const,
        toolCallId: "tc1",
        title: "Read",
        rawInput: { path: "/a.ts" },
      },
    ];
    for (const update of updates) {
      const before = captureRetentionTail(mutable);
      applySessionUpdateInPlace(mutable, update);
      expect(tracker.observeAfterMutation(before, mutable, update)).toEqual(
        computeRetentionMetrics(mutable),
      );
    }
  });
});
