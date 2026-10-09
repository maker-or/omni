// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import {
  createPageSwipeTracker,
  hasHorizontalScrollTarget,
  listenForPageSwipes,
} from "./page-swipe";

test("accumulates small horizontal deltas into one page swipe", () => {
  const tracker = createPageSwipeTracker();
  expect(tracker.push(30, 1, 0, false)).toBeNull();
  expect(tracker.push(30, 1, 16, false)).toBeNull();
  expect(tracker.push(30, 1, 32, false)).toBe("left");
  expect(tracker.push(100, 0, 48, false)).toBeNull();
  expect(tracker.push(60, 0, 180, false)).toBeNull();
  expect(tracker.push(15, 0, 370, false)).toBeNull();
  expect(tracker.push(-90, 0, 800, false)).toBe("right");
});

test("ignores vertical scrolling and small accidental horizontal motion", () => {
  const tracker = createPageSwipeTracker();
  expect(tracker.push(10, 100, 0, false)).toBeNull();
  expect(tracker.push(90, 30, 20, false)).toBeNull();
  tracker.reset();
  expect(tracker.push(25, 0, 100, false)).toBeNull();
});

test("does not turn a blocked scroll into navigation when its target changes", () => {
  const tracker = createPageSwipeTracker();
  expect(tracker.push(90, 0, 0, true)).toBeNull();
  expect(tracker.push(120, 0, 30, false)).toBeNull();
  expect(tracker.push(90, 0, 500, false)).toBe("left");
});

test("reset discards unfinished motion", () => {
  const tracker = createPageSwipeTracker();
  tracker.push(60, 0, 0, false);
  tracker.reset();
  expect(tracker.push(30, 0, 20, false)).toBeNull();
});

test("protects scrollable ancestors but allows swipes over ordinary content", () => {
  const container = document.createElement("div");
  const child = document.createElement("span");
  container.append(child);
  document.body.append(container);
  Object.defineProperties(container, {
    scrollWidth: { value: 400, configurable: true },
    clientWidth: { value: 200, configurable: true },
  });
  container.style.overflowX = "auto";
  expect(hasHorizontalScrollTarget(child)).toBe(true);
  container.style.overflowX = "hidden";
  expect(hasHorizontalScrollTarget(child)).toBe(false);
  expect(hasHorizontalScrollTarget(null)).toBe(false);
  container.remove();
});

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

function wheel(deltaX = 100, overrides: WheelEventInit = {}) {
  const event = new WheelEvent("wheel", {
    deltaX,
    deltaY: 0,
    bubbles: true,
    cancelable: true,
    ...overrides,
  });
  // happy-dom's WheelEvent does not yet inherit MouseEvent modifier fields.
  for (const key of ["ctrlKey", "metaKey", "altKey", "shiftKey"] as const) {
    Object.defineProperty(event, key, { value: overrides[key] ?? false });
  }
  window.dispatchEvent(event);
  return event;
}

test("navigates once for a fluid swipe only when the system and app allow it", async () => {
  const navigate = vi.fn();
  let enabled = true;
  stop = listenForPageSwipes({
    readFluidSwipeEnabled: async () => true,
    subscribeToNativeSwipe: () => undefined,
    isEnabled: () => enabled,
    navigate,
  });
  await Promise.resolve();
  expect(wheel().defaultPrevented).toBe(true);
  wheel();
  expect(navigate.mock.calls).toEqual([["left"]]);
  enabled = false;
  window.dispatchEvent(new Event("focus"));
  await Promise.resolve();
  expect(wheel().defaultPrevented).toBe(false);
  expect(navigate).toHaveBeenCalledTimes(1);
});

test("respects a system preference change when returning to the app", async () => {
  const navigate = vi.fn();
  let systemEnabled = false;
  stop = listenForPageSwipes({
    readFluidSwipeEnabled: async () => systemEnabled,
    subscribeToNativeSwipe: () => undefined,
    isEnabled: () => true,
    navigate,
  });
  await Promise.resolve();
  expect(wheel().defaultPrevented).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
  systemEnabled = true;
  window.dispatchEvent(new Event("focus"));
  await Promise.resolve();
  wheel(-100);
  expect(navigate.mock.calls).toEqual([["right"]]);
  systemEnabled = false;
  window.dispatchEvent(new Event("focus"));
  await Promise.resolve();
  wheel();
  expect(navigate).toHaveBeenCalledTimes(1);
});

test.each([{ ctrlKey: true }, { shiftKey: true }, { deltaMode: 1 }, { deltaY: 100 }])(
  "preserves ordinary scroll and zoom events: %j",
  async (overrides) => {
    const navigate = vi.fn();
    stop = listenForPageSwipes({
      readFluidSwipeEnabled: async () => true,
      subscribeToNativeSwipe: () => undefined,
      isEnabled: () => true,
      navigate,
    });
    await Promise.resolve();
    expect(wheel(100, overrides).defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  },
);

test("routes discrete system swipes, honors the app switch, and cleans up listeners", async () => {
  const navigate = vi.fn();
  const unsubscribe = vi.fn();
  let nativeSwipe: ((direction: "left" | "right") => void) | undefined;
  let enabled = true;
  stop = listenForPageSwipes({
    readFluidSwipeEnabled: async () => false,
    subscribeToNativeSwipe: (callback) => {
      nativeSwipe = callback;
      return unsubscribe;
    },
    isEnabled: () => enabled,
    navigate,
  });
  await Promise.resolve();
  nativeSwipe!("left");
  enabled = false;
  nativeSwipe!("right");
  expect(navigate.mock.calls).toEqual([["left"]]);
  stop();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  stop = undefined;
});
