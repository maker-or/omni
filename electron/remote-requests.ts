import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RemoteRequestStatus } from "../contracts/remote.ts";

interface Receipt extends RemoteRequestStatus {
  fingerprint: string;
  result: Record<string, unknown> | null;
  createdAt: number;
}

export type RemoteRequestReceipt = Receipt;

/**
 * A pre-dispatch failure whose message was written for the user. Any other
 * error is logged on the laptop and stored as a generic message, so a phone
 * never learns internal paths or stack details.
 */
export class RemoteTaskError extends Error {}

const GENERIC_PREPARE_ERROR =
  "Pipper couldn't prepare this task, so nothing was started. Check Pipper on your Mac.";

export class RemoteRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Durable at-most-once dispatch. An interrupted dispatch is never replayed:
 * ACP has no idempotency key, so after a crash we cannot prove it didn't run.
 * Receipts retain payload hashes and response metadata, not full prompt payloads.
 */
export class RemoteRequests {
  private receipts: Map<string, Receipt> | null = null;
  private readonly preparing = new Map<string, Promise<Receipt>>();
  private readonly active = new Set<string>();
  private lastCreatedAt = 0;

  private readonly directory: string;
  constructor(directory: string) {
    this.directory = directory;
  }

  private all(): Map<string, Receipt> {
    if (this.receipts) return this.receipts;
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const receipts = new Map<string, Receipt>();
    for (const name of readdirSync(this.directory)) {
      if (!/^[A-Za-z0-9-]{1,128}\.json$/.test(name)) continue;
      // Fail closed on corrupt storage; never discard a deduplication record.
      const receipt = JSON.parse(readFileSync(join(this.directory, name), "utf8")) as Receipt;
      if (receipt.id !== name.slice(0, -5) || !receipt.fingerprint) {
        throw new Error("Remote request history is unreadable. Check Pipper on your Mac.");
      }
      receipts.set(receipt.id, receipt);
      this.lastCreatedAt = Math.max(this.lastCreatedAt, receipt.createdAt ?? receipt.updatedAt);
    }
    this.receipts = receipts;
    return receipts;
  }

  private save(receipt: Receipt): void {
    const file = join(this.directory, `${receipt.id}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify(receipt), { mode: 0o600, flush: true });
    renameSync(`${file}.tmp`, file);
    this.all().set(receipt.id, receipt);
  }

  private recovered(receipt: Receipt): Receipt {
    if (
      (receipt.state === "preparing" || receipt.state === "running") &&
      !this.active.has(receipt.id)
    ) {
      return {
        ...receipt,
        state: "interrupted",
        error:
          "Pipper restarted before this request was confirmed. Check the thread on your Mac before starting another task. This request will not run again.",
      };
    }
    return receipt;
  }

  get(id: string): Receipt | null {
    const receipt = this.all().get(id);
    return receipt ? this.recovered(receipt) : null;
  }

  latestForThread(threadId: string): RemoteRequestStatus | null {
    const receipt = [...this.all().values()]
      .filter((r) => r.threadId === threadId)
      .sort((a, b) => (b.createdAt ?? b.updatedAt) - (a.createdAt ?? a.updatedAt))[0];
    return receipt ? this.status(this.recovered(receipt)) : null;
  }

  status(receipt: Receipt): RemoteRequestStatus {
    const { id, threadId, state, error, updatedAt } = receipt;
    return { id, threadId, state, error, updatedAt };
  }

  async submit(
    id: unknown,
    payload: unknown,
    prepare: () => Promise<{
      threadId: string;
      result: Record<string, unknown>;
      execute: () => Promise<void>;
    }>,
  ): Promise<Receipt> {
    if (typeof id !== "string" || !/^[A-Za-z0-9-]{1,128}$/.test(id)) {
      throw new RemoteRequestError(
        400,
        "A requestId is required. Update the phone app and try again.",
      );
    }
    const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const previous = this.all().get(id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new RemoteRequestError(409, "This request ID already belongs to a different task.");
      }
      return this.preparing.get(id) ?? this.recovered(previous);
    }
    const createdAt = Math.max(Date.now(), this.lastCreatedAt + 1);
    this.lastCreatedAt = createdAt;
    const receipt: Receipt = {
      id,
      fingerprint,
      threadId: null,
      state: "preparing",
      error: null,
      result: null,
      updatedAt: Date.now(),
      createdAt,
    };
    // Claim before ANY worktree/session/prompt side effect.
    this.save(receipt);
    this.active.add(id);
    const task = (async () => {
      try {
        const prepared = await prepare();
        const accepted: Receipt = {
          ...receipt,
          threadId: prepared.threadId,
          result: prepared.result,
          state: "running",
          updatedAt: Date.now(),
        };
        this.save(accepted);
        // Store acceptance before dispatch; respond without waiting for the turn.
        void Promise.resolve()
          .then(prepared.execute)
          .then(
            () => this.settle(accepted, null),
            (error: unknown) => this.settle(accepted, error),
          )
          .catch((error) => console.error("[Remote] Could not persist request outcome:", error))
          .finally(() => this.active.delete(id));
        return accepted;
      } catch (error) {
        this.active.delete(id);
        if (!(error instanceof RemoteTaskError)) {
          console.error(`[Remote] request ${id} failed before dispatch:`, error);
        }
        const failed: Receipt = {
          ...receipt,
          state: "failed",
          updatedAt: Date.now(),
          error: error instanceof RemoteTaskError ? error.message : GENERIC_PREPARE_ERROR,
        };
        this.save(failed);
        return failed;
      } finally {
        this.preparing.delete(id);
      }
    })();
    this.preparing.set(id, task);
    return task;
  }

  private settle(receipt: Receipt, error: unknown): void {
    this.save({
      ...receipt,
      state: error == null ? "completed" : "failed",
      updatedAt: Date.now(),
      error: error == null ? null : error instanceof Error ? error.message : String(error),
    });
  }
}

// HTTP and Mac Siri share the same in-process ownership of the durable journal.
const stores = new Map<string, RemoteRequests>();
export function getRemoteRequests(directory: string): RemoteRequests {
  let store = stores.get(directory);
  if (!store) {
    store = new RemoteRequests(directory);
    stores.set(directory, store);
  }
  return store;
}
