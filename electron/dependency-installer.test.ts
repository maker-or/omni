import { join } from "node:path";
import os from "node:os";
import { afterEach, describe, expect, test, vi } from "vitest";

const originalPlatform = process.platform;
const originalPath = process.env.PATH;

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform });
  process.env.PATH = originalPath;
  vi.resetModules();
});

describe("dependency installer platform behavior", () => {
  test("prepends GUI paths using Windows separators", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.PATH = "C:\\Windows\\System32";
    const { prependStandardPaths } = await import("./dependency-installer.ts");
    prependStandardPaths();
    expect(process.env.PATH).toContain(";");
    expect(process.env.PATH?.split(";")).toContain("C:\\Windows\\System32");
  });

  test("prepends Homebrew paths on macOS", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    process.env.PATH = "/usr/bin";
    const { prependStandardPaths } = await import("./dependency-installer.ts");
    prependStandardPaths();
    expect(process.env.PATH?.split(":")).toContain("/opt/homebrew/bin");
    expect(process.env.PATH).not.toContain(";");
    expect(process.env.PATH).toContain(join(os.homedir(), ".bun", "bin"));
  });
});
