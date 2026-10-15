import { resolve } from "node:path";

interface InstallJob {
  promise: Promise<unknown>;
  controller: AbortController;
  started: boolean;
}

/**
 * One dependency installer at a time; repeated requests for a path share the
 * job. Each job receives an AbortSignal so a deleted workspace can drop its
 * queued install or stop the running one instead of installing into a path
 * that no longer belongs to the user.
 */
export class WorktreeInstallQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly jobs = new Map<string, InstallJob>();

  enqueue<T>(path: string, install: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const key = resolve(path);
    const pending = this.jobs.get(key);
    if (pending) return pending.promise as Promise<T>;
    const controller = new AbortController();
    const entry: InstallJob = { promise: Promise.resolve(), controller, started: false };
    const job: Promise<T> = this.tail
      .catch(() => undefined)
      .then(() => {
        entry.started = true;
        return install(controller.signal);
      })
      .finally(() => {
        if (this.jobs.get(key) === entry) this.jobs.delete(key);
      });
    entry.promise = job;
    this.jobs.set(key, entry);
    this.tail = job;
    return job;
  }

  /**
   * Abort the path's install. A running install is awaited until its process
   * stops; a queued one returns at once and is skipped when its turn comes,
   * without waiting for unrelated installs ahead of it.
   */
  async cancel(path: string): Promise<void> {
    const job = this.jobs.get(resolve(path));
    if (!job) return;
    job.controller.abort(new Error("workspace removed"));
    if (job.started) await job.promise.catch(() => undefined);
  }
}
