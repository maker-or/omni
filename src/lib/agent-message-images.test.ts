import { describe, expect, test } from "vitest";
import {
  extractMessageImages,
  fileToPromptImage,
  MAX_AGENT_IMAGES,
  partitionValidImageFiles,
} from "./agent-message-images";

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

  test("ignores malformed image parts", () => {
    const images = extractMessageImages({
      role: "user",
      content: [
        { type: "image", data: "aaa" },
        { type: "image", mimeType: "image/png" },
        { type: "image", data: "bbb", mimeType: "image/png" },
      ],
    } as never);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ data: "bbb", mimeType: "image/png" });
  });

  test("rejects unsupported, oversized, and excess files", () => {
    const valid = new File(["x"], "ok.png", { type: "image/png" });
    const excess = new File(["x"], "extra.webp", { type: "image/webp" });
    const unsupported = new File(["x"], "bad.svg", { type: "image/svg+xml" });
    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.gif", {
      type: "image/gif",
    });
    const result = partitionValidImageFiles([valid, excess, unsupported, oversized], 4);
    expect(result.valid).toEqual([valid]);
    expect(result.errors).toHaveLength(3);
  });

  test("counts retained edit images toward the prompt image cap", () => {
    const files = Array.from({ length: MAX_AGENT_IMAGES }, (_, index) => {
      return new File(["x"], `image-${index}.png`, { type: "image/png" });
    });

    const result = partitionValidImageFiles(files, 2);

    expect(result.valid).toHaveLength(3);
    expect(result.errors).toEqual([
      "A prompt can contain at most 5 images.",
      "A prompt can contain at most 5 images.",
    ]);
  });

  test("converts validated files to base64 prompt images", async () => {
    const image = await fileToPromptImage(new File(["hello"], "ok.webp", { type: "image/webp" }));
    expect(image).toEqual({
      type: "image",
      data: "aGVsbG8=",
      mimeType: "image/webp",
    });
  });
});
