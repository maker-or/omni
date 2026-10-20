import { spawn } from "node:child_process";
import { expect, test } from "vitest";
import { waitForPidsToExit } from "./child-process.ts";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("waitForPidsToExit returns once processes exit and kills ones that outlast the wait", async () => {
  const quick = spawn(process.execPath, ["-e", "setTimeout(() => {}, 50)"], { stdio: "ignore" });
  const stuck = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const stuckExit = new Promise((resolve) => stuck.once("exit", resolve));

  const startedAt = Date.now();
  await waitForPidsToExit([quick.pid!, stuck.pid!], 300);

  expect(Date.now() - startedAt).toBeLessThan(2_000);
  await stuckExit;
  expect(stuck.signalCode).toBe("SIGKILL");
  expect(isAlive(quick.pid!)).toBe(false);
});
