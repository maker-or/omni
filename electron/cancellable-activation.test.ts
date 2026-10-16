import { describe, expect, test } from "vitest";
import {
  ActivationSupersededError,
  isActivationSuperseded,
  KeyedMutex,
  raceActivation,
  SelectionFence,
  throwIfSuperseded,
} from "./activation.ts";

/**
 * Activation primitives: selection requests supersede older ones without a
 * global queue, and per-thread work is serialized only per key.
 */

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("activation cancellation primitives", () => {
  test("raceActivation settles with the promise value", async () => {
    const controller = new AbortController();
    await expect(raceActivation(Promise.resolve(7), controller.signal)).resolves.toBe(7);
  });

  test("raceActivation rejects immediately when aborted mid-await", async () => {
    const controller = new AbortController();
    const never = new Promise<void>(() => {});
    const raced = raceActivation(never, controller.signal);
    const settled = expect(raced).rejects.toBeInstanceOf(ActivationSupersededError);
    controller.abort(new ActivationSupersededError());
    await settled;
  });

  test("raceActivation without a signal is a plain await", async () => {
    await expect(raceActivation(Promise.resolve("x"))).resolves.toBe("x");
  });

  test("throwIfSuperseded throws only for an aborted signal", () => {
    expect(() => throwIfSuperseded(undefined)).not.toThrow();
    const open = new AbortController();
    expect(() => throwIfSuperseded(open.signal)).not.toThrow();
    const aborted = new AbortController();
    aborted.abort(new ActivationSupersededError());
    expect(() => throwIfSuperseded(aborted.signal)).toThrow(ActivationSupersededError);
  });

  test("isActivationSuperseded matches only the sentinel error type", () => {
    expect(isActivationSuperseded(new ActivationSupersededError())).toBe(true);
    expect(isActivationSuperseded(new Error("timed out"))).toBe(false);
  });
});

describe("selection fence", () => {
  test("a newer claim aborts the older ticket and only the newest is latest", () => {
    const fence = new SelectionFence();
    const first = fence.claim();
    const second = fence.claim();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(fence.isLatest(first)).toBe(false);
    expect(fence.isLatest(second)).toBe(true);
    expect(() => fence.assertLatest(first)).toThrow(ActivationSupersededError);
    expect(fence.current).toBe(second.generation);
  });
});

describe("keyed mutex", () => {
  test("serializes one key, runs other keys concurrently, and drains to empty", async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = mutex.run("a", async () => {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push("a1");
    });
    const second = mutex.run("a", async () => {
      order.push("a2");
    });
    const other = mutex.run("b", async () => {
      order.push("b");
    });
    await other;
    await tick();
    expect(order).toEqual(["b"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["b", "a1", "a2"]);
    await tick();
    expect(mutex.size).toBe(0);
  });

  test("a failed task does not block the next one for the key", async () => {
    const mutex = new KeyedMutex();
    await expect(mutex.run("a", async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    await expect(mutex.run("a", async () => "next")).resolves.toBe("next");
  });
});
