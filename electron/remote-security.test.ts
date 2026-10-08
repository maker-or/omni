import { describe, expect, it } from "vitest";
import {
  HttpError,
  WindowLimiter,
  bearerToken,
  parseJsonObject,
  parsePromptImages,
  resolveWithin,
  sanitizeLogText,
  tokensEqual,
} from "./remote-security.ts";

describe("remote security helpers", () => {
  it("matches tokens only on exact equality", () => {
    expect(tokensEqual("abc", "abc")).toBe(true);
    expect(tokensEqual("abc", "abd")).toBe(false);
    expect(tokensEqual("abc", "abcd")).toBe(false);
    expect(tokensEqual("", "")).toBe(false);
  });

  it("extracts only well-formed bearer credentials", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("Bearer  abc")).toBe("");
    expect(bearerToken("Basic abc")).toBe("");
    expect(bearerToken(undefined)).toBe("");
  });

  it("refuses past the limit and recovers when the window slides", () => {
    const limiter = new WindowLimiter({ limit: 2, windowMs: 1_000 });
    expect(limiter.consume("k", 0)).toBe(0);
    expect(limiter.consume("k", 100)).toBe(0);
    expect(limiter.consume("k", 200)).toBe(1);
    expect(limiter.consume("other", 200)).toBe(0);
    expect(limiter.consume("k", 1_001)).toBe(0);
  });

  it("keeps a bounded number of keys", () => {
    const limiter = new WindowLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 });
    limiter.record("a", 0);
    limiter.record("b", 0);
    limiter.record("c", 0);
    // "a" was evicted as least recently active, so it is admitted again.
    expect(limiter.retryAfterSec("a", 1)).toBe(0);
    expect(limiter.retryAfterSec("c", 1)).toBeGreaterThan(0);
  });

  it("parses only JSON objects and maps bad input to 400", () => {
    expect(parseJsonObject("")).toEqual({});
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    for (const bad of ["{oops", "[1]", "null", "3"]) {
      expect(() => parseJsonObject(bad)).toThrow(HttpError);
    }
  });

  it("confines static paths to the root", () => {
    expect(resolveWithin("/srv/app", "assets/a.js")).toBe("/srv/app/assets/a.js");
    expect(resolveWithin("/srv/app", "../secret")).toBeNull();
    expect(resolveWithin("/srv/app", "/etc/passwd")).toBeNull();
    expect(resolveWithin("/srv/app", "")).toBeNull();
  });

  it("strips control characters from logged remote text", () => {
    expect(sanitizeLogText("ok\n[Main] forged\r\u001b[31m")).toBe("ok [Main] forged [31m");
    expect(sanitizeLogText("x".repeat(10), 4)).toBe("xxxx");
  });

  it("accepts only real images of the declared type", () => {
    const b64 = (bytes: number[]) => Buffer.from(bytes).toString("base64");
    const jpeg = { data: b64([0xff, 0xd8, 0xff, 0xe0, 0, 0]), mimeType: "image/jpeg" };
    const webp = {
      data: b64([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      mimeType: "image/webp",
    };
    expect(parsePromptImages(undefined)).toEqual([]);
    expect(parsePromptImages([jpeg, webp])).toEqual([jpeg, webp]);
    expect(() => parsePromptImages([{ ...jpeg, mimeType: "image/webp" }])).toThrow(HttpError);
    expect(() => parsePromptImages([{ ...jpeg, mimeType: "image/svg+xml" }])).toThrow(HttpError);
    expect(() => parsePromptImages("nope")).toThrow(HttpError);
  });
});
