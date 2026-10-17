import type { ChildProcess } from "node:child_process";

export interface TerminateChildProcessOptions {
  /**
   * The child leads its own process group (POSIX `detached` spawn): signal the
   * whole group so helpers it started stop with it, and SIGKILL any member
   * still left once the leader is gone.
   */
  processGroup?: boolean;
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode != null || child.signalCode != null;
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, ms);
    timeout.unref?.();
  });
}

/** Signal a process group led by `child`; false when the group no longer exists. */
export function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): boolean {
  if (process.platform === "win32" || child.pid === undefined) return false;
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch {
    return false;
  }
}

/** SIGTERM, then SIGKILL after 2s; resolves once the process is gone (or 4s pass). */
export async function terminateChildProcess(
  child: ChildProcess,
  options: TerminateChildProcessOptions = {},
): Promise<void> {
  const group = options.processGroup === true;
  const signal = (name: NodeJS.Signals): void => {
    if (group && signalProcessGroup(child, name)) return;
    if (hasExited(child)) return;
    try {
      child.kill(name);
    } catch {
      // best effort
    }
  };
  // A leader that exited before this call may have had its pid reused; only
  // signal groups this call saw running.
  if (hasExited(child)) return;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  signal("SIGTERM");
  await Promise.race([exited, delay(2_000)]);
  if (!hasExited(child)) {
    signal("SIGKILL");
    await Promise.race([exited, delay(2_000)]);
  }
  // Group members that ignored SIGTERM must not outlive the leader.
  if (group) signalProcessGroup(child, "SIGKILL");
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait until every pid has exited (for processes this module did not spawn,
 * e.g. PTY shells), then SIGKILL any still running after `timeoutMs`.
 */
export async function waitForPidsToExit(pids: readonly number[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let running = pids.filter(isRunning);
  while (running.length > 0 && Date.now() < deadline) {
    await delay(25);
    running = running.filter(isRunning);
  }
  for (const pid of running) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Exited in the meantime.
    }
  }
}
