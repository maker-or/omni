import { create } from "zustand";
import type {
  InstallationMetadata,
  UpdateManifest,
  UpdateProgress,
  UpdateRunRecord,
  UpdateState,
} from "../../contracts/updates.ts";

const ACTIVE_PHASES: UpdateState["phase"][] = [
  "preparing",
  "fetching-upstream",
  "agent-running",
  "installing-dependencies",
  "validating",
  "ready-to-promote",
  "promoting",
  "awaiting-health-check",
  "rolling-back",
];

let dismissedForSession = false;

interface UpdateStore {
  state: UpdateState | null;
  manifest: UpdateManifest | null;
  installation: InstallationMetadata | null;
  run: UpdateRunRecord | null;
  progress: UpdateProgress | null;
  detailsOpen: boolean;
  dismissedForSession: boolean;
  initialize: () => Promise<() => void>;
  check: () => Promise<void>;
  refreshRun: (runId?: string | null) => Promise<void>;
  startNow: () => Promise<void>;
  scheduleForQuit: () => Promise<void>;
  dismiss: () => Promise<void>;
  cancel: () => Promise<void>;
  setDetailsOpen: (open: boolean) => void;
}

async function readOfferInputs() {
  const [manifest, installation] = await Promise.all([
    window.omni.update.getManifest(),
    window.omni.update.getInstallation().catch(() => null),
  ]);
  return { manifest, installation };
}

function shouldOpenDetails(state: UpdateState, progress: UpdateProgress | null): boolean {
  return (
    state.phase === "failed" ||
    ACTIVE_PHASES.includes(state.phase) ||
    (state.scheduled_for_quit &&
      progress?.message === "Scheduled update will begin when Pipper quits.")
  );
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  state: null,
  manifest: null,
  installation: null,
  run: null,
  progress: null,
  detailsOpen: false,
  dismissedForSession,
  initialize: async () => {
    const [state, offer] = await Promise.all([window.omni.update.getState(), readOfferInputs()]);
    const run = state.run_id ? await window.omni.update.getRun(state.run_id) : null;
    set({
      state,
      run,
      ...offer,
      detailsOpen: shouldOpenDetails(state, null),
      dismissedForSession,
    });
    const offState = window.omni.update.onStateChanged((next) => {
      void readOfferInputs().then((offerInputs) => set(offerInputs));
      void get().refreshRun(next.run_id);
      set((current) => ({
        state: next,
        detailsOpen: current.detailsOpen || shouldOpenDetails(next, current.progress),
      }));
    });
    const offProgress = window.omni.update.onProgress((progress) =>
      set((current) => ({
        progress,
        detailsOpen:
          current.detailsOpen ||
          (current.state ? shouldOpenDetails(current.state, progress) : false),
      })),
    );
    const offUpdater = window.omni.update.onUpdaterEvent(() => {
      void get().refreshRun(get().state?.run_id);
    });
    return () => {
      offState();
      offProgress();
      offUpdater();
    };
  },
  check: async () => {
    const state = await window.omni.update.check();
    const offer = await readOfferInputs();
    set({ state, ...offer });
    await get().refreshRun(state.run_id);
  },
  refreshRun: async (runId) => {
    if (!runId) {
      set({ run: null });
      return;
    }
    set({ run: await window.omni.update.getRun(runId) });
  },
  startNow: async () => {
    set({ detailsOpen: true });
    const result = await window.omni.update.startNow();
    const state = await window.omni.update.getState();
    set({ state, detailsOpen: true });
    await get().refreshRun(state.run_id);
    if (!result.success) {
      set({ detailsOpen: true });
    }
  },
  scheduleForQuit: async () => set({ state: await window.omni.update.scheduleForQuit() }),
  dismiss: async () => {
    dismissedForSession = true;
    const state = await window.omni.update.dismiss();
    set({ state, detailsOpen: false, dismissedForSession });
  },
  cancel: async () => {
    await window.omni.update.cancel();
    const state = await window.omni.update.getState();
    set({ state, detailsOpen: false });
    await get().refreshRun(state.run_id);
  },
  setDetailsOpen: (detailsOpen) => set({ detailsOpen }),
}));
