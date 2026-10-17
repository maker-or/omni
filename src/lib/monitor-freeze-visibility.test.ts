// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import {
  beginRendererInteraction,
  startMonitorFreezeObserver,
} from "./monitor-runtime-observer.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function observe() {
  vi.useFakeTimers();
  let time = 0;
  let hidden = false;
  let frame!: FrameRequestCallback;
  let requests = 0;
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    hidden ? "hidden" : "visible",
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    requests += 1;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const report = vi.fn();
  const stop = startMonitorFreezeObserver(
    { observerId: "test", getActiveThreadId: () => null, getRunningThreadIds: () => [] },
    report,
  );
  return {
    report,
    stop,
    requests: () => requests,
    frame: (timestamp: number) => {
      time = timestamp;
      frame(timestamp);
    },
    visibility: (value: boolean, timestamp: number) => {
      time = timestamp;
      hidden = value;
      document.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

test("background throttling and the first foreground frame do not create freeze incidents", () => {
  const observer = observe();
  observer.visibility(true, 10);
  vi.advanceTimersByTime(60_000);
  observer.frame(60_010);
  observer.visibility(false, 60_010);
  observer.frame(60_026);
  expect(observer.report).not.toHaveBeenCalled();
  observer.stop();
});

test("visible frame stalls still produce an incident", () => {
  const observer = observe();
  observer.frame(500);
  expect(observer.report).toHaveBeenCalledWith(
    expect.objectContaining({ phase: "start", source: "raf_gap", blockedMs: 500 }),
  );
  observer.stop();
});

test("a pending timer probe is discarded across visibility changes", () => {
  const observer = observe();
  vi.advanceTimersByTime(250);
  observer.visibility(true, 300);
  observer.visibility(false, 30_000);
  vi.advanceTimersByTime(100);
  expect(observer.report).not.toHaveBeenCalled();
  observer.stop();
});

test("the frame sampler stops when idle and re-arms on activity", () => {
  const observer = observe();
  observer.frame(16);
  observer.frame(32);
  const whileArmed = observer.requests();
  // Past the arm window: this frame does not schedule another.
  observer.frame(5_000);
  expect(observer.requests()).toBe(whileArmed);
  beginRendererInteraction("scroll");
  expect(observer.requests()).toBe(whileArmed + 1);
  observer.frame(5_016);
  expect(observer.requests()).toBe(whileArmed + 2);
  observer.stop();
});
