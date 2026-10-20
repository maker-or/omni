import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

/**
 * Renderer cache of workspace file lists for `@file` mentions.
 *
 * Lists are fetched only when a caller asks (the mention menu opened), shared
 * by every composer looking at the same workspace, and reused until they are
 * invalidated or grow older than `MAX_AGE_MS`. A stale list stays visible
 * while its replacement loads. When the last interested caller goes away
 * before a scan finishes, the main-process scan is cancelled rather than left
 * to complete in the background.
 */

export interface ProjectFileItem {
  id: string;
  label: string;
  description?: string;
}

export interface ProjectFileSource {
  projectId: string | null;
  worktreePath: string | null;
}

/** Lists older than this are refreshed on the next request. */
const MAX_AGE_MS = 30_000;
/** Workspaces kept in memory; each entry can hold thousands of paths. */
const MAX_ENTRIES = 8;

interface Inflight {
  requestId: string;
  waiters: number;
}

interface Entry {
  items: ProjectFileItem[] | null;
  loadedAt: number;
  invalidated: boolean;
  inflight: Inflight | null;
}

const EMPTY: ProjectFileItem[] = [];
const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
let nextRequestId = 0;

export function projectFileIndexKey(source: ProjectFileSource): string | null {
  if (source.worktreePath) return `path:${source.worktreePath}`;
  if (source.projectId) return `project:${source.projectId}`;
  return null;
}

function notify(key: string): void {
  for (const listener of listeners.get(key) ?? []) listener();
}

function evictOverflow(): void {
  if (entries.size <= MAX_ENTRIES) return;
  const idle = [...entries.entries()]
    .filter(([key, entry]) => !entry.inflight && !listeners.get(key)?.size)
    .sort((a, b) => a[1].loadedAt - b[1].loadedAt);
  for (const [key] of idle) {
    if (entries.size <= MAX_ENTRIES) break;
    entries.delete(key);
  }
}

function isFresh(entry: Entry, now: number): boolean {
  return entry.items !== null && !entry.invalidated && now - entry.loadedAt < MAX_AGE_MS;
}

/**
 * Ensures a current list for `source` is loaded or loading. Returns a release
 * function; once every holder of an unfinished scan releases it, the scan is
 * cancelled.
 */
export function requestProjectFiles(source: ProjectFileSource, now = Date.now()): () => void {
  const key = projectFileIndexKey(source);
  const api = typeof window === "undefined" ? undefined : window.omni?.projects;
  if (!key || !api?.listFiles) return () => {};
  let entry = entries.get(key);
  if (!entry) {
    entry = { items: null, loadedAt: 0, invalidated: false, inflight: null };
    entries.set(key, entry);
  }
  if (!entry.inflight && isFresh(entry, now)) return () => {};

  if (!entry.inflight) {
    const inflight: Inflight = { requestId: `files-${++nextRequestId}`, waiters: 0 };
    entry.inflight = inflight;
    const current = entry;
    void api
      .listFiles(
        source.worktreePath ? undefined : (source.projectId ?? undefined),
        source.worktreePath,
        inflight.requestId,
      )
      .then(
        (paths) => {
          if (current.inflight !== inflight) return;
          current.items = paths.map((path) => ({ id: path, label: path }));
          current.loadedAt = Date.now();
          current.invalidated = false;
          current.inflight = null;
          notify(key);
        },
        () => {
          if (current.inflight !== inflight) return;
          current.inflight = null;
          // Keep the last good list; an empty one only replaces "unknown".
          if (current.items === null) {
            current.items = EMPTY;
            current.loadedAt = Date.now();
          }
          notify(key);
        },
      );
    evictOverflow();
  }

  const inflight = entry.inflight!;
  const owner = entry;
  inflight.waiters += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inflight.waiters -= 1;
    if (inflight.waiters > 0 || owner.inflight !== inflight) return;
    owner.inflight = null;
    api.cancelListFiles?.(inflight.requestId);
  };
}

/** Marks a workspace's list (or every list) for refresh on next request. */
export function invalidateProjectFiles(source?: ProjectFileSource): void {
  if (!source) {
    for (const entry of entries.values()) entry.invalidated = true;
    return;
  }
  const key = projectFileIndexKey(source);
  const entry = key ? entries.get(key) : undefined;
  if (entry) entry.invalidated = true;
}

/** Test hook: forget all cached lists. */
export function resetProjectFileIndex(): void {
  entries.clear();
  listeners.clear();
}

function subscribe(key: string, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

/**
 * Mention-menu binding: `items` reflects the cached list for the current
 * workspace (empty until first requested) and `request` loads or refreshes it.
 * `request` changes identity with the workspace so an open menu refetches when
 * the workspace changes underneath it; switching away releases (and, if
 * nobody else needs it, cancels) the previous workspace's scan.
 */
export function useProjectFileIndex(source: ProjectFileSource): {
  items: ProjectFileItem[];
  request: () => void;
} {
  const { projectId, worktreePath } = source;
  const key = projectFileIndexKey(source);
  const stableSource = useMemo(
    () => ({ projectId, worktreePath }) satisfies ProjectFileSource,
    [projectId, worktreePath],
  );
  const subscribeKey = useCallback(
    (listener: () => void) => (key ? subscribe(key, listener) : () => {}),
    [key],
  );
  const items = useSyncExternalStore(
    subscribeKey,
    () => (key ? (entries.get(key)?.items ?? EMPTY) : EMPTY),
    () => EMPTY,
  );

  const releaseRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      releaseRef.current?.();
      releaseRef.current = null;
    },
    [key],
  );

  const request = useCallback(() => {
    releaseRef.current?.();
    releaseRef.current = requestProjectFiles(stableSource);
  }, [stableSource]);

  return { items, request };
}
