import { expect, test } from "vitest";
import { WorktreeInstallQueue } from "./worktree-install-queue.ts";

test("serializes distinct installs and deduplicates a pending workspace", async () => {
  const queue = new WorktreeInstallQueue();
  const calls: string[] = [];
  let release!: () => void;
  const first = queue.enqueue("/worktree/a", async () => {
    calls.push("a");
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return "done-a";
  });
  const duplicate = queue.enqueue("/worktree/a", async () => "should not run");
  const second = queue.enqueue("/worktree/b", async () => {
    calls.push("b");
    return "done-b";
  });
  expect(duplicate).toBe(first);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(calls).toEqual(["a"]);
  release();
  expect(await first).toBe("done-a");
  expect(await second).toBe("done-b");
  expect(calls).toEqual(["a", "b"]);
});

test("failed installs do not block later workspaces or retries", async () => {
  const queue = new WorktreeInstallQueue();
  await expect(
    queue.enqueue("/a", async () => {
      throw new Error("failed");
    }),
  ).rejects.toThrow("failed");
  await expect(queue.enqueue("/b", async () => "ready")).resolves.toBe("ready");
  await expect(queue.enqueue("/a", async () => "retried")).resolves.toBe("retried");
});

test("cancel drops a queued install and stops the running one", async () => {
  const queue = new WorktreeInstallQueue();
  const started: string[] = [];
  const running = queue.enqueue("/a", (signal) => {
    started.push("a");
    return new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  const queued = queue.enqueue("/b", async (signal) => {
    started.push("b");
    return signal.aborted ? "skipped" : "installed";
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  await queue.cancel("/b");
  expect(started).toEqual(["a"]);
  await queue.cancel("/a");
  await expect(running).rejects.toThrow("workspace removed");
  expect(await queued).toBe("skipped");
  expect(started).toEqual(["a", "b"]);
  await expect(queue.enqueue("/b", async () => "fresh")).resolves.toBe("fresh");
});

test("a path recreated after cancel gets a fresh install", async () => {
  const queue = new WorktreeInstallQueue();
  let release!: () => void;
  const blocker = queue.enqueue("/busy", async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return "busy";
  });
  const cancelled = queue.enqueue("/workspace", async (signal) =>
    signal.aborted ? "skipped" : "installed",
  );
  await queue.cancel("/workspace");
  const recreated = queue.enqueue("/workspace", async (signal) =>
    signal.aborted ? "skipped" : "installed",
  );

  expect(recreated).not.toBe(cancelled);
  await new Promise<void>((resolve) => setImmediate(resolve));
  release();
  expect(await blocker).toBe("busy");
  expect(await cancelled).toBe("skipped");
  expect(await recreated).toBe("installed");
});
