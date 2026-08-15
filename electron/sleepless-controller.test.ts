import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SleeplessController, resolveSleeplessHelperPath } from "./sleepless-controller.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pipper-sleepless-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function paths() {
  const helperPath = join(root, "omni-sleeplessctl");
  const settingsPath = join(root, "settings", "sleepless.json");
  writeFileSync(helperPath, "test helper");
  return { helperPath, settingsPath };
}

describe("SleeplessController", () => {
  test("stays disabled and unsupported by default off macOS", async () => {
    const { helperPath, settingsPath } = paths();
    const broadcast = vi.fn();
    const runHelper = vi.fn(async () => JSON.stringify({ status: "enabled" }));
    const controller = new SleeplessController({
      platform: "linux",
      helperPath,
      settingsPath,
      broadcast,
      runHelper,
    });

    const status = await controller.initialize();

    expect(status.supported).toBe(false);
    expect(status.serviceStatus).toBe("unsupported");
    expect(status.phase).toBe("disabled");
    expect(status.preferences.enabled).toBe(false);
    expect(runHelper).not.toHaveBeenCalled();
    await controller.dispose();
  });

  test("registers only after opt-in and persists safe preferences", async () => {
    const { helperPath, settingsPath } = paths();
    const commands: string[] = [];
    const controller = new SleeplessController({
      platform: "darwin",
      helperPath,
      settingsPath,
      broadcast: vi.fn(),
      runHelper: async (_path, command) => {
        commands.push(command);
        return JSON.stringify({ status: command === "status" ? "not-registered" : "enabled" });
      },
    });

    await controller.initialize();
    expect(commands).toEqual(["status"]);

    const status = await controller.setEnabled(true);

    expect(commands).toEqual(["status", "register"]);
    expect(status.serviceStatus).toBe("enabled");
    expect(status.phase).toBe("disarmed");
    expect(status.preferences).toMatchObject({ enabled: true, acOnly: true, batteryFloor: 20 });
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toMatchObject({ enabled: true });
    await controller.dispose();
  });

  test("clamps persisted safety values before exposing or saving them", async () => {
    const { helperPath, settingsPath } = paths();
    const controller = new SleeplessController({
      platform: "darwin",
      helperPath,
      settingsPath,
      broadcast: vi.fn(),
      runHelper: async () => JSON.stringify({ status: "enabled" }),
    });
    await controller.initialize();

    const status = await controller.setPreferences({
      acOnly: false,
      batteryFloor: 2,
      maxDurationMinutes: 10_000,
    });

    expect(status.preferences).toEqual({
      enabled: false,
      acOnly: false,
      batteryFloor: 10,
      maxDurationMinutes: 720,
    });
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual(status.preferences);
    await controller.dispose();
  });

  test("reports a missing packaged helper without attempting registration", async () => {
    const settingsPath = join(root, "sleepless.json");
    const runHelper = vi.fn(async () => JSON.stringify({ status: "enabled" }));
    const controller = new SleeplessController({
      platform: "darwin",
      helperPath: join(root, "missing-helper"),
      settingsPath,
      broadcast: vi.fn(),
      runHelper,
    });

    await controller.initialize();
    const status = await controller.setEnabled(true);

    expect(status.serviceStatus).toBe("not-found");
    expect(status.phase).toBe("error");
    expect(status.error).toContain("helper is missing");
    expect(runHelper).not.toHaveBeenCalled();
    await controller.dispose();
  });
});

test("resolveSleeplessHelperPath places the helper beside the app executable", () => {
  expect(resolveSleeplessHelperPath("/Applications/Pipper.app/Contents/MacOS/Pipper")).toBe(
    "/Applications/Pipper.app/Contents/MacOS/omni-sleeplessctl",
  );
});
