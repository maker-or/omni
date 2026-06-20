import { describe, expect, test } from "bun:test";
import { extractMessageImages, partitionValidImageFiles } from "./agent-message-images";

describe("agent message images", () => {
  test("extracts image parts in order and ignores other content", () => {
    const images = extractMessageImages({
      role: "user",
      content: [
        { type: "text", text: "look" },
        { type: "image", data: "aaa", mimeType: "image/png" },
        { type: "thinking", thinking: "hidden" },
        { type: "image", data: "bbb", mimeType: "image/webp" },
      ],
    } as never);
    expect(images.map(({ data, mimeType }) => ({ data, mimeType }))).toEqual([
      { data: "aaa", mimeType: "image/png" },
      { data: "bbb", mimeType: "image/webp" },
    ]);
  });

  test("rejects unsupported, oversized, and excess files", () => {
    const valid = new File(["x"], "ok.png", { type: "image/png" });
    const unsupported = new File(["x"], "bad.svg", { type: "image/svg+xml" });
    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.gif", {
      type: "image/gif",
    });
    const result = partitionValidImageFiles([valid, unsupported, oversized], 4);
    expect(result.valid).toEqual([valid]);
    expect(result.errors).toHaveLength(2);
  });
});
