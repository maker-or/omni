/**
 * Time-bounded waits for shutdown. Quit must always complete: a cleanup step
 * that never settles (a stuck write, an unreachable server) is abandoned once
 * its budget runs out instead of keeping the process alive.
 */

export type BoundedOutcome =
  | { status: "ok" }
  | { status: "error"; error: unknown }
  | { status: "timeout" };

/** Wait for `task` up to `timeoutMs`. Never rejects; the task keeps running on timeout. */
export function waitBounded(task: Promise<unknown>, timeoutMs: number): Promise<BoundedOutcome> {
  return new Promise<BoundedOutcome>((resolve) => {
    const timer = setTimeout(() => resolve({ status: "timeout" }), Math.max(0, timeoutMs));
    task.then(
      () => {
        clearTimeout(timer);
        resolve({ status: "ok" });
      },
      (error: unknown) => {
        clearTimeout(timer);
        resolve({ status: "error", error });
      },
    );
  });
}

export interface ShutdownStep {
  name: string;
  /** Upper bound for this step; the overall deadline may cut it shorter. */
  timeoutMs: number;
  run: () => Promise<unknown> | unknown;
}

export interface ShutdownReport {
  elapsedMs: number;
  steps: Array<{ name: string; status: BoundedOutcome["status"] | "skipped"; ms: number }>;
}

/**
 * Run cleanup steps in order. Each is bounded by its own timeout and by what
 * is left of `deadlineMs`; steps after the deadline are skipped. Failures and
 * timeouts are logged and never stop later steps. Resolves within
 * `deadlineMs` (plus timer latency) whatever the steps do.
 */
export async function runShutdownSteps(
  steps: readonly ShutdownStep[],
  options: { deadlineMs: number; log?: Pick<Console, "warn" | "error"> },
): Promise<ShutdownReport> {
  const log = options.log ?? console;
  const startedAt = Date.now();
  const report: ShutdownReport = { elapsedMs: 0, steps: [] };
  for (const step of steps) {
    const stepStartedAt = Date.now();
    const remaining = options.deadlineMs - (stepStartedAt - startedAt);
    if (remaining <= 0) {
      report.steps.push({ name: step.name, status: "skipped", ms: 0 });
      log.warn(`[shutdown] skipped ${step.name}: quit deadline reached`);
      continue;
    }
    const budget = Math.min(step.timeoutMs, remaining);
    let task: Promise<unknown>;
    try {
      task = Promise.resolve(step.run());
    } catch (error) {
      task = Promise.reject(error);
    }
    const outcome = await waitBounded(task, budget);
    report.steps.push({ name: step.name, status: outcome.status, ms: Date.now() - stepStartedAt });
    if (outcome.status === "timeout") {
      log.warn(`[shutdown] ${step.name} did not finish within ${budget} ms; continuing`);
    } else if (outcome.status === "error") {
      log.error(`[shutdown] ${step.name} failed:`, outcome.error);
    }
  }
  report.elapsedMs = Date.now() - startedAt;
  return report;
}
