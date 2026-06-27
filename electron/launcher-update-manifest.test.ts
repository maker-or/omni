import { describe, expect, test } from "vitest";
import {
  compareLauncherVersions,
  parseLauncherUpdateManifest,
} from "./launcher-update-manifest.ts";

const manifest = {
  schema_version: 1,
  version: "0.2.0",
  url: "https://example.com/desktop/pipper-0.2.0-arm64.dmg",
  sha256: "A".repeat(64),
} as const;

describe("launcher update manifest", () => {
  test("compares release and prerelease versions", () => {
    expect(compareLauncherVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareLauncherVersions("0.2.0", "0.2.0-beta.1")).toBeGreaterThan(0);
    expect(compareLauncherVersions("0.2.0-beta.2", "0.2.0-beta.10")).toBeLessThan(0);
  });

  test("accepts and normalizes the exact four-field schema", () => {
    expect(parseLauncherUpdateManifest(manifest, "0.1.0")).toEqual({
      ...manifest,
      sha256: "a".repeat(64),
    });
  });

  test("returns no update for equal or older releases", () => {
    expect(parseLauncherUpdateManifest(manifest, "0.2.0")).toBeNull();
    expect(parseLauncherUpdateManifest(manifest, "0.3.0")).toBeNull();
  });

  test("rejects unknown fields and unsafe artifacts", () => {
    expect(() => parseLauncherUpdateManifest({ ...manifest, notes: "no" }, "0.1.0")).toThrow();
    expect(() =>
      parseLauncherUpdateManifest({ ...manifest, url: "http://example.com/a.dmg" }, "0.1.0"),
    ).toThrow();
    expect(() =>
      parseLauncherUpdateManifest({ ...manifest, url: "https://example.com/a.zip" }, "0.1.0"),
    ).toThrow();
    expect(() =>
      parseLauncherUpdateManifest(Object.assign(Object.create(null), manifest), "0.1.0"),
    ).toThrow();
  });
});
