import type { BrowserWindow } from "electron";
import type { OpenTabsState } from "../contracts/threads.ts";
import { readLaunchState, writeLaunchState } from "./launch-state.ts";

const MAX_HISTORY = 100;

function compactIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((id) => typeof id === "string" && id.length > 0)));
}

/**
 * Ensures `threadId` is present in `ids`. A thread that isn't open yet is
 * inserted at the front (leftmost tab) — that's where a reopened or
 * newly-created thread should land. A thread that's already open keeps its
 * existing position rather than jumping to the front.
 */
function ensureThreadIdAtFront(ids: string[], threadId: string): string[] {
  return ids.includes(threadId) ? ids : [threadId, ...ids];
}

/**
 * Picks the tab that should become active after closing `closedThreadId`,
 * which was the active tab. Preference order: the most-recently-used
 * still-open thread (from `threadSwitchHistory`), then the tab that was to
 * its right, then the tab that was to its left, then whatever remains.
 */
function pickNextActiveThreadId(
  openThreadIdsBeforeClose: string[],
  openThreadIdsAfterClose: string[],
  closedThreadId: string,
  threadSwitchHistory: string[],
): string | null {
  if (openThreadIdsAfterClose.length === 0) return null;

  const remaining = new Set(openThreadIdsAfterClose);
  const mru = threadSwitchHistory.find((id) => id !== closedThreadId && remaining.has(id));
  if (mru) return mru;

  const closedIndex = openThreadIdsBeforeClose.indexOf(closedThreadId);
  const rightNeighbor = openThreadIdsBeforeClose[closedIndex + 1];
  if (rightNeighbor && remaining.has(rightNeighbor)) return rightNeighbor;

  const leftNeighbor = openThreadIdsBeforeClose[closedIndex - 1];
  if (leftNeighbor && remaining.has(leftNeighbor)) return leftNeighbor;

  return openThreadIdsAfterClose[0] ?? null;
}

function normalize(state: OpenTabsState): OpenTabsState {
  const openThreadIds = compactIds(state.openThreadIds);
  const history = compactIds(state.threadSwitchHistory).slice(0, MAX_HISTORY);
  return {
    openThreadIds,
    activeThreadId:
      state.activeThreadId && openThreadIds.includes(state.activeThreadId)
        ? state.activeThreadId
        : (openThreadIds[0] ?? null),
    threadSwitchHistory: history,
  };
}

export async function readOpenTabsState(): Promise<OpenTabsState> {
  const state = await readLaunchState();
  return normalize({
    openThreadIds: state.openThreadIds,
    activeThreadId: state.activeThreadId ?? state.threadId,
    threadSwitchHistory: state.threadSwitchHistory,
  });
}

async function writeOpenTabsState(next: OpenTabsState): Promise<OpenTabsState> {
  const current = await readLaunchState();
  const normalized = normalize(next);
  await writeLaunchState({
    ...current,
    threadId: normalized.activeThreadId,
    openThreadIds: normalized.openThreadIds,
    activeThreadId: normalized.activeThreadId,
    threadSwitchHistory: normalized.threadSwitchHistory,
  });
  return normalized;
}

export function broadcastOpenTabsChanged(window: BrowserWindow | null, state: OpenTabsState): void {
  if (window?.isDestroyed() === false) {
    window.webContents.send("tabs:changed", state);
  }
}

// Serializes every open-tabs read-modify-write below through a single
// in-process queue. `tabs:open`, `tabs:close`, `tabs:setActive`, and
// `agent:switchThread` are independent IPC handlers that the renderer can
// fire concurrently; without this queue, two overlapping calls can both read
// launch-state.json before either writes, so the last write wins and
// silently drops the other's change. Chaining onto `mutationQueue` ensures
// each call's read-modify-write cycle fully completes before the next one
// starts.
let mutationQueue: Promise<unknown> = Promise.resolve();

function enqueueMutation<T>(task: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(task, task);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function openThreadTab(threadId: string): Promise<OpenTabsState> {
  return enqueueMutation(async () => {
    const current = await readOpenTabsState();
    return writeOpenTabsState({
      ...current,
      openThreadIds: ensureThreadIdAtFront(current.openThreadIds, threadId),
      activeThreadId: threadId,
    });
  });
}

export async function closeThreadTab(threadId: string): Promise<OpenTabsState> {
  return enqueueMutation(async () => {
    const current = await readOpenTabsState();
    const openThreadIds = current.openThreadIds.filter((id) => id !== threadId);
    const activeThreadId =
      current.activeThreadId === threadId
        ? pickNextActiveThreadId(
            current.openThreadIds,
            openThreadIds,
            threadId,
            current.threadSwitchHistory,
          )
        : current.activeThreadId;
    return writeOpenTabsState({
      ...current,
      openThreadIds,
      activeThreadId,
    });
  });
}

export async function setActiveThreadTab(threadId: string | null): Promise<OpenTabsState> {
  return enqueueMutation(async () => {
    const current = await readOpenTabsState();
    if (!threadId) {
      return writeOpenTabsState({ ...current, activeThreadId: null });
    }
    return writeOpenTabsState({
      ...current,
      openThreadIds: ensureThreadIdAtFront(current.openThreadIds, threadId),
      activeThreadId: threadId,
    });
  });
}

export async function recordThreadSwitch(threadId: string): Promise<OpenTabsState> {
  return enqueueMutation(async () => {
    const current = await readOpenTabsState();
    return writeOpenTabsState({
      openThreadIds: ensureThreadIdAtFront(current.openThreadIds, threadId),
      activeThreadId: threadId,
      threadSwitchHistory: [threadId, ...current.threadSwitchHistory.filter((id) => id !== threadId)],
    });
  });
}
