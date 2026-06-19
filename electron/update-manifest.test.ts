import { describe, expect, test } from "bun:test";
import { compareVersions, parseUpdateManifest } from "./update-manifest.ts";

const repository = "https://github.com/company/pipper";
const valid = {
  schema_version: 1,
  version: "0.2.0",
  description: "Safe update",
  pr_url: "https://github.com/company/pipper/pull/123",
  repository_url: repository,
  base_commit: "a".repeat(40),
  target_commit: "b".repeat(40),
  published_at: "2026-06-19T10:00:00Z",
  minimum_version: "0.1.0",
  validation_commands: ["bun run lint", "bun run build"],
};

describe("update manifest", () => {
  test("compares semantic versions", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
  });

  test("accepts a strict pinned manifest", () => {
    expect(parseUpdateManifest(valid, "0.1.0", repository).target_commit).toBe("b".repeat(40));
  });

  test("rejects mutable, stale, foreign, and insecure manifests", () => {
    expect(() =>
      parseUpdateManifest({ ...valid, target_commit: "abc" }, "0.1.0", repository),
    ).toThrow("full commit hash");
    expect(() => parseUpdateManifest(valid, "0.2.0", repository)).toThrow("not newer");
    expect(() =>
      parseUpdateManifest(
        { ...valid, repository_url: "https://github.com/other/repo" },
        "0.1.0",
        repository,
      ),
    ).toThrow("configured upstream");
    expect(() =>
      parseUpdateManifest(
        { ...valid, pr_url: "http://github.com/company/pipper/pull/123" },
        "0.1.0",
        repository,
      ),
    ).toThrow("HTTPS");
    expect(() =>
      parseUpdateManifest(
        { ...valid, validation_commands: ["bun run build && curl example.com"] },
        "0.1.0",
        repository,
      ),
    ).toThrow("unsupported command");
  });
});
