import { create } from "zustand";

interface PipperState {
  editMode: boolean;
  processingId: string | null;
  pendingComment: string | null;
  enterEditMode: () => Promise<void>;
  exitEditMode: () => Promise<void>;
  setProcessingId: (id: string | null) => void;
  setPendingComment: (comment: string | null) => void;
  syncFromBroadcast: (state: { processingId?: string | null; editMode?: boolean }) => void;
}

export const usePipperStore = create<PipperState>((set) => ({
  editMode: false,
  processingId: null,
  pendingComment: null,

  enterEditMode: async () => {
    await window.omni?.pipper?.enterEditMode?.();
    set({ editMode: true });
  },

  exitEditMode: async () => {
    await window.omni?.pipper?.exitEditMode?.();
    set({ editMode: false, processingId: null });
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
    }));
  },
}));
