import { create } from "zustand";

interface PipperState {
  editMode: boolean;
  overlayVisible: boolean;
  processingId: string | null;
  pendingComment: string | null;
  enterEditMode: () => Promise<void>;
  exitEditMode: () => Promise<void>;
  setOverlayVisible: (visible: boolean) => Promise<void>;
  setProcessingId: (id: string | null) => void;
  setPendingComment: (comment: string | null) => void;
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
  pendingComment: null,

  enterEditMode: async () => {
    await window.omni?.pipper?.enterEditMode?.();
    set({ editMode: true, overlayVisible: true });
  },

  exitEditMode: async () => {
    await window.omni?.pipper?.exitEditMode?.();
    set({ editMode: false, processingId: null });
  },

  setOverlayVisible: async (visible) => {
    await window.omni?.pipper?.setOverlayVisible?.(visible);
    set({ overlayVisible: visible });
  },

  setProcessingId: (id) => {
    set({ processingId: id });
  },

  setPendingComment: (comment) => {
    set({ pendingComment: comment });
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
