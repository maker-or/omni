// Vite helper per @pierre/diffs docs §Worker Pool. The bundler emits
// @pierre/diffs/worker/worker.js as a module URL; we must match `type: 'module'`
// with the `worker.format: 'es'` renderer config in electron.vite.config.ts.
import WorkerUrl from "@pierre/diffs/worker/worker.js?worker&url";

export function workerFactory(): Worker {
  return new Worker(WorkerUrl, { type: "module" });
}
