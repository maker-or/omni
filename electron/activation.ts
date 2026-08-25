/**
 * Cancellation primitives for thread activations. The activation queue is a
 * strict FIFO: a newly requested activation supersedes the one running ahead
 * of it by aborting its signal, so a slow session/load (up to three 10s phase
 * timeouts chained) is abandoned instead of delaying every later request.
 *
 * Abandonment is cooperative: ACP requests over stdio cannot be cancelled
 * mid-flight, so the underlying request may still complete (or time out)
 * unobserved. Callers must therefore treat an aborted phase like a phase
 * timeout — settle locally, clean up placeholder state, never cascade into
 * further session-establishment attempts. Spawned agent processes are safe to
 * abandon mid-handshake because ConnectionLifecycle dedups spawns: the next
 * activation awaiting the same spawn shares its result.
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
