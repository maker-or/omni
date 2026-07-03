import { describe, expect, test } from "vitest";
import { resolveLauncherUpdateManifestUrl } from "./launcher-update-config.ts";

describe("launcher update config", () => {
  test("selects platform-specific manifest URLs", () => {
    expect(
      resolveLauncherUpdateManifestUrl({
        platform: "darwin",
        macManifestUrl: "https://example.com/latest.json",
        windowsManifestUrl: "https://example.com/latest-windows.json",
      }),
    ).toBe("https://example.com/latest.json");
    expect(
      resolveLauncherUpdateManifestUrl({
        platform: "win32",
        macManifestUrl: "https://example.com/latest.json",
        windowsManifestUrl: "https://example.com/latest-windows.json",
      }),
    ).toBe("https://example.com/latest-windows.json");
  });

  test("returns null when the active platform manifest is missing", () => {
    expect(
      resolveLauncherUpdateManifestUrl({
        platform: "win32",
        macManifestUrl: "https://example.com/latest.json",
        windowsManifestUrl: null,
      }),
    ).toBeNull();
  });
});
