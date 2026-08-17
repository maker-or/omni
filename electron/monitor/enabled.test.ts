import { describe, expect, test } from "vitest";
import { isMonitorEnabled } from "./enabled";

describe("isMonitorEnabled", () => {
  test("defaults to on", () => {
    expect(isMonitorEnabled({})).toBe(true);
    expect(isMonitorEnabled({ PIPPER_MONITOR: "" })).toBe(true);
  });

  test("turns off on explicit falsey values", () => {
    expect(isMonitorEnabled({ PIPPER_MONITOR: "0" })).toBe(false);
    expect(isMonitorEnabled({ PIPPER_MONITOR: "false" })).toBe(false);
    expect(isMonitorEnabled({ PIPPER_MONITOR: "OFF" })).toBe(false);
    expect(isMonitorEnabled({ PIPPER_MONITOR_ENABLED: "no" })).toBe(false);
  });

  test("stays on for other values", () => {
    expect(isMonitorEnabled({ PIPPER_MONITOR: "1" })).toBe(true);
    expect(isMonitorEnabled({ PIPPER_MONITOR: "on" })).toBe(true);
  });
});
