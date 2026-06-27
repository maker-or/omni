import { create } from "zustand";

interface PipperState {
  editMode: boolean;
  overlayVisible: boolean;
  processingId: string | null;
  enterEditMode: () => Promise<void>;
  exitEditMode: () => Promise<void>;
  setOverlayVisible: (visible: boolean) => Promise<void>;
  setProcessingId: (id: string | null) => void;
  syncFromBroadcast: (state: {
    processingId?: string | null;
    editMode?: boolean;
    overlayVisible?: boolean;
  }) => void;
}

export const usePipperStore = create<PipperState>((set) => ({
  editMode: false,
  overlayVisible: true,
  processingId: null,

  enterEditMode: async () => {
    await window.omni?.pipper?.enterEditMode?.();
  },

  exitEditMode: async () => {
    await window.omni?.pipper?.exitEditMode?.();
  },

  setOverlayVisible: async (visible) => {
    await window.omni?.pipper?.setOverlayVisible?.(visible);
  },

  setProcessingId: (id) => {
    set({ processingId: id });
  },

  syncFromBroadcast: (state) => {
    set((prev) => ({
      ...prev,
      ...(state.processingId !== undefined ? { processingId: state.processingId } : {}),
      ...(state.editMode !== undefined ? { editMode: state.editMode } : {}),
      ...(state.overlayVisible !== undefined ? { overlayVisible: state.overlayVisible } : {}),
    }));
  },
}));
