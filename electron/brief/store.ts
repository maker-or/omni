import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BriefDocument, BriefSettings } from "../../contracts/brief.ts";
import { DEFAULT_SCHEDULE_TIME, normalizeScheduleTime, type BriefRunState } from "./schedule.ts";

/**
 * On-disk state for the brief, under `<userData>/brief/`:
 *   settings.json  user preferences + optional key overrides
 *   state.json     run bookkeeping + Composio identity/session
 *   briefs/<date>.json  generated documents (last 14 kept)
 *
 * Writes are atomic (tmp + rename) and serialized through one queue so a
 * scheduled run and a launch run can't interleave partial files.
 */

export interface BriefPersistedState extends BriefRunState {
  composioUserId: string | null;
  composioSessionId: string | null;
}

export const DEFAULT_BRIEF_SETTINGS: BriefSettings = {
  enabled: true,
  scheduleTime: DEFAULT_SCHEDULE_TIME,
  openOnLaunch: true,
  composioApiKey: "",
  typesafeApiKey: "",
  anthropicApiKey: "",
};

const DEFAULT_STATE: BriefPersistedState = {
  latestDate: null,
  latestGeneratedAt: null,
  lastShownDate: null,
  composioUserId: null,
  composioSessionId: null,
};

const KEEP_BRIEFS = 14;
const DATE_FILE = /^\d{4}-\d{2}-\d{2}\.json$/;

function str(value: unknown, fallback: string | null): string | null {
  return typeof value === "string" ? value : fallback;
}

export function parseSettings(raw: unknown): BriefSettings {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_BRIEF_SETTINGS.enabled,
    scheduleTime: normalizeScheduleTime(str(value.scheduleTime, DEFAULT_SCHEDULE_TIME)),
    openOnLaunch:
      typeof value.openOnLaunch === "boolean"
        ? value.openOnLaunch
        : DEFAULT_BRIEF_SETTINGS.openOnLaunch,
    composioApiKey: str(value.composioApiKey, "")!.trim(),
    typesafeApiKey: str(value.typesafeApiKey, "")!.trim(),
    anthropicApiKey: str(value.anthropicApiKey, "")!.trim(),
  };
}

export function parseState(raw: unknown): BriefPersistedState {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    latestDate: str(value.latestDate, null),
    latestGeneratedAt: str(value.latestGeneratedAt, null),
    lastShownDate: str(value.lastShownDate, null),
    composioUserId: str(value.composioUserId, null),
    composioSessionId: str(value.composioSessionId, null),
  };
}

export class BriefStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  private async readJson(name: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(join(this.dir, name), "utf-8"));
    } catch {
      return null;
    }
  }

  private async writeJson(name: string, value: unknown): Promise<void> {
    const file = join(this.dir, name);
    await mkdir(join(file, ".."), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2), "utf-8");
    await rename(tmp, file);
  }

  async readSettings(): Promise<BriefSettings> {
    return parseSettings(await this.readJson("settings.json"));
  }

  updateSettings(patch: Partial<BriefSettings>): Promise<BriefSettings> {
    return this.enqueue(async () => {
      const next = parseSettings({ ...(await this.readSettings()), ...patch });
      await this.writeJson("settings.json", next);
      return next;
    });
  }

  async readState(): Promise<BriefPersistedState> {
    return { ...DEFAULT_STATE, ...parseState(await this.readJson("state.json")) };
  }

  updateState(patch: Partial<BriefPersistedState>): Promise<BriefPersistedState> {
    return this.enqueue(async () => {
      const next = { ...(await this.readState()), ...patch };
      await this.writeJson("state.json", next);
      return next;
    });
  }

  /** Stable Composio user id for this install (connections are stored under it). */
  async ensureComposioUserId(seed: string | null): Promise<string> {
    const state = await this.readState();
    if (state.composioUserId) return state.composioUserId;
    const id = `pipper-${seed ?? randomUUID()}`;
    await this.updateState({ composioUserId: id });
    return id;
  }

  saveBrief(doc: BriefDocument): Promise<void> {
    return this.enqueue(async () => {
      await this.writeJson(join("briefs", `${doc.date}.json`), doc);
      const next = {
        ...(await this.readState()),
        latestDate: doc.date,
        latestGeneratedAt: doc.generatedAt,
      };
      await this.writeJson("state.json", next);
      await this.prune();
    });
  }

  async loadBrief(date: string): Promise<BriefDocument | null> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const doc = (await this.readJson(join("briefs", `${date}.json`))) as BriefDocument | null;
    return doc && doc.version === 1 ? doc : null;
  }

  async loadLatest(): Promise<BriefDocument | null> {
    const state = await this.readState();
    return state.latestDate ? this.loadBrief(state.latestDate) : null;
  }

  private async prune(): Promise<void> {
    const dir = join(this.dir, "briefs");
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => DATE_FILE.test(f)).sort();
    } catch {
      return;
    }
    const stale = files.slice(0, Math.max(0, files.length - KEEP_BRIEFS));
    await Promise.all(stale.map((f) => rm(join(dir, f), { force: true })));
  }
}
