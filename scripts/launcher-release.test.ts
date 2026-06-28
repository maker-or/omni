import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  createGithubLauncherManifest,
  githubLatestManifestUrl,
  launcherDmgName,
  normalizeGithubRepository,
  resolveReleaseDmg,
  validateManifest,
} from "./launcher-release.ts";

describe("launcher release helpers", () => {
  test("normalizes supported GitHub repository forms", () => {
    expect(normalizeGithubRepository("maker-or/omni")).toBe("maker-or/omni");
    expect(normalizeGithubRepository("https://github.com/maker-or/omni.git")).toBe("maker-or/omni");
    expect(normalizeGithubRepository("git@github.com:maker-or/omni.git")).toBe("maker-or/omni");
    expect(() => normalizeGithubRepository("https://example.com/maker-or/omni")).toThrow();
  });

  test("builds a strict GitHub launcher manifest", () => {
    const manifest = createGithubLauncherManifest("maker-or/omni", "0.0.16", "A".repeat(64));
    expect(validateManifest(manifest)).toEqual({
      schema_version: 1,
      version: "0.0.16",
      url: "https://github.com/maker-or/omni/releases/download/v0.0.16/pipper-0.0.16-arm64.dmg",
      sha256: "a".repeat(64),
    });
    expect(githubLatestManifestUrl("maker-or/omni")).toBe(
      "https://github.com/maker-or/omni/releases/latest/download/latest.json",
    );
  });

  test("rejects expanded and unsafe manifests", () => {
    const manifest = createGithubLauncherManifest("maker-or/omni", "0.0.16", "a".repeat(64));
    expect(() => validateManifest({ ...manifest, notes: "not allowed" })).toThrow();
    expect(() => validateManifest({ ...manifest, url: "http://example.com/pipper.dmg" })).toThrow();
    expect(() => validateManifest({ ...manifest, sha256: "short" })).toThrow();
  });

  test("requires exactly the expected release DMG", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "launcher-release-"));
    try {
      const expected = launcherDmgName("0.0.16");
      await writeFile(path.join(dir, expected), "disk image bytes");
      const resolved = await resolveReleaseDmg("0.0.16", dir);
      expect(resolved.name).toBe(expected);
      expect(resolved.size).toBe("disk image bytes".length);

      await writeFile(path.join(dir, "pipper-0.0.15-arm64.dmg"), "old");
      await expect(resolveReleaseDmg("0.0.16", dir)).rejects.toThrow(
        "must contain exactly pipper-0.0.16-arm64.dmg",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
