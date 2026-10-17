/**
 * Display-cache freshness (R17). Measured before changing the 2 s settled
 * debounce, so a maximum-age checkpoint can be justified (or not) by data.
 *
 * - persistLagMs: from the first settled-but-unpersisted revision of a
 *   thread to the write that stored it (debounce, backoff and queueing).
 * - restoreAgeMs: age of a display snapshot's content when it is restored.
 */
const SAMPLE_LIMIT = 256;

export interface FreshnessSummary {
  count: number;
  maxMs: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

class Distribution {
  count = 0;
  maxMs = 0;
  /** Most recent samples only; percentiles describe recent behavior. */
  private readonly samples: number[] = [];

  record(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.count += 1;
    this.maxMs = Math.max(this.maxMs, ms);
    this.samples.push(ms);
    if (this.samples.length > SAMPLE_LIMIT) this.samples.shift();
  }

  summary(): FreshnessSummary {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const at = (q: number) =>
      sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : null;
    return { count: this.count, maxMs: this.maxMs, p50Ms: at(0.5), p95Ms: at(0.95) };
  }
}

export class SnapshotFreshness {
  private readonly pendingSince = new Map<string, number>();
  private readonly persistLag = new Distribution();
  private readonly restoreAge = new Distribution();

  /** A settled revision is waiting to be persisted (first call wins). */
  noteSettled(threadId: string, at = Date.now()): void {
    if (!this.pendingSince.has(threadId)) this.pendingSince.set(threadId, at);
  }

  notePersisted(threadId: string, at = Date.now()): void {
    const since = this.pendingSince.get(threadId);
    this.pendingSince.delete(threadId);
    if (since !== undefined) this.persistLag.record(at - since);
  }

  /** The thread's runtime is gone; an unpersisted revision is no longer pending. */
  forget(threadId: string): void {
    this.pendingSince.delete(threadId);
  }

  noteRestored(writtenAt: number | undefined, at = Date.now()): void {
    if (writtenAt !== undefined) this.restoreAge.record(at - writtenAt);
  }

  summary(at = Date.now()): {
    persistLag: FreshnessSummary;
    restoreAge: FreshnessSummary;
    /** Oldest settled revision still waiting to be written. */
    oldestPendingMs: number | null;
  } {
    let oldest: number | null = null;
    for (const since of this.pendingSince.values()) {
      oldest = Math.max(oldest ?? 0, at - since);
    }
    return {
      persistLag: this.persistLag.summary(),
      restoreAge: this.restoreAge.summary(),
      oldestPendingMs: oldest,
    };
  }
}
