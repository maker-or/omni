import { describe, expect, test } from "vitest";
import { toPanelMessageContent, toPanelSnapshot, toPanelToolResultMessages } from "./agent-store";
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
    messages: [],
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

describe("toPanelMessageContent / toPanelSnapshot", () => {
  test("maps thought and toolCalls into MessageBody array content parts", () => {
    const toolCalls = {
      tc1: {
        toolCallId: "tc1",
        title: "Read file",
        kind: "read" as const,
        status: "completed" as const,
        content: [{ type: "content" as const, content: { type: "text" as const, text: "ok" } }],
      },
    };
    const parts = toPanelMessageContent(
      {
        id: "a1",
        role: "assistant",
        text: "Done",
        thought: "Considering…",
        toolCallIds: ["tc1"],
        streaming: false,
      },
      toolCalls,
    );

    expect(parts.some((p) => p.type === "thinking" && p.thinking === "Considering…")).toBe(true);
    expect(
      parts.some((p) => p.type === "toolCall" && p.id === "tc1" && p.name === "Read file"),
    ).toBe(true);
    expect(parts.some((p) => p.type === "text" && p.text === "Done")).toBe(true);
  });

  test("toPanelSnapshot exposes thinking/toolCall parts and synthetic toolResult messages", () => {
    const state = baseState({
      messages: [
        {
          id: "u1",
          role: "user",
          text: "hi",
          thought: "",
          toolCallIds: [],
          streaming: false,
        },
        {
          id: "a1",
          role: "assistant",
          text: "result",
          thought: "plan",
          toolCallIds: ["tc-term"],
          streaming: false,
        },
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
        messages: [
          {
            id: "a-stream",
            role: "assistant",
            text: "partial",
            thought: "hmm",
            toolCallIds: [],
            streaming: true,
          },
        ],
      }),
    );
    expect(snapshot?.streamingMessage?.id).toBe("a-stream");
    expect(Array.isArray(snapshot?.streamingMessage?.content)).toBe(true);
    expect(snapshot?.messages.some((m) => m.id === "a-stream")).toBe(false);
  });

  test("toPanelToolResultMessages marks failed tools as isError", () => {
    const results = toPanelToolResultMessages({
      f1: {
        toolCallId: "f1",
        title: "Fail",
        status: "failed",
        content: [],
      },
    });
    expect(results[0]?.isError).toBe(true);
  });
});
