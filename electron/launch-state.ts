import { app } from "electron";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FILE_NAME = "launch-state.json";

export interface LaunchState {
  completed: boolean;
  completedAt: string | null;
  projectId: string | null;
  threadId: string | null;
  openThreadIds: string[];
  activeThreadId: string | null;
  threadSwitchHistory: string[];
  /**
   * Canonical workspace per project: the absolute path of the selected
   * worktree (the project root path when the user is on "main"). This is the
   * single persisted source of truth the header, tab scoping, and terminal
   * cwd all agree on after a relaunch.
   */
  selectedWorktreePathByProject: Record<string, string>;
  /**
   * Incremented by every committed change. Identical writes are skipped and
   * keep the revision, so a restart restores the same committed revision.
   */
  revision: number;
}

const DEFAULT_STATE: LaunchState = {
  completed: false,
  completedAt: null,
  projectId: null,
  threadId: null,
  openThreadIds: [],
  activeThreadId: null,
  threadSwitchHistory: [],
  selectedWorktreePathByProject: {},
  revision: 0,
};

export function parseWorkspaceSelections(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const selections: Record<string, string> = {};
  for (const [projectId, path] of Object.entries(value as Record<string, unknown>)) {
    if (typeof path === "string" && path.length > 0) selections[projectId] = path;
  }
  return selections;
}

function statePath(): string {
  return join(app.getPath("userData"), FILE_NAME);
}

/**
 * Validated in-memory mirror of launch-state.json, per file. This process is
 * the only writer, so after the first load every read is served from memory
 * and each mutation costs at most one disk write. `onDisk` is false when the
 * mirror was recovered from the backup (or defaulted), so the next write is
 * never skipped as "identical" while the primary is still corrupt or missing.
 */
interface Mirror {
  state: LaunchState;
  /** Serialized state without its revision, for identical-write detection. */
  content: string;
  onDisk: boolean;
}
const mirrors = new Map<string, Mirror>();
const loading = new Map<string, Promise<Mirror>>();
/** Files this process has written at least once (for the one-time backup). */
const writtenThisProcess = new Set<string>();

/** Disk IO counters for diagnostics and IO-budget tests. */
const ioStats = { diskReads: 0, diskWrites: 0, skippedWrites: 0 };

export function getLaunchStateIoStats(): Readonly<typeof ioStats> {
  return { ...ioStats };
}

function contentOf(state: LaunchState): string {
  const { revision: _revision, ...content } = state;
  return JSON.stringify(content);
}

function cloneState(state: LaunchState): LaunchState {
  return {
    ...state,
    openThreadIds: [...state.openThreadIds],
    threadSwitchHistory: [...state.threadSwitchHistory],
    selectedWorktreePathByProject: { ...state.selectedWorktreePathByProject },
  };
}

async function readStateFile(file: string): Promise<Partial<LaunchState> | null> {
  ioStats.diskReads += 1;
  try {
    const parsed = JSON.parse(await readFile(file, "utf-8")) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Partial<LaunchState>)
      : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[launch-state] unreadable ${file}:`, error);
    }
    return null;
  }
}

async function loadMirror(file: string): Promise<Mirror> {
  const existing = mirrors.get(file);
  if (existing) return existing;
  let pending = loading.get(file);
  if (!pending) {
    pending = (async () => {
      // A missing file is a first launch. A corrupt one falls back to the
      // last-known-good copy instead of silently resetting navigation.
      const primary = await readStateFile(file);
      const parsed = primary ?? (await readStateFile(`${file}.bak`));
      const state = parsed
        ? normalizeLaunchState(parsed)
        : { ...DEFAULT_STATE, selectedWorktreePathByProject: {} };
      // A write that finished while this load was in flight is newer.
      const raced = mirrors.get(file);
      if (raced) return raced;
      const mirror = { state, content: contentOf(state), onDisk: primary !== null };
      mirrors.set(file, mirror);
      return mirror;
    })().finally(() => loading.delete(file));
    loading.set(file, pending);
  }
  return pending;
}

export async function readLaunchState(): Promise<LaunchState> {
  return cloneState((await loadMirror(statePath())).state);
}

function normalizeLaunchState(parsed: Partial<LaunchState>): LaunchState {
  return {
    completed: parsed.completed === true,
    completedAt: typeof parsed.completedAt === "string" ? parsed.completedAt : null,
    projectId: typeof parsed.projectId === "string" ? parsed.projectId : null,
    threadId: typeof parsed.threadId === "string" ? parsed.threadId : null,
    openThreadIds: Array.isArray(parsed.openThreadIds)
      ? parsed.openThreadIds.filter((id): id is string => typeof id === "string")
      : [],
    activeThreadId:
      typeof parsed.activeThreadId === "string"
        ? parsed.activeThreadId
        : typeof parsed.threadId === "string"
          ? parsed.threadId
          : null,
    threadSwitchHistory: Array.isArray(parsed.threadSwitchHistory)
      ? parsed.threadSwitchHistory.filter((id): id is string => typeof id === "string")
      : [],
    selectedWorktreePathByProject: parseWorkspaceSelections(parsed.selectedWorktreePathByProject),
    revision:
      typeof parsed.revision === "number" && Number.isSafeInteger(parsed.revision)
        ? Math.max(0, parsed.revision)
        : 0,
  };
}

/**
 * Persist `state` and return the committed (normalized) state. The revision
 * is owned here: callers' revision values are ignored. A state identical to
 * the one already on disk is not rewritten and keeps its revision.
 */
export async function writeLaunchState(state: LaunchState): Promise<LaunchState> {
  const file = statePath();
  const current = await loadMirror(file);
  const normalized = normalizeLaunchState(state);
  const content = contentOf(normalized);
  if (current.onDisk && content === current.content) {
    ioStats.skippedWrites += 1;
    return cloneState(current.state);
  }
  const committed: LaunchState = { ...normalized, revision: current.state.revision + 1 };
  const serialized = JSON.stringify(committed, null, 2);
  await mkdir(join(file, ".."), { recursive: true });
  // Write a sibling and rename it over the original so a crash mid-write
  // leaves either the previous or the new state, never a truncated file.
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temp, serialized, "utf-8");
    // Once per process, keep the state this launch started from as the
    // last-known-good fallback for readLaunchState. A corrupt primary is not
    // copied, so it can never replace the good backup it was recovered from.
    if (!writtenThisProcess.has(file) && current.onDisk) {
      await copyFile(file, `${file}.bak`).catch(() => {});
    }
    await renameWithRetry(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
  ioStats.diskWrites += 1;
  writtenThisProcess.add(file);
  mirrors.set(file, { state: committed, content, onDisk: true });
  return cloneState(committed);
}

/**
 * Windows can refuse a replacing rename while another process (antivirus,
 * indexer) briefly holds the destination open. Retry instead of unlinking it,
 * which would give up the atomic replacement.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 4 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

// Serializes every launch-state read-modify-write through a single in-process
// queue. Open-tabs mutations, launch selection updates, and workspace
// selection updates are independent IPC entry points that can fire
// concurrently; without this queue two overlapping calls can both read
// launch-state.json before either writes, so the last write silently drops
// the other's change.
let mutationQueue: Promise<unknown> = Promise.resolve();

export function enqueueLaunchStateMutation<T>(task: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(task, task);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * One serialized read-modify-write: `update` sees the committed state and
 * returns the next one; the result is written at most once.
 */
export function mutateLaunchState(
  update: (current: LaunchState) => LaunchState,
): Promise<LaunchState> {
  return enqueueLaunchStateMutation(async () => writeLaunchState(update(await readLaunchState())));
}

export interface NavigationCommit {
  /** Active project; omitted keeps the current one. */
  projectId?: string | null;
  /** Active thread; omitted keeps the current one. */
  threadId?: string | null;
  /** Canonical workspace for a project; a null path clears the selection. */
  workspace?: { projectId: string; path: string | null };
}

/** Applies a navigation commit to a state without persisting it. */
export function applyNavigationCommit(current: LaunchState, commit: NavigationCommit): LaunchState {
  const next = { ...current };
  if (commit.projectId !== undefined) next.projectId = commit.projectId;
  if (commit.threadId !== undefined) {
    next.threadId = commit.threadId;
    next.activeThreadId = commit.threadId;
  }
  if (commit.workspace) {
    const selections = { ...current.selectedWorktreePathByProject };
    if (commit.workspace.path) selections[commit.workspace.projectId] = commit.workspace.path;
    else delete selections[commit.workspace.projectId];
    next.selectedWorktreePathByProject = selections;
  }
  return next;
}

/**
 * Persist project, thread and workspace selection together in one atomic
 * write and return the authoritative committed state.
 */
export function commitNavigation(commit: NavigationCommit): Promise<LaunchState> {
  return mutateLaunchState((current) => applyNavigationCommit(current, commit));
}

export async function markLaunchComplete(projectId: string): Promise<void> {
  // Workspace selections survive re-launching into a project: they are the
  // per-project navigation context, not per-run tab state.
  await mutateLaunchState((current) => ({
    ...current,
    completed: true,
    completedAt: new Date().toISOString(),
    projectId,
    threadId: null,
    openThreadIds: [],
    activeThreadId: null,
    threadSwitchHistory: [],
  }));
}

/** Persist the canonical workspace selection for a project (null clears it). */
export async function updateWorkspaceSelection(
  projectId: string,
  worktreePath: string | null,
): Promise<void> {
  await commitNavigation({ workspace: { projectId, path: worktreePath } });
}

export async function readWorkspaceSelections(): Promise<Record<string, string>> {
  return (await readLaunchState()).selectedWorktreePathByProject;
}

export async function updateLaunchSelection(selection: {
  projectId?: string | null;
  threadId?: string | null;
}): Promise<void> {
  await commitNavigation(selection);
}
