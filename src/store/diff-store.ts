import { create } from "zustand";
import type { AcpToolCallState } from "../../contracts/acp.ts";

export interface DiffFileEntry {
  path: string;
  oldText: string;
  newText: string;
  updatedAt: number;
}

interface DiffState {
  threadId: string | null;
  files: Record<string, DiffFileEntry>;
  order: string[];
  activePath: string | null;
  isOpen: boolean;
  unseenCount: number;
  ingestToolCalls: (threadId: string | null, toolCalls: Record<string, AcpToolCallState>) => void;
  setActivePath: (path: string) => void;
  open: () => void;
  close: () => void;
  markSeen: () => void;
}

export const useDiffStore = create<DiffState>((set, get) => ({
  threadId: null,
  files: {},
  order: [],
  activePath: null,
  isOpen: false,
  unseenCount: 0,

  ingestToolCalls: (threadId, toolCalls) => {
    const state = get();
    const isNewThread = threadId !== state.threadId;
    const files = isNewThread ? {} : { ...state.files };
    const order = isNewThread ? [] : [...state.order];
    let added = 0;
    let lastAddedPath: string | null = null;

    for (const tc of Object.values(toolCalls)) {
      for (const block of tc.content ?? []) {
        const typed = block as { type?: string; path?: string; oldText?: string | null; newText?: string };
        if (typed.type !== "diff" || !typed.path || typeof typed.newText !== "string") continue;
        const existing = files[typed.path];
        if (existing && existing.newText === typed.newText && existing.oldText === (typed.oldText ?? "")) {
          continue;
        }
        if (!existing) {
          order.push(typed.path);
          added += 1;
          lastAddedPath = typed.path;
        }
        files[typed.path] = {
          path: typed.path,
          oldText: typed.oldText ?? "",
          newText: typed.newText,
          updatedAt: Date.now(),
        };
      }
    }

    if (!isNewThread && added === 0 && Object.keys(files).length === Object.keys(state.files).length) {
      // Still may have updated existing entries; only skip if nothing changed at all.
      const changed = order.some((path) => files[path] !== state.files[path]);
      if (!changed) return;
    }

    const currentActive = get().activePath;
    const activePath = lastAddedPath
      ? lastAddedPath
      : currentActive && files[currentActive]
        ? currentActive
        : (order[order.length - 1] ?? null);

    set({
      threadId,
      files,
      order,
      activePath,
      isOpen: added > 0 ? true : state.isOpen,
      unseenCount: added > 0 && !state.isOpen ? state.unseenCount + added : state.unseenCount,
    });
  },

  setActivePath: (path) => set({ activePath: path }),
  open: () => set({ isOpen: true, unseenCount: 0 }),
  close: () => set({ isOpen: false }),
  markSeen: () => set({ unseenCount: 0 }),
}));
