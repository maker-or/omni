import { create } from "zustand";

export type UiMode = "basic" | "advanced";

const STORAGE_KEY = "pipper.ui.mode";

function readMode(): UiMode | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "advanced" || value === "basic" ? value : null;
  } catch {
    return null;
  }
}

interface UiModeState {
  mode: UiMode;
  setMode: (mode: UiMode) => void;
}

export const useUiModeStore = create<UiModeState>((set) => ({
  mode: readMode() ?? "basic",
  setMode: (mode) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Keep the in-memory preference when storage is unavailable.
    }
    set({ mode });
  },
}));

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    const mode = event.newValue;
    if (mode === "advanced" || mode === "basic") {
      useUiModeStore.setState({ mode });
    }
  });
}

export function hasSavedUiMode(): boolean {
  return readMode() !== null;
}
