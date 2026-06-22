import { create } from "zustand";
import type {
  LauncherDownloadProgress,
  LauncherUpdateDiagnostics,
  LauncherUpdateState,
} from "../../contracts/launcher-updates.ts";

interface LauncherUpdateStore {
  state: LauncherUpdateState | null;
  progress: LauncherDownloadProgress | null;
  diagnostics: LauncherUpdateDiagnostics | null;
  diagnosticsOpen: boolean;
  dismissed: boolean;
  pending: boolean;
  initialize: () => Promise<() => void>;
  check: () => Promise<void>;
  download: () => Promise<void>;
  cancelDownload: () => Promise<void>;
  dismissForSession: () => Promise<void>;
  installAndQuit: () => Promise<void>;
  retryDownload: () => Promise<void>;
  clearDownloadedUpdate: () => Promise<void>;
  setDiagnosticsOpen: (open: boolean) => void;
  refreshDiagnostics: () => Promise<void>;
}

export const useLauncherUpdateStore = create<LauncherUpdateStore>((set, get) => {
  const run = async (action: () => Promise<LauncherUpdateState>) => {
    if (get().pending) return;
    set({ pending: true });
    try {
      set({ state: await action() });
    } catch {
      set({ state: await window.omni.launcherUpdate.getState(), diagnosticsOpen: true });
      await get().refreshDiagnostics();
    } finally {
      set({ pending: false });
    }
  };
  return {
    state: null,
    progress: null,
    diagnostics: null,
    diagnosticsOpen: false,
    dismissed: false,
    pending: false,
    initialize: async () => {
      const [state, dismissed] = await Promise.all([
        window.omni.launcherUpdate.getState(),
        window.omni.launcherUpdate.isDismissedForSession(),
      ]);
      set({ state, dismissed });
      const offState = window.omni.launcherUpdate.onStateChanged((state) => set({ state }));
      const offProgress = window.omni.launcherUpdate.onProgress((progress) => set({ progress }));
      const offDetails = window.omni.launcherUpdate.onOpenDetails(() => {
        set({ diagnosticsOpen: true, dismissed: false });
        void get().refreshDiagnostics();
      });
      const offDismissed = window.omni.launcherUpdate.onDismissedForSession(() =>
        set({ dismissed: true }),
      );
      return () => {
        offState();
        offProgress();
        offDetails();
        offDismissed();
      };
    },
    check: () => run(() => window.omni.launcherUpdate.check()),
    download: () => run(() => window.omni.launcherUpdate.download()),
    cancelDownload: () => run(() => window.omni.launcherUpdate.cancelDownload()),
    dismissForSession: async () => {
      await window.omni.launcherUpdate.dismissForSession();
      set({ dismissed: true });
    },
    installAndQuit: async () => {
      const result = await window.omni.launcherUpdate.installAndQuit();
      if (!result.success) {
        set({ diagnosticsOpen: true });
        await get().refreshDiagnostics();
      }
    },
    retryDownload: () => run(() => window.omni.launcherUpdate.retryDownload()),
    clearDownloadedUpdate: () => run(() => window.omni.launcherUpdate.clearDownloadedUpdate()),
    setDiagnosticsOpen: (diagnosticsOpen) => {
      set({ diagnosticsOpen });
      if (diagnosticsOpen) void get().refreshDiagnostics();
    },
    refreshDiagnostics: async () =>
      set({ diagnostics: await window.omni.launcherUpdate.getDiagnostics() }),
  };
});
