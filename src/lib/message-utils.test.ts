import { describe, expect, test } from "vitest";
import { stringifyMessageContent } from "./message-utils";

describe("message content stringification", () => {
  test("returns plain string content unchanged", () => {
    expect(stringifyMessageContent({ role: "user", content: "hello" } as never)).toBe("hello");
  });

  test("joins text and thinking parts while ignoring non-text payloads", () => {
    expect(
      stringifyMessageContent({
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Plan" },
          { type: "toolCall", id: "tool-1", name: "bash" },
          { type: "text", text: "Done" },
          { type: "image", data: "aaa", mimeType: "image/png" },
        ],
      } as never),
    ).toBe("Plan\nDone");
  });

  test("treats malformed content as empty visible text", () => {
    expect(stringifyMessageContent({ role: "assistant", content: null } as never)).toBe("");
    expect(
      stringifyMessageContent({
        role: "assistant",
        content: [{ type: "text", text: 42 }, null, "raw"],
      } as never),
    ).toBe("");
  });
});
