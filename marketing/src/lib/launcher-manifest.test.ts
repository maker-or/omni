import { describe, expect, test } from "vitest";
import { compareSemver, isLauncherManifest } from "./launcher-manifest.ts";

describe("launcher manifest helpers", () => {
  test("compareSemver orders semantic versions", () => {
    expect(compareSemver("0.0.20", "0.0.19")).toBeGreaterThan(0);
    expect(compareSemver("0.0.19", "0.0.20")).toBeLessThan(0);
    expect(compareSemver("0.0.20", "0.0.20")).toBe(0);
  });

  test("validates strict launcher manifests", () => {
    const manifest = {
      schema_version: 1,
      version: "0.0.20",
      url: "https://github.com/maker-or/omni/releases/download/v0.0.20/pipper-0.0.20-arm64.dmg",
      sha256: "a".repeat(64),
    };
    expect(isLauncherManifest(manifest, ".dmg")).toBe(true);
    expect(isLauncherManifest(manifest, ".exe")).toBe(false);
  });
});
