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

let dismissedManifestVersion: string | null = null;

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
  retryFailedUpdate: () => Promise<void>;
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
  if (state.phase === "failed") return true;
  return (
    ACTIVE_PHASES.includes(state.phase) ||
    (state.scheduled_for_quit &&
      progress?.message === "Scheduled update will begin when Pipper quits.")
  );
}

function isDismissedForSession(manifest: UpdateManifest | null): boolean {
  return manifest != null && dismissedManifestVersion === manifest.version;
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  state: null,
  manifest: null,
  installation: null,
  run: null,
  progress: null,
  detailsOpen: false,
  dismissedForSession: false,
  initialize: async () => {
    const [state, offer] = await Promise.all([window.omni.update.getState(), readOfferInputs()]);
    const run = state.run_id ? await window.omni.update.getRun(state.run_id) : null;
    set({
      state,
      run,
      ...offer,
      detailsOpen: shouldOpenDetails(state, null),
      dismissedForSession: isDismissedForSession(offer.manifest),
    });
    const offState = window.omni.update.onStateChanged((next) => {
      void readOfferInputs().then((offerInputs) =>
        set({
          ...offerInputs,
          dismissedForSession: isDismissedForSession(offerInputs.manifest),
        }),
      );
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
    set({ state, ...offer, dismissedForSession: isDismissedForSession(offer.manifest) });
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
  retryFailedUpdate: async () => {
    set({ detailsOpen: true });
    const retryState = await window.omni.update.retryFailedUpdate();
    set({ state: retryState, detailsOpen: retryState.phase !== "idle" });
    await get().refreshRun(retryState.run_id);
    if (retryState.phase === "available" || retryState.phase === "scheduled") {
      await get().startNow();
    }
  },
  scheduleForQuit: async () => set({ state: await window.omni.update.scheduleForQuit() }),
  dismiss: async () => {
    dismissedManifestVersion = get().manifest?.version ?? null;
    const state = await window.omni.update.dismiss();
    set({
      state,
      detailsOpen: false,
      dismissedForSession: isDismissedForSession(get().manifest),
    });
  },
  cancel: async () => {
    await window.omni.update.cancel();
    const state = await window.omni.update.getState();
    set({ state, detailsOpen: false });
    await get().refreshRun(state.run_id);
  },
  setDetailsOpen: (detailsOpen) => {
    set({ detailsOpen });
  },
}));

export function __resetUpdateStoreForTests(): void {
  dismissedManifestVersion = null;
  useUpdateStore.setState({
    state: null,
    manifest: null,
    installation: null,
    run: null,
    progress: null,
    detailsOpen: false,
    dismissedForSession: false,
  });
}
