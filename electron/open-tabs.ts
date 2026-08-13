import type { BrowserWindow } from "electron";
import type { OpenTabsState } from "../contracts/threads.ts";
import type { MonitorTabEvent } from "../contracts/monitor.ts";
import { enqueueLaunchStateMutation, readLaunchState, writeLaunchState } from "./launch-state.ts";

const MAX_HISTORY = 100;

let tabEventObserver: ((event: MonitorTabEvent) => void) | null = null;

/**
 * Register a sink for every open-tab-set mutation. The monitor service uses
 * this to durably record open / close / activate transitions so a switch can
 * be correlated with the exact tab-count change that preceded it.
 */
export function setTabEventObserver(observer: ((event: MonitorTabEvent) => void) | null): void {
  tabEventObserver = observer;
}

function notifyTabEvent(
  action: MonitorTabEvent["action"],
  threadId: string,
  state: OpenTabsState,
): void {
  tabEventObserver?.({
    timestamp: Date.now(),
    action,
    threadId,
    openTabCount: state.openThreadIds.length,
    activeThreadId: state.activeThreadId,
  });
}

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

// Every open-tabs read-modify-write below goes through the shared
// launch-state mutation queue (see launch-state.ts): `tabs:open`,
// `tabs:close`, `tabs:setActive`, `agent:switchThread`, and workspace
// selection updates are independent IPC handlers that the renderer can fire
// concurrently, and they all persist into the same launch-state.json.
const enqueueMutation = enqueueLaunchStateMutation;

export async function openThreadTab(threadId: string): Promise<OpenTabsState> {
  return enqueueMutation(async () => {
    const current = await readOpenTabsState();
    const next = await writeOpenTabsState({
      ...current,
      openThreadIds: ensureThreadIdAtFront(current.openThreadIds, threadId),
      activeThreadId: threadId,
    });
    notifyTabEvent("open", threadId, next);
    return next;
  });
}

/**
 * Close a thread tab. When `isPeer` is provided (same project + workspace as
 * the closed thread), the next active tab is chosen among peers first so
 * closing a tab never yanks the user into another workspace; only when the
 * closed tab was the workspace's last one does selection fall back to any
 * remaining tab.
 */
export async function closeThreadTab(
  threadId: string,
  isPeer?: (threadId: string) => boolean,
): Promise<OpenTabsState> {
  return enqueueMutation(async () => {
    const current = await readOpenTabsState();
    const openThreadIds = current.openThreadIds.filter((id) => id !== threadId);
    let activeThreadId = current.activeThreadId;
    if (current.activeThreadId === threadId) {
      const peerIds = isPeer ? openThreadIds.filter(isPeer) : openThreadIds;
      activeThreadId = pickNextActiveThreadId(
        current.openThreadIds,
        peerIds.length > 0 ? peerIds : openThreadIds,
        threadId,
        current.threadSwitchHistory,
      );
    }
    const next = await writeOpenTabsState({
      ...current,
      openThreadIds,
      activeThreadId,
    });
    notifyTabEvent("close", threadId, next);
    return next;
  });
}

export async function setActiveThreadTab(threadId: string | null): Promise<OpenTabsState> {
  return enqueueMutation(async () => {
    const current = await readOpenTabsState();
    if (!threadId) {
      const next = await writeOpenTabsState({ ...current, activeThreadId: null });
      notifyTabEvent("activate", current.activeThreadId ?? "", next);
      return next;
    }
    const next = await writeOpenTabsState({
      ...current,
      openThreadIds: ensureThreadIdAtFront(current.openThreadIds, threadId),
      activeThreadId: threadId,
    });
    notifyTabEvent("activate", threadId, next);
    return next;
  });
}

export async function recordThreadSwitch(threadId: string): Promise<OpenTabsState> {
  return enqueueMutation(async () => {
    const current = await readOpenTabsState();
    const next = await writeOpenTabsState({
      openThreadIds: ensureThreadIdAtFront(current.openThreadIds, threadId),
      activeThreadId: threadId,
      threadSwitchHistory: [
        threadId,
        ...current.threadSwitchHistory.filter((id) => id !== threadId),
      ],
    });
    notifyTabEvent("activate", threadId, next);
    return next;
  });
}
