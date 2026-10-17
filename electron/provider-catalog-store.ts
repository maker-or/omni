import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";

export interface CatalogModel {
  modelId: string;
  name: string;
  provider?: string;
}

interface CatalogEntry {
  models: CatalogModel[];
  refreshedAt: number;
}

interface CatalogFile {
  version: 1;
  providers: Record<string, CatalogEntry>;
}

/** A running provider re-probes its catalog in the background after this age. */
export const CATALOG_MAX_AGE_MS = 12 * 60 * 60_000;
/** A failed probe is not retried in the background for this long. */
export const CATALOG_FAILURE_BACKOFF_MS = 5 * 60_000;
/** Bounds one provider's persisted catalog; real catalogs are far smaller. */
const MAX_MODELS_PER_PROVIDER = 1_000;
const WRITE_DEBOUNCE_MS = 1_000;
/** An unchanged observation only rewrites the file to refresh an entry this old. */
const UNCHANGED_REWRITE_AGE_MS = 60 * 60_000;

export function sameModels(a: readonly CatalogModel[], b: readonly CatalogModel[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (model, index) =>
      model.modelId === b[index]!.modelId &&
      model.name === b[index]!.name &&
      model.provider === b[index]!.provider,
  );
}

function sanitizeModels(raw: unknown): CatalogModel[] {
  if (!Array.isArray(raw)) return [];
  const models: CatalogModel[] = [];
  for (const item of raw.slice(0, MAX_MODELS_PER_PROVIDER)) {
    if (!item || typeof item !== "object") continue;
    const { modelId, name, provider } = item as Record<string, unknown>;
    if (typeof modelId !== "string" || !modelId) continue;
    models.push({
      modelId,
      name: typeof name === "string" && name ? name : modelId,
      ...(typeof provider === "string" ? { provider } : {}),
    });
  }
  return models;
}

/**
 * Persisted model catalog per provider instance. Model pickers read it without
 * starting anything; a provider process is only started for its catalog on an
 * explicit refresh. Sessions that establish normally keep it current, because
 * every session/new|load|resume reply that carries model options is recorded.
 *
 * Freshness: an entry is refreshed in the background only while its provider
 * is already running and the entry is missing or older than
 * CATALOG_MAX_AGE_MS. A failed probe keeps the previous entry and is not
 * retried in the background for CATALOG_FAILURE_BACKOFF_MS. Concurrent
 * refreshes of one provider share a single probe.
 */
export class ProviderCatalogStore {
  private readonly path: string;
  private readonly now: () => number;
  private readonly entries = new Map<string, CatalogEntry>();
  private loaded: Promise<void> | null = null;
  private readonly refreshing = new Map<string, Promise<CatalogModel[] | null>>();
  private readonly failedAt = new Map<string, number>();
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: { path?: string; now?: () => number } = {}) {
    this.path = options.path ?? join(app.getPath("userData"), "provider-catalogs.json");
    this.now = options.now ?? Date.now;
  }

  /** Read the persisted catalogs once; a missing or corrupt file starts empty. */
  load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const parsed = JSON.parse(await readFile(this.path, "utf8")) as Partial<CatalogFile>;
        for (const [agentId, entry] of Object.entries(parsed.providers ?? {})) {
          const models = sanitizeModels(entry?.models);
          // Observations recorded before the file finished loading are newer.
          if (models.length === 0 || this.entries.has(agentId)) continue;
          const refreshedAt = Number(entry?.refreshedAt);
          this.entries.set(agentId, {
            models,
            refreshedAt: Number.isFinite(refreshedAt) ? refreshedAt : 0,
          });
        }
      } catch {
        // No cache yet, or unreadable: catalogs repopulate from sessions.
      }
    })();
    return this.loaded;
  }

  get(agentId: string): CatalogModel[] | undefined {
    return this.entries.get(agentId)?.models;
  }

  agentIds(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Record an observed catalog. Empty observations are ignored so a session
   * without a model option never wipes a known catalog. Returns true when the
   * stored catalog changed.
   */
  record(agentId: string, observed: readonly CatalogModel[]): boolean {
    const models = sanitizeModels(observed);
    if (models.length === 0) return false;
    this.failedAt.delete(agentId);
    const previous = this.entries.get(agentId);
    const changed = !previous || !sameModels(previous.models, models);
    const now = this.now();
    if (!changed && now - previous.refreshedAt < UNCHANGED_REWRITE_AGE_MS) return false;
    this.entries.set(agentId, { models: changed ? models : previous.models, refreshedAt: now });
    this.scheduleWrite();
    return changed;
  }

  /** True when a background refresh of a running provider is worthwhile. */
  needsRefresh(agentId: string): boolean {
    if (this.refreshing.has(agentId)) return false;
    const failed = this.failedAt.get(agentId);
    if (failed != null && this.now() - failed < CATALOG_FAILURE_BACKOFF_MS) return false;
    const entry = this.entries.get(agentId);
    return !entry || this.now() - entry.refreshedAt > CATALOG_MAX_AGE_MS;
  }

  isRefreshing(agentId: string): boolean {
    return this.refreshing.has(agentId);
  }

  /**
   * Run one probe per provider at a time; concurrent callers share it. The
   * probe resolves null (or throws) when it learned nothing; the previous
   * entry is kept and the failure is remembered for the backoff window.
   */
  refresh(
    agentId: string,
    probe: () => Promise<CatalogModel[] | null>,
  ): Promise<CatalogModel[] | null> {
    const inFlight = this.refreshing.get(agentId);
    if (inFlight) return inFlight;
    const run = (async () => {
      try {
        const models = await probe();
        if (models?.length) {
          this.record(agentId, models);
          return this.get(agentId) ?? null;
        }
        this.failedAt.set(agentId, this.now());
        return null;
      } catch {
        this.failedAt.set(agentId, this.now());
        return null;
      } finally {
        this.refreshing.delete(agentId);
      }
    })();
    this.refreshing.set(agentId, run);
    return run;
  }

  /** Write any pending change now (used on shutdown). */
  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
      this.queueWrite();
    }
    await this.writeChain;
  }

  private scheduleWrite(): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.queueWrite();
    }, WRITE_DEBOUNCE_MS);
    this.writeTimer.unref?.();
  }

  private queueWrite(): void {
    this.writeChain = this.writeChain.then(() => this.writeNow()).catch(() => undefined);
  }

  private async writeNow(): Promise<void> {
    const file: CatalogFile = { version: 1, providers: Object.fromEntries(this.entries) };
    const temporary = `${this.path}.${process.pid}.tmp`;
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(temporary, JSON.stringify(file), "utf8");
      await rename(temporary, this.path);
    } catch (error) {
      // The cache is an optimization; a failed write only costs a later probe.
      console.warn("[provider-catalogs] write failed:", error);
    }
  }
}
