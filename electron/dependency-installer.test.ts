import { join } from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";

const originalPlatform = process.platform;
const originalPath = process.env.PATH;

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
  };
});

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform });
  process.env.PATH = originalPath;
  vi.mocked(existsSync).mockReset();
  vi.resetModules();
});

describe("dependency installer platform behavior", () => {
  test("prependStandardPaths uses semicolons on Windows", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.PATH = "C:\\Windows\\System32";
    const { prependStandardPaths } = await import("./dependency-installer.ts");
    prependStandardPaths();
    expect(process.env.PATH).toContain(";");
    expect(process.env.PATH?.split(";")).toContain("C:\\Windows\\System32");
    expect(process.env.PATH).toContain(join(process.env.USERPROFILE ?? "", ".local", "bin"));
  });

  test("prependStandardPaths uses colons on macOS", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    process.env.PATH = "/usr/bin";
    const { prependStandardPaths } = await import("./dependency-installer.ts");
    prependStandardPaths();
    expect(process.env.PATH?.split(":")).toContain("/opt/homebrew/bin");
    expect(process.env.PATH).not.toContain(";");
  });

  test("getMisePath resolves mise.exe candidates on Windows", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const misePath = join(os.homedir(), ".local", "bin", "mise.exe");
    vi.mocked(existsSync).mockImplementation((path) => path === misePath);
    const { getMisePath } = await import("./dependency-installer.ts");
    expect(getMisePath()).toBe(misePath);
  });

  test("installGit skips work when Git is already available", async () => {
    const { installGit } = await import("./dependency-installer.ts");
    await expect(installGit()).resolves.toBeUndefined();
  });
});
