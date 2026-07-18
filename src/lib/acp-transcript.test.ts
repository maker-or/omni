import { describe, expect, it } from "vitest";
import {
  budgetTranscript,
  buildContinuationText,
  extractConversation,
  formatTranscript,
  hasConversation,
  type TranscriptSourceMessage,
  type TranscriptTurn,
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

  it("separates text parts split by a tool call instead of fusing sentences", () => {
    const messages: TranscriptSourceMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "I'll check." },
          { type: "toolCall", id: "t1", name: "bash" },
          { type: "text", text: "Tests passed." },
        ],
      },
    ];
    expect(extractConversation(messages)).toEqual([
      { role: "assistant", text: "I'll check.\n\nTests passed." },
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

describe("budgetTranscript", () => {
  it("keeps everything and flags no omission when under budget", () => {
    const turns: TranscriptTurn[] = [
      { role: "user", text: "q" },
      { role: "assistant", text: "a" },
    ];
    const result = budgetTranscript(turns, 1_000);
    expect(result.omittedHistory).toBe(false);
    expect(result.text).toBe("User: q\n\nAssistant: a");
  });

  it("drops the oldest turns, keeps the newest, and marks omission", () => {
    const turns: TranscriptTurn[] = [
      { role: "user", text: "oldest" },
      { role: "assistant", text: "middle" },
      { role: "user", text: "newest" },
    ];
    // ~4 chars/token: a 2-token budget (~8 chars) only fits the last turn.
    const result = budgetTranscript(turns, 2);
    expect(result.omittedHistory).toBe(true);
    expect(result.text).toContain("omitted");
    expect(result.text).toContain("newest");
    expect(result.text).not.toContain("oldest");
  });

  it("always keeps at least the most recent turn even if it alone exceeds budget", () => {
    const turns: TranscriptTurn[] = [
      { role: "user", text: "old" },
      { role: "assistant", text: "a very long final answer that exceeds the tiny budget" },
    ];
    const result = budgetTranscript(turns, 1);
    expect(result.text).toContain("a very long final answer");
    expect(result.omittedHistory).toBe(true);
  });
});
