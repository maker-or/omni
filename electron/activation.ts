/**
 * Primitives for thread activations. Selection requests (switch, create,
 * project activation) are fenced by `SelectionFence`: a newer request aborts
 * the older caller's signal, so the caller stops waiting at once, and only the
 * newest request may commit itself as the active thread. Runtime preparation
 * is not on a global queue: `KeyedMutex` serializes mutations of one thread
 * (prepare, close, delete) while other threads proceed.
 *
 * Abandonment is cooperative: ACP requests over stdio cannot be cancelled
 * mid-flight. A superseded caller stops waiting, but the thread's preparation
 * runs to completion and its session is adopted by the runtime (or closed if
 * the runtime is gone), so late results always have an owner. Spawned agent
 * processes are shared: ConnectionLifecycle dedups spawns per provider.
 */

export class ActivationSupersededError extends Error {
  constructor(message = "superseded by a newer activation") {
    super(message);
    this.name = "ActivationSuperseded";
  }
}

export function isActivationSuperseded(err: unknown): boolean {
  return err instanceof ActivationSupersededError;
}

/** Throw when the calling activation has been superseded. */
export function throwIfSuperseded(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new ActivationSupersededError();
  }
}

/**
 * Settle with `promise`, but reject immediately when the activation is
 * superseded — the abandoned promise keeps running detached (its handlers stay
 * attached here, so its eventual outcome never surfaces as unhandled). Without
 * a signal this is a plain await.
 */
export async function raceActivation<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new ActivationSupersededError();
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanUp();
      reject(signal.reason instanceof Error ? signal.reason : new ActivationSupersededError());
    };
    const cleanUp = () => {
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanUp();
        resolve(value);
      },
      (error) => {
        cleanUp();
        reject(error);
      },
    );
  });
}

/**
 * One request to change the active UI selection (switch, create, project
 * activation, delete replacement). Its signal aborts as soon as a newer
 * selection is requested, so its caller stops waiting immediately.
 */
export interface SelectionTicket {
  readonly generation: number;
  readonly signal: AbortSignal;
}

/**
 * Orders active-selection commits without serializing the work behind them.
 * Preparation (provider spawn, session/load) runs concurrently; only the
 * request holding the newest ticket may publish itself as the active thread.
 * Checking `isLatest` and mutating selection state in the same synchronous
 * block is the commit, so a stale result can never overwrite a newer one.
 */
export class SelectionFence {
  private generation = 0;
  private controller: AbortController | null = null;

  /** Supersede every earlier ticket and return the newest one. */
  claim(): SelectionTicket {
    this.controller?.abort(new ActivationSupersededError());
    const controller = new AbortController();
    this.controller = controller;
    return { generation: ++this.generation, signal: controller.signal };
  }

  /** Generation of the newest ticket; lets a durable operation detect later requests. */
  get current(): number {
    return this.generation;
  }

  isLatest(ticket: SelectionTicket): boolean {
    return ticket.generation === this.generation;
  }

  /** Throw when a newer selection was requested. */
  assertLatest(ticket: SelectionTicket): void {
    if (!this.isLatest(ticket)) throw new ActivationSupersededError();
  }
}

/**
 * Runs tasks for the same key one at a time and tasks for different keys
 * concurrently. Entries are removed when a key's chain drains, so the map
 * returns to empty once no work is pending.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  get size(): number {
    return this.tails.size;
  }
}
