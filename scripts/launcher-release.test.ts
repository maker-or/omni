import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  createGithubLauncherManifest,
  createGithubLauncherWindowsManifest,
  githubLatestManifestUrl,
  githubLatestWindowsManifestUrl,
  launcherDmgName,
  launcherWindowsExeName,
  normalizeGithubRepository,
  resolveReleaseDmg,
  resolveReleaseWindowsExe,
  validateManifest,
  validateWindowsManifest,
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

  test("builds a strict GitHub Windows launcher manifest", () => {
    const manifest = createGithubLauncherWindowsManifest("maker-or/omni", "0.0.16", "B".repeat(64));
    expect(validateWindowsManifest(manifest)).toEqual({
      schema_version: 1,
      version: "0.0.16",
      url: "https://github.com/maker-or/omni/releases/download/v0.0.16/pipper-0.0.16-win-x64.exe",
      sha256: "b".repeat(64),
    });
    expect(githubLatestWindowsManifestUrl("maker-or/omni")).toBe(
      "https://github.com/maker-or/omni/releases/latest/download/latest-windows.json",
    );
    expect(launcherWindowsExeName("0.0.16")).toBe("pipper-0.0.16-win-x64.exe");
  });

  test("rejects unsafe Windows manifests", () => {
    const manifest = createGithubLauncherWindowsManifest("maker-or/omni", "0.0.16", "a".repeat(64));
    expect(() =>
      validateWindowsManifest({ ...manifest, url: "http://example.com/pipper.exe" }),
    ).toThrow();
    expect(() =>
      validateWindowsManifest({ ...manifest, url: "https://example.com/pipper.dmg" }),
    ).toThrow();
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

  test("requires exactly the expected release Windows installer", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "launcher-release-win-"));
    try {
      const expected = launcherWindowsExeName("0.0.16");
      await writeFile(path.join(dir, expected), "installer bytes");
      const resolved = await resolveReleaseWindowsExe("0.0.16", dir);
      expect(resolved.name).toBe(expected);
      expect(resolved.size).toBe("installer bytes".length);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
