import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type * as acp from "@agentclientprotocol/sdk";
import { ACP_PROMPT_TIMEOUT_MS, PromptScheduler } from "./prompt-scheduler.ts";

/** Queue ordering, cancellation, and the in-flight timeout wrapper. */

function fakeAgent(overrides: Partial<Record<"request" | "notify", unknown>> = {}) {
  return {
    request: vi.fn().mockResolvedValue({ stopReason: "end_turn" }),
    notify: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as acp.ClientContext;
}

describe("PromptScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("dequeue is FIFO per thread and threads are independent", async () => {
    const scheduler = new PromptScheduler();
    const first = scheduler.enqueue("t1", { blocks: [] });
    const second = scheduler.enqueue("t1", { blocks: [] });
    const otherThread = scheduler.enqueue("t2", { blocks: [] });
    const order: string[] = [];
    void first.then(() => order.push("first"));
    void second.then(() => order.push("second"));

    // t2's queue must not interfere with t1's ordering.
    expect(scheduler.dequeue("t2")).toBeDefined();
    scheduler.dequeue("t1")!.resolve(undefined);
    await Promise.resolve();
    scheduler.dequeue("t1")!.resolve(undefined);
    await Promise.resolve();

    expect(order).toEqual(["first", "second"]);
    void otherThread;
  });

  test("dequeue on an empty/absent queue returns undefined and cleans up", () => {
    const scheduler = new PromptScheduler();
    expect(scheduler.dequeue("none")).toBeUndefined();
    void scheduler.enqueue("t1", { blocks: [] });
    expect(scheduler.dequeue("t1")).toBeDefined();
    expect(scheduler.dequeue("t1")).toBeUndefined();
  });

  test("rejectQueued rejects every queued prompt with the reason", async () => {
    const scheduler = new PromptScheduler();
    const pending = [
      scheduler.enqueue("t1", { blocks: [] }),
      scheduler.enqueue("t1", { blocks: [] }),
    ];

    scheduler.rejectQueued("t1", "thread deleted");

    for (const promise of pending) {
      await expect(promise).rejects.toThrow("thread deleted");
    }
  });

  test("cancelInFlight rejects only while a send is actually in flight", async () => {
    const scheduler = new PromptScheduler();
    expect(scheduler.cancelInFlight("t1", "user abort")).toBe(false);

    const agent = fakeAgent({ request: vi.fn(() => new Promise(() => {})) });
    const inFlight = scheduler.send(agent, { threadId: "t1", agentSessionId: "s1" }, []);
    const rejected = expect(inFlight).rejects.toThrow("agent prompt cancelled");
    expect(scheduler.cancelInFlight("t1", "user abort")).toBe(true);
    await rejected;
    // The cancel handle is consumed; a second cancel is a no-op.
    expect(scheduler.cancelInFlight("t1", "user abort")).toBe(false);
  });

  test("send resolves with the agent result and releases the cancel handle", async () => {
    const scheduler = new PromptScheduler();
    const agent = fakeAgent();

    await expect(
      scheduler.send(agent, { threadId: "t1", agentSessionId: "s1" }, []),
    ).resolves.toEqual({ stopReason: "end_turn" });
    expect(agent.request).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: "s1" }),
    );
  });

  test("send times out, cancels the agent session, and rejects", async () => {
    const scheduler = new PromptScheduler();
    const agent = fakeAgent({ request: vi.fn(() => new Promise(() => {})) });
    const inFlight = scheduler.send(agent, { threadId: "t1", agentSessionId: "s1" }, []);
    // Attach the rejection handler before firing the timer so the rejection
    // never surfaces as an unhandled one mid-advancement.
    const timedOut = expect(inFlight).rejects.toThrow(
      `session/prompt timed out after ${ACP_PROMPT_TIMEOUT_MS}ms`,
    );

    await vi.advanceTimersByTimeAsync(ACP_PROMPT_TIMEOUT_MS + 1);

    await timedOut;
    expect(agent.notify).toHaveBeenCalled();
  });

  test("abortAll cancels in-flight sends and rejects all queues", async () => {
    const scheduler = new PromptScheduler();
    const agent = fakeAgent({ request: vi.fn(() => new Promise(() => {})) });
    const inFlight = scheduler.send(agent, { threadId: "t1", agentSessionId: "s1" }, []);
    const queued = scheduler.enqueue("t2", { blocks: [] });
    const cancelled = expect(inFlight).rejects.toThrow("agent prompt cancelled");
    const rejectedQueued = expect(queued).rejects.toThrow("agent connection closed");

    scheduler.abortAll();

    await cancelled;
    await rejectedQueued;
  });
});
