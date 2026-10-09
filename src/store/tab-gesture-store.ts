import { create } from "zustand";

const STORAGE_KEY = "pipper.tabs.trackpadSwipeEnabled";

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

interface TabGestureState {
  swipeEnabled: boolean;
  setSwipeEnabled: (enabled: boolean) => void;
}

export const useTabGestureStore = create<TabGestureState>((set) => ({
  swipeEnabled: readEnabled(),
  setSwipeEnabled: (swipeEnabled) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(swipeEnabled));
    } catch {
      // Keep the in-memory preference when storage is unavailable.
    }
    set({ swipeEnabled });
  },
}));

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.storageArea !== window.localStorage) return;
    if (event.key === STORAGE_KEY || event.key === null) {
      useTabGestureStore.setState({ swipeEnabled: readEnabled() });
    }
  });
}
