import type { ChildProcess } from "node:child_process";

/** SIGTERM, then SIGKILL after 2s; resolves once the process is gone (or 4s pass). */
export async function terminateChildProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) return;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  const timer = new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 2_000);
    timeout.unref?.();
  });
  await Promise.race([exited, timer]);
  if (child.exitCode == null && child.signalCode == null) {
    try {
      child.kill("SIGKILL");
    } catch {
      // best effort
    }
    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 2_000);
        timeout.unref?.();
      }),
    ]);
  }
}
