import { beforeEach, describe, expect, test } from "vitest";
import { useBrowserStore } from "./browser-store";

beforeEach(() => {
  useBrowserStore.setState({ tabs: [] });
});

describe("embedded browser tabs", () => {
  test("the Morning Brief always reuses one tab and reloads it", () => {
    const store = useBrowserStore.getState();
    const first = store.openTab("pipper-brief://brief/today", { kind: "brief" });
    const second = useBrowserStore
      .getState()
      .openTab("pipper-brief://brief/today", { kind: "brief" });
    const tabs = useBrowserStore.getState().tabs;
    expect(second).toBe(first);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.reloadToken).toBe(1);
    expect(tabs[0]!.title).toBe("Morning Brief");
  });

  test("web tabs follow page titles; the brief keeps its label", () => {
    const store = useBrowserStore.getState();
    const web = store.openTab("https://example.com");
    const brief = store.openTab("pipper-brief://brief/today", { kind: "brief" });
    useBrowserStore.getState().setPageInfo(web, { title: "Example", url: "https://example.com/a" });
    useBrowserStore.getState().setPageInfo(brief, { title: "Morning Brief — Tuesday" });
    const byId = Object.fromEntries(useBrowserStore.getState().tabs.map((t) => [t.id, t]));
    expect(byId[web]).toMatchObject({ title: "Example", currentUrl: "https://example.com/a" });
    expect(byId[brief]!.title).toBe("Morning Brief");
  });

  test("closing a tab hands focus to its neighbour", () => {
    const store = useBrowserStore.getState();
    const a = store.openTab("https://a.com");
    const b = useBrowserStore.getState().openTab("https://b.com");
    expect(useBrowserStore.getState().closeTab(b)).toBe(a);
    expect(useBrowserStore.getState().closeTab(a)).toBeNull();
  });
});
