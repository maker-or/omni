import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RemoteRequests } from "./remote-requests.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "remote-receipts-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it("recovers accepted results after restart without dispatching again", async () => {
  const first = new RemoteRequests(dir);
  const execute = vi.fn(async () => {});
  const prepare = vi.fn(async () => ({
    threadId: "t1",
    result: { thread: { id: "t1" } },
    execute,
  }));
  await first.submit("r1", { prompt: "private prompt" }, prepare);
  await vi.waitFor(() => expect(first.get("r1")?.state).toBe("completed"));
  const restarted = new RemoteRequests(dir);
  expect((await restarted.submit("r1", { prompt: "private prompt" }, prepare)).result).toEqual({
    thread: { id: "t1" },
  });
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(readFileSync(join(dir, readdirSync(dir)[0]!), "utf8")).not.toContain("private prompt");
});

it("never replays an uncertain dispatch after restart", async () => {
  const execute = vi.fn(() => new Promise<void>(() => {}));
  const prepare = vi.fn(async () => ({ threadId: "t1", result: { ok: true }, execute }));
  await new RemoteRequests(dir).submit("r1", "payload", prepare);
  const retry = await new RemoteRequests(dir).submit("r1", "payload", prepare);
  expect(retry.state).toBe("interrupted");
  expect(retry.threadId).toBe("t1");
  expect(retry.error).toContain("will not run again");
  expect(execute).toHaveBeenCalledTimes(1);
});

it("does not repeat creation after a crash before a thread ID was recorded", async () => {
  const prepare = vi.fn(() => new Promise<never>(() => {}));
  void new RemoteRequests(dir).submit("r1", "payload", prepare);
  const retry = await new RemoteRequests(dir).submit("r1", "payload", prepare);
  expect(retry.state).toBe("interrupted");
  expect(retry.threadId).toBeNull();
  expect(prepare).toHaveBeenCalledTimes(1);
});

it("fails closed if request storage cannot be read", async () => {
  writeFileSync(join(dir, "r1.json"), "broken JSON");
  const prepare = vi.fn();
  await expect(new RemoteRequests(dir).submit("r1", "payload", prepare)).rejects.toThrow();
  expect(prepare).not.toHaveBeenCalled();
});
