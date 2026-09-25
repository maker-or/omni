import { describe, expect, test } from "vitest";
import {
  decideOnLaunch,
  nextScheduledRun,
  normalizeScheduleTime,
  shouldRunScheduled,
} from "./schedule.ts";

const at = (h: number, m = 0, day = 22) => new Date(2026, 8, day, h, m);
const settings = { enabled: true, openOnLaunch: true, scheduleTime: "08:00" };
const empty = { latestDate: null, latestGeneratedAt: null, lastShownDate: null };

describe("when the Morning Brief runs", () => {
  test("first launch of the day generates and opens it", () => {
    expect(decideOnLaunch(empty, at(9), settings)).toEqual({ generate: true, open: true });
  });

  test("a later launch the same day neither regenerates nor re-opens", () => {
    const state = {
      latestDate: "2026-09-22",
      latestGeneratedAt: at(9).toISOString(),
      lastShownDate: "2026-09-22",
    };
    expect(decideOnLaunch(state, at(14), settings)).toEqual({ generate: false, open: false });
  });

  test("a brief made before the scheduled time is refreshed once that time passes", () => {
    const state = {
      latestDate: "2026-09-22",
      latestGeneratedAt: at(6).toISOString(),
      lastShownDate: "2026-09-22",
    };
    expect(shouldRunScheduled(state, at(7, 59), settings)).toBe(false);
    expect(shouldRunScheduled(state, at(8, 1), settings)).toBe(true);
  });

  test("waking after a missed schedule catches up; yesterday's brief counts as stale", () => {
    const state = {
      latestDate: "2026-09-21",
      latestGeneratedAt: at(8, 0, 21).toISOString(),
      lastShownDate: "2026-09-21",
    };
    expect(shouldRunScheduled(state, at(10), settings)).toBe(true);
  });

  test("disabled means never", () => {
    expect(decideOnLaunch(empty, at(9), { ...settings, enabled: false })).toEqual({
      generate: false,
      open: false,
    });
    expect(shouldRunScheduled(empty, at(9), { ...settings, enabled: false })).toBe(false);
  });

  test("next run is today if still ahead, otherwise tomorrow", () => {
    expect(nextScheduledRun(at(7), "08:00")).toEqual(at(8));
    expect(nextScheduledRun(at(9), "08:00")).toEqual(at(8, 0, 23));
    expect(normalizeScheduleTime("7:5")).toBe("08:00");
    expect(normalizeScheduleTime("7:05")).toBe("07:05");
  });
});
