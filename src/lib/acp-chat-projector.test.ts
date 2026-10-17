import { describe, expect, test } from "vitest";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { AcpEntry, AcpToolCallState } from "../../contracts/acp.ts";
import { createChatProjector, projectChatMessages } from "./acp-entries";
import {
  appendLocalUserMessage,
  applySessionUpdate,
  applyTurnStop,
  createEmptySessionSlice,
  MAX_SESSION_ENTRIES,
  type AcpSessionSlice,
} from "./acp-session-reducer";

/** Small deterministic PRNG so failures reproduce from the seed. */
function rng(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

type Step =
  | { kind: "update"; update: SessionUpdate }
  | { kind: "local-user"; text: string }
  | { kind: "stop" }
  | { kind: "replace-tools" }
  | { kind: "session-state" };

function randomStep(random: () => number, step: number, toolIds: string[]): Step {
  const roll = random();
  const text = { type: "text" as const, text: `t${step} ` };
  if (roll < 0.45)
    return { kind: "update", update: { sessionUpdate: "agent_message_chunk", content: text } };
  if (roll < 0.52)
    return { kind: "update", update: { sessionUpdate: "agent_thought_chunk", content: text } };
  if (roll < 0.55)
    return {
      kind: "update",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: `m${Math.floor(step / 7)}`,
        content: random() < 0.2 ? { type: "text", text: "" } : text,
      },
    };
  if (roll < 0.63) {
    const toolCallId = `tool-${step}`;
    toolIds.push(toolCallId);
    return {
      kind: "update",
      update: { sessionUpdate: "tool_call", toolCallId, title: `Tool ${step}`, status: "pending" },
    };
  }
  if (roll < 0.75 && toolIds.length > 0) {
    // Updates hit recent tools most often, but also tools in settled turns.
    const index =
      random() < 0.7
        ? toolIds.length - 1 - Math.floor(random() * Math.min(3, toolIds.length))
        : Math.floor(random() * toolIds.length);
    const status = (["in_progress", "completed", "failed"] as const)[Math.floor(random() * 3)]!;
    return {
      kind: "update",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: toolIds[index]!,
        status,
        ...(status === "completed"
          ? { content: [{ type: "content", content: { type: "text", text: `out ${step}` } }] }
          : {}),
      },
    };
  }
  if (roll < 0.77) {
    // Update for a tool the agent never announced still gets an entry.
    const toolCallId = `orphan-${step}`;
    toolIds.push(toolCallId);
    return {
      kind: "update",
      update: { sessionUpdate: "tool_call_update", toolCallId, status: "completed" },
    };
  }
  if (roll < 0.81) return { kind: "local-user", text: `prompt ${step}` };
  if (roll < 0.84)
    return {
      kind: "update",
      update: {
        sessionUpdate: "user_message_chunk",
        messageId: `u${Math.floor(step / 3)}`,
        content: { type: "text", text: `echo ${step}` },
      },
    };
  if (roll < 0.88) return { kind: "stop" };
  if (roll < 0.9) return { kind: "replace-tools" };
  if (roll < 0.91) return { kind: "session-state" };
  return {
    kind: "update",
    update: { sessionUpdate: "usage_update", used: step, size: 1000 } as SessionUpdate,
  };
}

function cloneEntries(entries: AcpEntry[]): AcpEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

function applyStep(slice: AcpSessionSlice, step: Step, index: number): AcpSessionSlice {
  switch (step.kind) {
    case "update":
      return applySessionUpdate(slice, step.update);
    case "local-user":
      return appendLocalUserMessage(slice, step.text, `local-user-${index}`);
    case "stop":
      return applyTurnStop(slice);
    case "replace-tools": {
      // thread-tool-calls hydration: every tool record becomes a new object.
      const toolCalls: Record<string, AcpToolCallState> = {};
      for (const [id, tool] of Object.entries(slice.toolCalls)) toolCalls[id] = { ...tool };
      return { ...slice, toolCalls };
    }
    case "session-state":
      // Authoritative state over IPC: same content, all-new objects.
      return {
        ...slice,
        entries: cloneEntries(slice.entries),
        toolCalls: structuredClone(slice.toolCalls),
      };
  }
}

function referencePanel(slice: AcpSessionSlice) {
  const chat = projectChatMessages(slice.entries, slice.toolCalls, slice.isStreaming);
  const streaming = chat.find((m) => m.streaming && m.role === "assistant") ?? null;
  return { settled: chat.filter((m) => m !== streaming), streaming };
}

describe("incremental chat projector", () => {
  test.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "matches the reference projection at every step of a mixed stream (seed %i)",
    (seed) => {
      const random = rng(seed);
      const project = createChatProjector();
      const toolIds: string[] = [];
      let slice = createEmptySessionSlice();
      for (let i = 0; i < 1500; i++) {
        slice = applyStep(slice, randomStep(random, i, toolIds), i);
        const incremental = project(slice.entries, slice.toolCalls, slice.isStreaming);
        expect(incremental).toEqual(referencePanel(slice));
      }
    },
  );

  test("stays equivalent across front trimming of a long history", () => {
    const random = rng(42);
    const project = createChatProjector();
    const toolIds: string[] = [];
    let slice = createEmptySessionSlice();
    let trimmed = false;
    for (let i = 0; i < MAX_SESSION_ENTRIES * 3; i++) {
      // Mostly new entries (thought/text alternation forces a new entry each step).
      const update: SessionUpdate =
        i % 2 === 0
          ? { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: `a${i}` } }
          : { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `b${i}` } };
      const step: Step =
        random() < 0.2 ? randomStep(random, i, toolIds) : { kind: "update", update };
      const before = slice.entries.length;
      slice = applyStep(slice, step, i);
      if (before === MAX_SESSION_ENTRIES && slice.entries.length === MAX_SESSION_ENTRIES)
        trimmed = true;
      if (i % 50 === 0 || trimmed) {
        expect(project(slice.entries, slice.toolCalls, slice.isStreaming)).toEqual(
          referencePanel(slice),
        );
      } else {
        project(slice.entries, slice.toolCalls, slice.isStreaming);
      }
    }
    expect(trimmed).toBe(true);
  });

  test("text chunks keep settled identity; only the streaming tail changes", () => {
    const project = createChatProjector();
    let slice = createEmptySessionSlice();
    slice = appendLocalUserMessage(slice, "first", "local-user-1");
    slice = applySessionUpdate(slice, {
      sessionUpdate: "tool_call",
      toolCallId: "a",
      title: "A",
      status: "completed",
    });
    slice = applySessionUpdate(slice, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "done" },
    });
    slice = applyTurnStop(slice);
    slice = appendLocalUserMessage(slice, "second", "local-user-2");
    slice = applySessionUpdate(slice, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "go" },
    });
    const before = project(slice.entries, slice.toolCalls, slice.isStreaming);
    expect(before.streaming?.text).toBe("go");
    slice = applySessionUpdate(slice, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "ing" },
    });
    const after = project(slice.entries, slice.toolCalls, slice.isStreaming);
    expect(after.settled).toBe(before.settled);
    expect(after.streaming).not.toBe(before.streaming);
    expect(after.streaming?.text).toBe("going");

    // A late update to the settled turn's tool replaces only that message.
    slice = applySessionUpdate(slice, {
      sessionUpdate: "tool_call_update",
      toolCallId: "a",
      status: "failed",
    });
    const updated = project(slice.entries, slice.toolCalls, slice.isStreaming);
    expect(updated.settled).not.toBe(after.settled);
    expect(updated.settled[0]).toBe(after.settled[0]);
    expect(updated.settled[1]).not.toBe(after.settled[1]);
    expect(updated.settled[2]).toBe(after.settled[2]);
    expect(updated).toEqual(referencePanel(slice));
  });

  test("optimistic echo is swallowed without a duplicate user message", () => {
    const project = createChatProjector();
    let slice = appendLocalUserMessage(createEmptySessionSlice(), "hello", "local-user-1");
    const before = project(slice.entries, slice.toolCalls, slice.isStreaming);
    slice = applySessionUpdate(slice, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "hello" },
    });
    const after = project(slice.entries, slice.toolCalls, slice.isStreaming);
    expect(after.settled).toHaveLength(1);
    expect(after.settled[0]).toBe(before.settled[0]);
    expect(after.settled[0]!.id).toBe("local-user-1");
  });
});
