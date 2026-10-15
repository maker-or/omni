import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { foreignGitEnv, gitBinary } from "./worktree-manager.ts";

/**
 * Workspace file catalog for `@file` mentions.
 *
 * Every phase is asynchronous and cancellable: Git runs as a child process
 * that is killed on abort, and the filesystem fallback checks the signal
 * between directory reads. Concurrent requests for the same directory share
 * one job; the job is aborted only once every requester has given up, so a
 * rapid sequence of workspace switches cannot build a backlog of scans.
 */

const FILE_MENTION_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
]);
const FALLBACK_FILE_LIMIT = 5000;
const GIT_TIMEOUT_MS = 15_000;

export class ProjectFileListAbortedError extends Error {
  constructor() {
    super("Project file listing was cancelled");
    this.name = "AbortError";
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ProjectFileListAbortedError();
}

function gitListFiles(projectPath: string, signal: AbortSignal): Promise<string[]> {
  return new Promise((resolvePaths, reject) => {
    execFile(
      gitBinary(),
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      {
        cwd: projectPath,
        env: foreignGitEnv(),
        maxBuffer: 1024 * 1024 * 4,
        timeout: GIT_TIMEOUT_MS,
        signal,
      },
      (error, stdout) => {
        if (error) reject(error);
        else
          resolvePaths(Array.from(new Set(String(stdout).split(/\r?\n/).filter(Boolean))).sort());
      },
    );
  });
}

async function walkProjectFiles(projectPath: string, signal: AbortSignal): Promise<string[]> {
  const results: string[] = [];
  const pending: Array<{ dir: string; prefix: string }> = [{ dir: projectPath, prefix: "" }];
  while (pending.length > 0 && results.length < FALLBACK_FILE_LIMIT) {
    throwIfAborted(signal);
    const { dir, prefix } = pending.shift()!;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      // The root must be readable; unreadable subdirectories are skipped.
      if (dir === projectPath) throw error;
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env") continue;
      if (FILE_MENTION_IGNORED_DIRS.has(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) pending.push({ dir: join(dir, entry.name), prefix: relative });
      else if (entry.isFile()) {
        results.push(relative);
        if (results.length >= FALLBACK_FILE_LIMIT) break;
      }
    }
  }
  throwIfAborted(signal);
  return results.sort();
}

/**
 * Lists mentionable files below `projectPath`. Git's view (tracked plus
 * untracked, minus ignored) wins; an empty or failed Git result falls back to
 * a bounded filesystem walk so uninitialized repositories still work.
 */
export async function listProjectFiles(
  projectPath: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<string[]> {
  throwIfAborted(signal);
  try {
    const paths = await gitListFiles(projectPath, signal);
    if (paths.length > 0) return paths;
  } catch {
    // Fall through to the filesystem walk unless the caller gave up.
  }
  throwIfAborted(signal);
  try {
    return await walkProjectFiles(projectPath, signal);
  } catch {
    if (signal.aborted) throw new ProjectFileListAbortedError();
    return [];
  }
}

interface SharedJob {
  controller: AbortController;
  promise: Promise<string[]>;
  waiters: number;
}

/**
 * Coalesces file listings per directory. Each `list` call may pass its own
 * signal; the shared job is cancelled only when every waiter has aborted.
 */
export class ProjectFileLister {
  private readonly jobs = new Map<string, SharedJob>();
  private readonly requests = new Map<string, AbortController>();

  private readonly lister: (path: string, signal: AbortSignal) => Promise<string[]>;

  constructor(lister: (path: string, signal: AbortSignal) => Promise<string[]> = listProjectFiles) {
    this.lister = lister;
  }

  /** Number of directory scans currently running (for tests and diagnostics). */
  get activeJobs(): number {
    return this.jobs.size;
  }

  list(projectPath: string, signal?: AbortSignal): Promise<string[]> {
    if (signal?.aborted) return Promise.reject(new ProjectFileListAbortedError());
    const key = resolve(projectPath);
    let job = this.jobs.get(key);
    if (!job) {
      const controller = new AbortController();
      const created: SharedJob = {
        controller,
        waiters: 0,
        promise: this.lister(key, controller.signal).finally(() => {
          if (this.jobs.get(key) === created) this.jobs.delete(key);
        }),
      };
      // Waiters observe the job through their own promise below.
      created.promise.catch(() => undefined);
      this.jobs.set(key, created);
      job = created;
    }
    const shared = job;
    shared.waiters += 1;
    return new Promise<string[]>((resolveList, reject) => {
      let settled = false;
      const release = () => {
        signal?.removeEventListener("abort", onAbort);
        shared.waiters -= 1;
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        release();
        if (shared.waiters === 0) {
          shared.controller.abort();
          if (this.jobs.get(key) === shared) this.jobs.delete(key);
        }
        reject(new ProjectFileListAbortedError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      shared.promise.then(
        (paths) => {
          if (settled) return;
          settled = true;
          release();
          resolveList(paths);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          release();
          reject(error);
        },
      );
    });
  }

  /**
   * IPC-friendly form: a caller-chosen request id can later be passed to
   * `cancel`, which is how the renderer abandons a scan it no longer needs.
   */
  listForRequest(projectPath: string, requestId: string | null | undefined): Promise<string[]> {
    if (!requestId) return this.list(projectPath);
    this.requests.get(requestId)?.abort();
    const controller = new AbortController();
    this.requests.set(requestId, controller);
    return this.list(projectPath, controller.signal).finally(() => {
      if (this.requests.get(requestId) === controller) this.requests.delete(requestId);
    });
  }

  cancel(requestId: string): void {
    const controller = this.requests.get(requestId);
    if (!controller) return;
    this.requests.delete(requestId);
    controller.abort();
  }
}
