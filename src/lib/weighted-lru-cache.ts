/** An expendable cache with both entry and estimated retained-byte budgets. */
export class WeightedLruCache<K, V> {
  private readonly entries = new Map<K, { value: V; bytes: number }>();
  private retainedBytes = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly weigh: (key: K, value: V) => number;

  constructor(options: {
    maxEntries: number;
    maxBytes: number;
    weigh: (key: K, value: V) => number;
  }) {
    this.maxEntries = options.maxEntries;
    this.maxBytes = options.maxBytes;
    this.weigh = options.weigh;
  }

  get size(): number {
    return this.entries.size;
  }
  get bytes(): number {
    return this.retainedBytes;
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    this.delete(key);
    const bytes = this.weigh(key, value);
    // Oversize results remain available to their caller, but cannot flush a
    // useful working set or become a permanent process-lifetime allocation.
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > this.maxBytes || this.maxEntries <= 0)
      return;
    this.entries.set(key, { value, bytes });
    this.retainedBytes += bytes;
    while (this.entries.size > this.maxEntries || this.retainedBytes > this.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }
  }

  delete(key: K): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.retainedBytes -= entry.bytes;
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.retainedBytes = 0;
  }
}
