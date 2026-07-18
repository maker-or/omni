import { describe, expect, it } from "vitest";
import {
  buildContinuationText,
  extractConversation,
  formatTranscript,
  hasConversation,
  type TranscriptSourceMessage,
} from "./acp-transcript";

describe("extractConversation", () => {
  it("keeps user and assistant text in order", () => {
    const messages: TranscriptSourceMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
      { role: "user", content: "thanks" },
    ];
    expect(extractConversation(messages)).toEqual([
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi there" },
      { role: "user", text: "thanks" },
    ]);
  });

  it("drops thoughts and tool calls, keeping only text parts of assistant runs", () => {
    const messages: TranscriptSourceMessage[] = [
      { role: "user", content: "run the build" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "let me think about this" },
          { type: "toolCall", id: "t1", name: "bash" },
          { type: "text", text: "Done — the build passed." },
        ],
      },
    ];
    expect(extractConversation(messages)).toEqual([
      { role: "user", text: "run the build" },
      { role: "assistant", text: "Done — the build passed." },
    ]);
  });

  it("excludes non-conversational roles (toolResult) and empty messages", () => {
    const messages: TranscriptSourceMessage[] = [
      { role: "user", content: "  " },
      { role: "toolResult", content: "exit 0" },
      { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "bash" }] },
      { role: "assistant", content: "kept" },
    ];
    expect(extractConversation(messages)).toEqual([{ role: "assistant", text: "kept" }]);
  });

  it("joins multiple text parts within one assistant message", () => {
    const messages: TranscriptSourceMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "part one " },
          { type: "toolCall", id: "t1", name: "bash" },
          { type: "text", text: "part two" },
        ],
      },
    ];
    expect(extractConversation(messages)).toEqual([
      { role: "assistant", text: "part one part two" },
    ]);
  });
});

describe("hasConversation", () => {
  it("is false when nothing carries over", () => {
    expect(hasConversation([])).toBe(false);
    expect(
      hasConversation([
        { role: "toolResult", content: "x" },
        { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "bash" }] },
      ]),
    ).toBe(false);
  });

  it("is true with at least one user/assistant turn", () => {
    expect(hasConversation([{ role: "user", content: "hi" }])).toBe(true);
  });
});

describe("formatTranscript / buildContinuationText", () => {
  it("labels turns and separates them", () => {
    const text = formatTranscript([
      { role: "user", text: "q" },
      { role: "assistant", text: "a" },
    ]);
    expect(text).toBe("User: q\n\nAssistant: a");
  });

  it("wraps the transcript with a continuation preamble containing the body", () => {
    const wrapped = buildContinuationText("User: q\n\nAssistant: a");
    expect(wrapped).toContain("earlier conversation");
    expect(wrapped).toContain("User: q");
    expect(wrapped).toContain("Assistant: a");
  });
});
