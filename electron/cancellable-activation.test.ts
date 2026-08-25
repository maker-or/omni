import { describe, expect, test, vi } from "vitest";
import { AgentConnectionManager } from "./agent-connection-manager.ts";
import {
  ActivationSupersededError,
  isActivationSuperseded,
  raceActivation,
  throwIfSuperseded,
} from "./activation.ts";
import type { AcpBridgeEvent } from "../contracts/acp.ts";

vi.mock("electron", () => ({
  app: {
    getPath: () => process.env.PIPPER_LIBRARY_PATH ?? process.env.TMPDIR ?? "/tmp",
    connect: vi.fn(),
  },
}));

/**
 * Cancellable activations: a newly requested activation supersedes the one
 * running ahead of it instead of queueing behind its full phase timeout, and
 * FIFO order is otherwise preserved.
 */

function makeManager() {
  const events: AcpBridgeEvent[] = [];
  const manager = new AgentConnectionManager({
    sendToRenderer: (event: unknown) => events.push(event as AcpBridgeEvent),
    setWindowTitle: () => {},
  });
  return manager;
}

function enqueue(manager: AgentConnectionManager) {
  return manager as unknown as {
    enqueueThreadActivation: (task: (signal: AbortSignal) => Promise<unknown>) => Promise<unknown>;
  };
}

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

describe("superseding activation queue", () => {
  test("a newer request aborts the slow activation ahead of it and runs next", async () => {
    const manager = makeManager();
    const queue = enqueue(manager);

    let slowSettled = false;
    let fastRan = false;
    const order: string[] = [];

    // Slow activation: hangs until its signal fires (like a stuck session/load).
    const slow = queue.enqueueThreadActivation((signal) =>
      raceActivation(new Promise((resolve) => setTimeout(resolve, 60_000)), signal).finally(() => {
        slowSettled = true;
      }),
    );
    await tick();

    // The newer request must not wait out the slow one's timeout.
    const fast = queue.enqueueThreadActivation(async () => {
      order.push("fast");
      fastRan = true;
    });

    await expect(slow).rejects.toBeInstanceOf(ActivationSupersededError);
    await fast;

    expect(slowSettled).toBe(true);
    expect(fastRan).toBe(true);
    expect(order).toEqual(["fast"]);
  });

  test("rapid requests obsolete queued-but-unstarted activations too", async () => {
    const manager = makeManager();
    const queue = enqueue(manager);

    // Model a real cancellable prepare: entry check plus signal-aware awaits.
    const hangUntilAborted = (signal: AbortSignal) =>
      new Promise<string>((_resolve, reject) => {
        throwIfSuperseded(signal);
        signal.addEventListener(
          "abort",
          () => reject(signal.reason ?? new ActivationSupersededError()),
          { once: true },
        );
      });

    const slow = queue.enqueueThreadActivation((signal) => hangUntilAborted(signal));
    await tick();
    // Two clicks in quick succession: the second supersedes the first even
    // though it is still queued behind the slow activation.
    const middle = queue.enqueueThreadActivation((signal) => hangUntilAborted(signal));
    const last = queue.enqueueThreadActivation(async () => "last");

    await expect(slow).rejects.toBeInstanceOf(ActivationSupersededError);
    await expect(middle).rejects.toBeInstanceOf(ActivationSupersededError);
    await expect(last).resolves.toBe("last");
  });

  test("FIFO is preserved when nothing is superseded", async () => {
    const manager = makeManager();
    const queue = enqueue(manager);
    const order: number[] = [];

    await Promise.all([
      queue.enqueueThreadActivation(async () => {
        order.push(1);
      }),
      queue.enqueueThreadActivation(async () => {
        order.push(2);
      }),
      queue.enqueueThreadActivation(async () => {
        order.push(3);
      }),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });
});
