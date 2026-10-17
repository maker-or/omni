/**
 * Coordinates database maintenance (VACUUM) with application storage writes.
 *
 * VACUUM in a worker still takes SQLite's writer lock, and main-thread
 * writers then wait on `busy_timeout`. Maintenance therefore starts only
 * when the app is idle (no running turns, no storage write in flight, and a
 * short quiet period), and asynchronous writers that can wait (display
 * snapshots) queue behind it instead of blocking on the lock.
 */
export type MaintenanceOutcome<T> =
  | { status: "completed"; result: T }
  | { status: "busy"; waitedMs: number };

interface StorageMaintenanceOptions {
  /** Interaction-critical work is running (e.g. an agent turn). */
  isBusy?: () => boolean;
  quietMs?: number;
  pollMs?: number;
  maxWaitMs?: number;
}

export class StorageMaintenance {
  private isBusy: () => boolean;
  private readonly quietMs: number;
  private readonly pollMs: number;
  private readonly maxWaitMs: number;
  private activeWrites = 0;
  private lastWriteAt = 0;
  private running: Promise<void> | null = null;

  constructor(options: StorageMaintenanceOptions = {}) {
    this.isBusy = options.isBusy ?? (() => false);
    this.quietMs = options.quietMs ?? 2_000;
    this.pollMs = options.pollMs ?? 250;
    this.maxWaitMs = options.maxWaitMs ?? 2 * 60_000;
  }

  setBusyProbe(isBusy: () => boolean): void {
    this.isBusy = isBusy;
  }

  /** Register a storage write; waits while maintenance holds the database. */
  async acquireWrite(): Promise<() => void> {
    while (this.running) await this.running;
    this.activeWrites += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeWrites -= 1;
      this.lastWriteAt = Date.now();
    };
  }

  get maintenanceRunning(): boolean {
    return this.running !== null;
  }

  private idle(): boolean {
    return (
      this.activeWrites === 0 && Date.now() - this.lastWriteAt >= this.quietMs && !this.isBusy()
    );
  }

  /**
   * Run `task` once the app is idle. Gives up with `busy` after `maxWaitMs`
   * rather than competing with work the user is waiting for.
   */
  async runWhenIdle<T>(task: () => Promise<T>): Promise<MaintenanceOutcome<T>> {
    const startedAt = Date.now();
    for (;;) {
      while (this.running) await this.running;
      if (this.idle()) break;
      if (Date.now() - startedAt >= this.maxWaitMs) {
        return { status: "busy", waitedMs: Date.now() - startedAt };
      }
      await new Promise<void>((resolve) => setTimeout(resolve, this.pollMs));
    }
    let finish!: () => void;
    this.running = new Promise<void>((resolve) => (finish = resolve));
    try {
      return { status: "completed", result: await task() };
    } finally {
      this.running = null;
      finish();
    }
  }
}

/** The application database's coordinator (snapshot writes register here). */
export const applicationStorage = new StorageMaintenance();
