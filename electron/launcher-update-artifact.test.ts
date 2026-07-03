import { describe, expect, test } from "vitest";
import {
  launcherArtifactExtension,
  launcherArtifactFileName,
  launcherManagedDownloadPattern,
  resolveLauncherUpdatePlatform,
} from "./launcher-update-artifact.ts";

describe("launcher update artifacts", () => {
  test("resolves supported launcher platforms", () => {
    expect(resolveLauncherUpdatePlatform("darwin")).toBe("darwin");
    expect(resolveLauncherUpdatePlatform("win32")).toBe("win32");
    expect(() => resolveLauncherUpdatePlatform("linux")).toThrow();
  });

  test("names platform-specific installer files", () => {
    expect(launcherArtifactFileName("0.0.20", "darwin")).toBe("pipper-0.0.20-arm64.dmg");
    expect(launcherArtifactFileName("0.0.20", "win32")).toBe("pipper-0.0.20-win-x64.exe");
    expect(launcherArtifactExtension("darwin")).toBe(".dmg");
    expect(launcherArtifactExtension("win32")).toBe(".exe");
  });

  test("accepts only managed download filenames", () => {
    const macPattern = launcherManagedDownloadPattern("darwin");
    const winPattern = launcherManagedDownloadPattern("win32");
    expect(macPattern.test("pipper-0.0.20-arm64.dmg")).toBe(true);
    expect(macPattern.test("pipper-0.0.20-arm64.dmg.partial")).toBe(true);
    expect(macPattern.test("pipper-0.0.20-win-x64.exe")).toBe(false);
    expect(winPattern.test("pipper-0.0.20-win-x64.exe")).toBe(true);
    expect(winPattern.test("pipper-0.0.20-win-x64.exe.partial")).toBe(true);
    expect(winPattern.test("pipper-0.0.20-arm64.dmg")).toBe(false);
  });
});
