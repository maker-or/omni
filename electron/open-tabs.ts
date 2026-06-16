import type { BrowserWindow } from "electron";
import type { OpenTabsState } from "../contracts/threads.ts";
import { readLaunchState, writeLaunchState } from "./launch-state.ts";

const MAX_HISTORY = 100;

function compactIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((id) => typeof id === "string" && id.length > 0)));
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

export async function openThreadTab(threadId: string): Promise<OpenTabsState> {
  const current = await readOpenTabsState();
  return writeOpenTabsState({
    ...current,
    openThreadIds: compactIds([...current.openThreadIds, threadId]),
    activeThreadId: threadId,
  });
}

export async function closeThreadTab(threadId: string): Promise<OpenTabsState> {
  const current = await readOpenTabsState();
  const openThreadIds = current.openThreadIds.filter((id) => id !== threadId);
  const activeThreadId =
    current.activeThreadId === threadId ? (openThreadIds[0] ?? null) : current.activeThreadId;
  return writeOpenTabsState({
    ...current,
    openThreadIds,
    activeThreadId,
  });
}

export async function setActiveThreadTab(threadId: string | null): Promise<OpenTabsState> {
  const current = await readOpenTabsState();
  if (!threadId) {
    return writeOpenTabsState({ ...current, activeThreadId: null });
  }
  return writeOpenTabsState({
    ...current,
    openThreadIds: compactIds([...current.openThreadIds, threadId]),
    activeThreadId: threadId,
  });
}

export async function recordThreadSwitch(threadId: string): Promise<OpenTabsState> {
  const current = await readOpenTabsState();
  return writeOpenTabsState({
    openThreadIds: compactIds([...current.openThreadIds, threadId]),
    activeThreadId: threadId,
    threadSwitchHistory: [threadId, ...current.threadSwitchHistory.filter((id) => id !== threadId)],
  });
}
