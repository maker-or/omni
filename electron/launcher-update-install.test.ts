import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { describe, expect, test, vi } from "vitest";
import { launchLauncherInstaller } from "./launcher-update-install.ts";

vi.mock("electron", () => ({
  shell: { openPath: vi.fn() },
}));

function fakeChildProcess(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.unref = vi.fn(() => child);
  return child;
}

describe("launcher update installer launch", () => {
  test("spawns Windows installers as detached visible processes", async () => {
    const child = fakeChildProcess();
    const spawnImpl = vi.fn(() => child);
    const launched = launchLauncherInstaller("C:\\Temp\\pipper-0.0.21-win-x64.exe", {
      platform: "win32",
      spawnImpl,
    });

    child.emit("spawn");
    await launched;

    expect(spawnImpl).toHaveBeenCalledWith("C:\\Temp\\pipper-0.0.21-win-x64.exe", [], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    expect(child.unref).toHaveBeenCalled();
  });

  test("reports Windows installer spawn errors before quitting", async () => {
    const child = fakeChildProcess();
    const spawnImpl = vi.fn(() => child);
    const launched = launchLauncherInstaller("C:\\Temp\\missing.exe", {
      platform: "win32",
      spawnImpl,
    });

    child.emit("error", new Error("ENOENT"));

    await expect(launched).rejects.toThrow("ENOENT");
    expect(child.unref).not.toHaveBeenCalled();
  });

  test("keeps non-Windows installer opening on Electron shell.openPath", async () => {
    const openPath = vi.fn().mockResolvedValue("");

    await launchLauncherInstaller("/tmp/pipper-0.0.21-arm64.dmg", {
      platform: "darwin",
      openPath,
    });

    expect(openPath).toHaveBeenCalledWith("/tmp/pipper-0.0.21-arm64.dmg");
  });

  test("surfaces shell.openPath errors", async () => {
    const openPath = vi.fn().mockResolvedValue("No application can open this file.");

    await expect(
      launchLauncherInstaller("/tmp/pipper-0.0.21-arm64.dmg", {
        platform: "darwin",
        openPath,
      }),
    ).rejects.toThrow("No application can open this file.");
  });
});
