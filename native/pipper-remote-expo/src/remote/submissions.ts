export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const KEY = "remote.pendingSubmissions";

/**
 * Keeps the same request ID after a timeout, app restart, or repeated
 * attempt, so the Mac can de-duplicate. Only hashes and IDs are stored;
 * clear after the Mac acknowledges acceptance. Port of
 * `RemoteSubmissionStore` in the iOS app.
 */
export class SubmissionStore {
  /** Serializes read-modify-write cycles on the shared record. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: KeyValueStore,
    private readonly hash: (text: string) => Promise<string>,
    private readonly newId: () => string,
  ) {}

  requestId(scope: string[]): Promise<string> {
    return this.serialized(async () => {
      const pending = await this.load();
      const key = await this.hash(JSON.stringify(scope));
      const existing = pending[key];
      if (existing) return existing;
      const id = this.newId();
      pending[key] = id;
      await this.store.setItem(KEY, JSON.stringify(pending));
      return id;
    });
  }

  acknowledge(scope: string[], requestId: string): Promise<void> {
    return this.serialized(async () => {
      const pending = await this.load();
      const key = await this.hash(JSON.stringify(scope));
      if (pending[key] !== requestId) return;
      delete pending[key];
      await this.store.setItem(KEY, JSON.stringify(pending));
    });
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async load(): Promise<Record<string, string>> {
    const raw = await this.store.getItem(KEY);
    if (!raw) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }
}
