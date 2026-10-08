import { create } from "zustand";

/**
 * Tabs of Pipper's lightweight embedded browser (a global view, like
 * terminals). Each tab is one `<webview>` in the shared
 * `persist:pipper-browser` partition. The Morning Brief is a browser tab of
 * kind "brief" — there is at most one, and re-opening it reuses the tab.
 */

export type BrowserTabKind = "brief" | "web";

export interface BrowserTab {
  id: string;
  kind: BrowserTabKind;
  /** URL the webview should load; changes only when Pipper navigates it. */
  url: string;
  /** Last URL the page itself reported (navigation inside the webview). */
  currentUrl: string;
  title: string;
  /** Bumped to force a reload from outside (e.g. a fresh brief is ready). */
  reloadToken: number;
}

interface BrowserState {
  tabs: BrowserTab[];
  /** Open a tab (or reuse the brief tab) and return its id. */
  openTab: (url: string, options?: { kind?: BrowserTabKind; title?: string }) => string;
  closeTab: (id: string) => string | null;
  setPageInfo: (id: string, info: { url?: string; title?: string }) => void;
  reloadTab: (id: string) => void;
  reloadKind: (kind: BrowserTabKind) => void;
}

let nextId = 1;

export const useBrowserStore = create<BrowserState>((set, get) => ({
  tabs: [],

  openTab: (url, options = {}) => {
    const kind = options.kind ?? "web";
    if (kind === "brief") {
      const existing = get().tabs.find((tab) => tab.kind === "brief");
      if (existing) {
        set({
          tabs: get().tabs.map((tab) =>
            tab.id === existing.id
              ? { ...tab, url, currentUrl: url, reloadToken: tab.reloadToken + 1 }
              : tab,
          ),
        });
        return existing.id;
      }
    }
    const id = `browser-${nextId++}`;
    const tab: BrowserTab = {
      id,
      kind,
      url,
      currentUrl: url,
      title: options.title ?? (kind === "brief" ? "Morning Brief" : "New tab"),
      reloadToken: 0,
    };
    set({ tabs: [...get().tabs, tab] });
    return id;
  },

  closeTab: (id) => {
    const tabs = get().tabs;
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return null;
    const remaining = tabs.filter((tab) => tab.id !== id);
    set({ tabs: remaining });
    return (remaining[index] ?? remaining[index - 1])?.id ?? null;
  },

  setPageInfo: (id, info) => {
    set({
      tabs: get().tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              currentUrl: info.url ?? tab.currentUrl,
              // The brief keeps its stable label; web tabs follow the page title.
              title: tab.kind === "brief" ? tab.title : (info.title ?? tab.title),
            }
          : tab,
      ),
    });
  },

  reloadTab: (id) => {
    set({
      tabs: get().tabs.map((tab) =>
        tab.id === id ? { ...tab, reloadToken: tab.reloadToken + 1 } : tab,
      ),
    });
  },

  reloadKind: (kind) => {
    set({
      tabs: get().tabs.map((tab) =>
        tab.kind === kind ? { ...tab, url: tab.url, reloadToken: tab.reloadToken + 1 } : tab,
      ),
    });
  },
}));
