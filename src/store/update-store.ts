import { create } from "zustand";
import type { UpdateProgress, UpdateState } from "../../contracts/updates.ts";

interface UpdateStore {
  state: UpdateState | null;
  progress: UpdateProgress | null;
  detailsOpen: boolean;
  initialize: () => Promise<() => void>;
  check: () => Promise<void>;
  startNow: () => Promise<void>;
  scheduleForQuit: () => Promise<void>;
  dismiss: () => Promise<void>;
  cancel: () => Promise<void>;
  setDetailsOpen: (open: boolean) => void;
}

export const useUpdateStore = create<UpdateStore>((set) => ({
  state: null,
  progress: null,
  detailsOpen: false,
  initialize: async () => {
    const state = await window.omni.update.getState();
    set({
      state,
      detailsOpen:
        state.scheduled_for_quit &&
        state.progress_message === "Scheduled update will begin when Pipper quits.",
    });
    const offState = window.omni.update.onStateChanged((next) =>
      set({
        state: next,
        detailsOpen:
          (next.scheduled_for_quit &&
            next.progress_message === "Scheduled update will begin when Pipper quits.") ||
          [
            "preparing",
            "fetching-upstream",
            "agent-running",
            "installing-dependencies",
            "validating",
            "ready-to-promote",
            "promoting",
            "awaiting-health-check",
            "rolling-back",
            "failed",
          ].includes(next.phase),
      }),
    );
    const offProgress = window.omni.update.onProgress((progress) => set({ progress }));
    return () => {
      offState();
      offProgress();
    };
  },
  check: async () => set({ state: await window.omni.update.check() }),
  startNow: async () => {
    set({ detailsOpen: true });
    await window.omni.update.startNow();
  },
  scheduleForQuit: async () => set({ state: await window.omni.update.scheduleForQuit() }),
  dismiss: async () => set({ state: await window.omni.update.dismiss(), detailsOpen: false }),
  cancel: async () => {
    await window.omni.update.cancel();
    set({ detailsOpen: false });
  },
  setDetailsOpen: (detailsOpen) => set({ detailsOpen }),
}));
