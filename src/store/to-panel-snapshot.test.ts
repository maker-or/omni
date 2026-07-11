import { describe, expect, test, beforeEach } from "vitest";
import { toPanelSnapshot } from "./agent-store";
import { projectChatMessages, projectToolResultMessages } from "../lib/acp-entries";
import {
  applySessionUpdate,
  createEmptySessionSlice,
  resetEntryIdCounter,
  type AcpSessionSlice,
} from "../lib/acp-session-reducer";
import type { AcpSessionState } from "../../contracts/acp.ts";

function baseState(patch: Partial<AcpSessionState> = {}): AcpSessionState {
  return {
    projectId: "p1",
    threadId: "t1",
    agentId: "pipper-mock",
    agentSessionId: "s1",
    cwd: "/tmp",
    title: null,
    configOptions: [],
    commands: [],
    entries: [],
    toolCalls: {},
    plan: null,
    usage: null,
    currentModeId: null,
    isStreaming: false,
    isCompacting: false,
    editorText: "",
    authRequiredMessage: null,
    switchingAgent: false,
    ...patch,
  };
}

function stateFromSlice(slice: AcpSessionSlice, patch: Partial<AcpSessionState> = {}) {
  return baseState({
    entries: slice.entries,
    toolCalls: slice.toolCalls,
    isStreaming: slice.isStreaming,
    usage: slice.usage,
    ...patch,
  });
}

describe("entry projection / toPanelSnapshot", () => {
  beforeEach(() => resetEntryIdCounter());

  test("maps thought and toolCalls into MessageBody array content parts", () => {
    const messages = projectChatMessages(
      [
        { type: "agent_thought", id: "e1", messageId: null, text: "Considering…" },
        { type: "tool_call", id: "e2", toolCallId: "tc1" },
        { type: "agent_text", id: "e3", messageId: null, text: "Done" },
      ],
      {
        tc1: {
          toolCallId: "tc1",
          title: "Read file",
          kind: "read",
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: "ok" } }],
        },
      },
      false,
    );

    expect(messages).toHaveLength(1);
    const parts = messages[0]!.content;
    expect(parts.some((p) => p.type === "thinking" && p.thinking === "Considering…")).toBe(true);
    expect(
      parts.some((p) => p.type === "toolCall" && p.id === "tc1" && p.name === "Read file"),
    ).toBe(true);
    expect(parts.some((p) => p.type === "text" && p.text === "Done")).toBe(true);
  });

  test("interleaved text → tool → text renders parts in timeline order", () => {
    let slice = createEmptySessionSlice();
    slice = applySessionUpdate(slice, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Let me check. " },
    });
    slice = applySessionUpdate(slice, {
      sessionUpdate: "tool_call",
      toolCallId: "tc1",
      title: "Read file",
      status: "completed",
    });
    slice = applySessionUpdate(slice, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Found it." },
    });

    const messages = projectChatMessages(slice.entries, slice.toolCalls, false);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content.map((p) => p.type)).toEqual(["text", "toolCall", "text"]);
  });

  test("toPanelSnapshot exposes trace parts and synthetic toolResult messages", () => {
    const state = baseState({
      entries: [
        { type: "user_text", id: "u1", messageId: null, text: "hi" },
        { type: "agent_thought", id: "a1", messageId: null, text: "plan" },
        { type: "tool_call", id: "a2", toolCallId: "tc-term" },
        { type: "agent_text", id: "a3", messageId: null, text: "result" },
      ],
      toolCalls: {
        "tc-term": {
          toolCallId: "tc-term",
          title: "Run shell",
          kind: "execute",
          status: "completed",
          content: [{ type: "terminal", terminalId: "term-abc" }],
        },
      },
    });

    const snapshot = toPanelSnapshot(state);
    expect(snapshot).not.toBeNull();
    const assistant = snapshot!.messages.find((m) => m.id === "a1");
    expect(Array.isArray(assistant?.content)).toBe(true);
    const content = assistant!.content as Array<Record<string, unknown>>;
    expect(content.some((p) => p.type === "thinking")).toBe(true);
    const toolPart = content.find((p) => p.type === "toolCall");
    expect(toolPart?.id).toBe("tc-term");
    expect(
      Array.isArray(toolPart?.content) &&
        (toolPart!.content as Array<{ type?: string; terminalId?: string }>).some(
          (b) => b.type === "terminal" && b.terminalId === "term-abc",
        ),
    ).toBe(true);

    const toolResult = snapshot!.messages.find((m) => m.role === "toolResult");
    expect(toolResult?.toolCallId).toBe("tc-term");
    expect(toolResult?.terminalIds).toContain("term-abc");
  });

  test("streaming assistant is only in streamingMessage, not duplicated in messages", () => {
    const snapshot = toPanelSnapshot(
      baseState({
        isStreaming: true,
        entries: [
          { type: "agent_thought", id: "a-stream", messageId: null, text: "hmm" },
          { type: "agent_text", id: "a-text", messageId: null, text: "partial" },
        ],
      }),
    );
    expect(snapshot?.streamingMessage?.id).toBe("a-stream");
    expect(Array.isArray(snapshot?.streamingMessage?.content)).toBe(true);
    expect(snapshot?.messages.some((m) => m.id === "a-stream")).toBe(false);
  });

  test("a no-messageId streaming turn keeps its full trace in one streamingMessage", () => {
    let slice = createEmptySessionSlice();
    slice = applySessionUpdate(slice, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "Thinking. " },
    });
    slice = applySessionUpdate(slice, {
      sessionUpdate: "tool_call",
      toolCallId: "tc1",
      title: "Read file",
      kind: "read",
      status: "completed",
    });
    slice = applySessionUpdate(slice, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Here is " },
    });
    slice = applySessionUpdate(slice, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "the answer." },
    });

    const snapshot = toPanelSnapshot(stateFromSlice(slice));
    const content = snapshot!.streamingMessage!.content as Array<Record<string, unknown>>;
    const text = content
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");
    expect(text).toBe("Here is the answer.");
    expect(content.some((p) => p.type === "thinking" && p.thinking === "Thinking. ")).toBe(true);
    expect(content.some((p) => p.type === "toolCall" && p.id === "tc1")).toBe(true);
    // Nothing dropped into a second, invisible streaming assistant.
    expect(snapshot!.messages.filter((m) => m.role === "assistant")).toHaveLength(0);
  });

  test("messageEntryRefs align with messages indices (user rows only)", () => {
    const snapshot = toPanelSnapshot(
      baseState({
        entries: [
          { type: "user_text", id: "u1", messageId: null, text: "one" },
          { type: "agent_text", id: "a1", messageId: null, text: "reply" },
          { type: "user_text", id: "u2", messageId: null, text: "two" },
        ],
      }),
    );
    const messages = snapshot!.messages;
    const refs = snapshot!.messageEntryRefs;
    expect(refs).toHaveLength(messages.length);
    messages.forEach((m, i) => {
      if (m.role === "user") {
        expect(refs[i]?.entryId).toBe(m.id);
      } else {
        expect(refs[i]).toBeNull();
      }
    });
  });

  test("projectToolResultMessages marks failed tools as isError", () => {
    const results = projectToolResultMessages({
      f1: {
        toolCallId: "f1",
        title: "Fail",
        status: "failed",
        content: [],
      },
    });
    expect(results[0]?.isError).toBe(true);
  });

  describe("referential stability (render performance)", () => {
    test("settled messages keep identity while a later message streams", () => {
      let slice = createEmptySessionSlice();
      // Settled history: user question + full assistant turn with a tool.
      slice = applySessionUpdate(slice, {
        sessionUpdate: "user_message_chunk",
        messageId: "u1",
        content: { type: "text", text: "question" },
      });
      slice = applySessionUpdate(slice, {
        sessionUpdate: "tool_call",
        toolCallId: "tc1",
        title: "Read",
        status: "completed",
      });
      slice = applySessionUpdate(slice, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "answered" },
      });
      // New user turn, agent starts streaming.
      slice = applySessionUpdate(slice, {
        sessionUpdate: "user_message_chunk",
        messageId: "u2",
        content: { type: "text", text: "next question" },
      });
      slice = applySessionUpdate(slice, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "streaming…" },
      });

      const before = toPanelSnapshot(stateFromSlice(slice))!;
      // A streamed chunk arrives.
      slice = applySessionUpdate(slice, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: " more" },
      });
      const after = toPanelSnapshot(stateFromSlice(slice))!;

      // Every settled row keeps identity — memoized components skip re-render.
      expect(after.messages[0]).toBe(before.messages[0]); // user 1
      expect(after.messages[1]).toBe(before.messages[1]); // settled assistant turn
      expect(after.messages[2]).toBe(before.messages[2]); // user 2
      // Only the streaming message changes.
      expect(after.streamingMessage).not.toBe(before.streamingMessage);
    });

    test("unrelated updates (usage) keep the whole messages array identity", () => {
      let slice = createEmptySessionSlice();
      slice = applySessionUpdate(slice, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hello" },
      });
      const before = toPanelSnapshot(stateFromSlice(slice))!;
      slice = applySessionUpdate(slice, {
        sessionUpdate: "usage_update",
        used: 500,
        size: 200000,
      } as never);
      const after = toPanelSnapshot(stateFromSlice(slice))!;

      expect(after.messages).toBe(before.messages);
      expect(after.usage?.used).toBe(500);
    });

    test("long streaming turn causes zero settled-row churn (stress)", () => {
      // 40 settled turns of history, then one turn streaming 500 chunks with
      // interleaved tool updates. Settled rows must never change identity —
      // this is the property that lets memoized rows skip re-rendering.
      let slice = createEmptySessionSlice();
      for (let turn = 0; turn < 40; turn++) {
        slice = applySessionUpdate(slice, {
          sessionUpdate: "user_message_chunk",
          messageId: `u${turn}`,
          content: { type: "text", text: `question ${turn}` },
        });
        slice = applySessionUpdate(slice, {
          sessionUpdate: "tool_call",
          toolCallId: `tc${turn}`,
          title: "Read",
          status: "completed",
        });
        slice = applySessionUpdate(slice, {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `answer ${turn}` },
        });
      }
      slice = applySessionUpdate(slice, {
        sessionUpdate: "user_message_chunk",
        messageId: "u-live",
        content: { type: "text", text: "live question" },
      });

      let previous = toPanelSnapshot(stateFromSlice(slice))!;
      const settledCount = previous.messages.length;
      let churn = 0;
      const started = performance.now();
      for (let i = 0; i < 500; i++) {
        slice = applySessionUpdate(
          slice,
          i % 25 === 0
            ? {
                sessionUpdate: "tool_call",
                toolCallId: `live-tc${i}`,
                title: "Search",
                status: "in_progress",
              }
            : {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: `chunk ${i} ` },
              },
        );
        const next = toPanelSnapshot(stateFromSlice(slice))!;
        for (let m = 0; m < settledCount; m++) {
          if (next.messages[m] !== previous.messages[m]) churn++;
        }
        previous = next;
      }
      const elapsed = performance.now() - started;
      // eslint-disable-next-line no-console
      console.log(
        `stress: 500 updates over ${settledCount} settled rows in ${elapsed.toFixed(1)}ms, settled churn=${churn}`,
      );

      expect(churn).toBe(0);
      // The streaming turn accumulated every chunk.
      expect(
        (previous.streamingMessage!.content as Array<Record<string, unknown>>).some(
          (p) => p.type === "text" && typeof p.text === "string" && p.text.includes("chunk 499"),
        ),
      ).toBe(true);
    });

    test("tool_call_update re-derives only the affected run", () => {
      let slice = createEmptySessionSlice();
      slice = applySessionUpdate(slice, {
        sessionUpdate: "user_message_chunk",
        messageId: "u1",
        content: { type: "text", text: "q" },
      });
      slice = applySessionUpdate(slice, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "done" },
      });
      slice = applySessionUpdate(slice, {
        sessionUpdate: "user_message_chunk",
        messageId: "u2",
        content: { type: "text", text: "q2" },
      });
      slice = applySessionUpdate(slice, {
        sessionUpdate: "tool_call",
        toolCallId: "tc1",
        title: "Build",
        status: "in_progress",
      });

      const before = toPanelSnapshot(stateFromSlice(slice))!;
      slice = applySessionUpdate(slice, {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc1",
        status: "completed",
      });
      const after = toPanelSnapshot(stateFromSlice(slice))!;

      // Settled first turn untouched.
      expect(after.messages[0]).toBe(before.messages[0]);
      expect(after.messages[1]).toBe(before.messages[1]);
      // The run holding tc1 re-derived with the new status.
      const updated = after.streamingMessage ?? after.messages[after.messages.length - 1];
      const toolPart = (updated!.content as Array<Record<string, unknown>>).find(
        (p) => p.type === "toolCall",
      );
      expect(toolPart?.status).toBe("completed");
    });
  });
});
