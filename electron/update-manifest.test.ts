import { describe, expect, test } from "bun:test";
import { compareVersions, parseUpdateManifest } from "./update-manifest.ts";

const repository = "https://github.com/company/pipper";
const valid = {
  schema_version: 1,
  version: "0.2.0",
  description: "Safe update",
  pr_url: "https://github.com/company/pipper/pull/123",
  files_changes: ["src/App.tsx", "package.json"],
};

describe("update manifest", () => {
  test("compares semantic versions", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
  });

  test("accepts a strict PR manifest", () => {
    expect(parseUpdateManifest(valid, "0.1.0", repository).version).toBe("0.2.0");
  });

  test("rejects stale, foreign, insecure, and expanded manifests", () => {
    expect(() => parseUpdateManifest(valid, "0.2.0", repository)).toThrow("not newer");
    expect(() =>
      parseUpdateManifest(
        { ...valid, pr_url: "http://github.com/company/pipper/pull/123" },
        "0.1.0",
        repository,
      ),
    ).toThrow("HTTPS");
    expect(() =>
      parseUpdateManifest(
        { ...valid, pr_url: "https://github.com/other/repo/pull/123" },
        "0.1.0",
        repository,
      ),
    ).toThrow("configured repository");
    expect(() =>
      parseUpdateManifest(
        { ...valid, validation_commands: ["bun run build"] },
        "0.1.0",
        repository,
      ),
    ).toThrow("Unknown manifest fields");
    expect(() =>
      parseUpdateManifest({ ...valid, files_changes: ["../secret"] }, "0.1.0", repository),
    ).toThrow("unsafe path");
  });
});
