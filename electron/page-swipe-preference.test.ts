import { afterEach, expect, test, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
vi.mock("node:util", () => ({ promisify: () => run }));
import { isFluidPageSwipeEnabled } from "./page-swipe-preference";

afterEach(() => vi.unstubAllGlobals());

test("reads AppKit's page-swipe preference without changing system settings", async () => {
  vi.stubGlobal("process", { ...process, platform: "darwin" });
  run.mockResolvedValue({ stdout: "true\n" });
  expect(await isFluidPageSwipeEnabled()).toBe(true);
  expect(run.mock.calls[0][1]).toContain(
    'ObjC.import("AppKit"); $.NSEvent.isSwipeTrackingFromScrollEventsEnabled',
  );
  run.mockResolvedValue({ stdout: "false\n" });
  expect(await isFluidPageSwipeEnabled()).toBe(false);
});

test("leaves ordinary scrolling alone if the preference cannot be read", async () => {
  vi.stubGlobal("process", { ...process, platform: "darwin" });
  run.mockRejectedValue(new Error("unavailable"));
  expect(await isFluidPageSwipeEnabled()).toBe(false);
  run.mockResolvedValue({ stdout: "unexpected" });
  expect(await isFluidPageSwipeEnabled()).toBe(false);
});

test("does not invoke AppKit on other platforms", async () => {
  vi.stubGlobal("process", { ...process, platform: "win32" });
  expect(await isFluidPageSwipeEnabled()).toBe(false);
  expect(run).not.toHaveBeenCalled();
});
