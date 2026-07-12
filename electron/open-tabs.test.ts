import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  app: { getPath: () => process.env.PIPPER_LIBRARY_PATH ?? process.env.TMPDIR ?? "/tmp" },
}));

let root: string | null = null;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pipper-open-tabs-"));
  process.env.PIPPER_LIBRARY_PATH = root;
});

afterEach(() => {
  delete process.env.PIPPER_LIBRARY_PATH;
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe("openThreadTab / setActiveThreadTab / recordThreadSwitch ordering", () => {
  test("opening a brand-new thread inserts it at the front", async () => {
    const { openThreadTab } = await import("./open-tabs.ts");
    await openThreadTab("a");
    await openThreadTab("b");
    const state = await openThreadTab("c");
    expect(state.openThreadIds).toEqual(["c", "b", "a"]);
    expect(state.activeThreadId).toBe("c");
  });

  test("reopening an already-open thread keeps its existing position", async () => {
    const { openThreadTab } = await import("./open-tabs.ts");
    await openThreadTab("a");
    await openThreadTab("b");
    await openThreadTab("c");
    // "c", "b", "a" is the current order. Reopening "a" (already open) must
    // NOT move it to the front or back.
    const state = await openThreadTab("a");
    expect(state.openThreadIds).toEqual(["c", "b", "a"]);
    expect(state.activeThreadId).toBe("a");
  });

  test("setActiveThreadTab inserts a not-yet-open thread at the front", async () => {
    const { openThreadTab, setActiveThreadTab } = await import("./open-tabs.ts");
    await openThreadTab("a");
    await openThreadTab("b");
    const state = await setActiveThreadTab("z");
    expect(state.openThreadIds).toEqual(["z", "b", "a"]);
    expect(state.activeThreadId).toBe("z");
  });

  test("setActiveThreadTab on an already-open thread preserves order", async () => {
    const { openThreadTab, setActiveThreadTab } = await import("./open-tabs.ts");
    await openThreadTab("a");
    await openThreadTab("b");
    await openThreadTab("c");
    const state = await setActiveThreadTab("a");
    expect(state.openThreadIds).toEqual(["c", "b", "a"]);
    expect(state.activeThreadId).toBe("a");
  });

  test("recordThreadSwitch inserts a not-yet-open thread at the front", async () => {
    const { openThreadTab, recordThreadSwitch } = await import("./open-tabs.ts");
    await openThreadTab("a");
    await openThreadTab("b");
    const state = await recordThreadSwitch("z");
    expect(state.openThreadIds).toEqual(["z", "b", "a"]);
    expect(state.activeThreadId).toBe("z");
    expect(state.threadSwitchHistory[0]).toBe("z");
  });

  test("recordThreadSwitch on an already-open thread preserves openThreadIds order", async () => {
    const { openThreadTab, recordThreadSwitch } = await import("./open-tabs.ts");
    await openThreadTab("a");
    await openThreadTab("b");
    await openThreadTab("c");
    const state = await recordThreadSwitch("a");
    expect(state.openThreadIds).toEqual(["c", "b", "a"]);
  });
});

describe("closeThreadTab next-active selection", () => {
  test("closing a non-active tab does not change the active thread", async () => {
    const { openThreadTab, closeThreadTab } = await import("./open-tabs.ts");
    await openThreadTab("a");
    await openThreadTab("b");
    await openThreadTab("c"); // active: c, order: c, b, a
    const state = await closeThreadTab("a");
    expect(state.openThreadIds).toEqual(["c", "b"]);
    expect(state.activeThreadId).toBe("c");
  });

  test("closing the active tab prefers the most-recently-used still-open thread", async () => {
    const { openThreadTab, recordThreadSwitch, closeThreadTab } = await import("./open-tabs.ts");
    await openThreadTab("a");
    await openThreadTab("b");
    await openThreadTab("c");
    // Order is c, b, a. Visit "a" then "c" so history (MRU-first) is [c, a, b].
    await recordThreadSwitch("a");
    await recordThreadSwitch("c");
    const state = await closeThreadTab("c");
    expect(state.openThreadIds).toEqual(["b", "a"]);
    // MRU still-open thread (excluding the closed one) is "a".
    expect(state.activeThreadId).toBe("a");
  });

  test("falls back to the right neighbor when there's no usable history", async () => {
    const { openThreadTab, closeThreadTab } = await import("./open-tabs.ts");
    await openThreadTab("a");
    await openThreadTab("b");
    await openThreadTab("c"); // order: c, b, a — active: c
    const state = await closeThreadTab("c");
    // No switch history to consult, so this falls back to the right neighbor
    // of "c" in the pre-close array order (["c", "b", "a"]), which is "b".
    expect(state.openThreadIds).toEqual(["b", "a"]);
    expect(state.activeThreadId).toBe("b");
  });

  test("falls back to the left neighbor when there's no right neighbor or history", async () => {
    const { openThreadTab, setActiveThreadTab, closeThreadTab } = await import("./open-tabs.ts");
    await openThreadTab("a");
    await openThreadTab("b");
    await openThreadTab("c"); // order: c, b, a
    await setActiveThreadTab("a"); // make the rightmost tab active
    const state = await closeThreadTab("a");
    expect(state.openThreadIds).toEqual(["c", "b"]);
    expect(state.activeThreadId).toBe("b");
  });

  test("closing the last remaining tab lands in a sane empty state", async () => {
    const { openThreadTab, closeThreadTab } = await import("./open-tabs.ts");
    await openThreadTab("a");
    const state = await closeThreadTab("a");
    expect(state.openThreadIds).toEqual([]);
    expect(state.activeThreadId).toBeNull();
  });

  test("closing an already-closed thread is a no-op and does not throw", async () => {
    const { openThreadTab, closeThreadTab } = await import("./open-tabs.ts");
    await openThreadTab("a");
    await openThreadTab("b");
    const first = await closeThreadTab("a");
    expect(first.openThreadIds).toEqual(["b"]);
    // Simulates a rapid double-click on the close button firing twice.
    const second = await closeThreadTab("a");
    expect(second.openThreadIds).toEqual(["b"]);
    expect(second.activeThreadId).toBe(first.activeThreadId);
  });
});

describe("concurrent tab mutations", () => {
  test("closing two different tabs at the same time removes both, not just the last writer's", async () => {
    const { openThreadTab, closeThreadTab, readOpenTabsState } = await import("./open-tabs.ts");
    await openThreadTab("a");
    await openThreadTab("b");
    await openThreadTab("c");
    // Fire two closes concurrently, the way the renderer can if the user
    // closes two tabs in quick succession. Neither call should read a stale
    // snapshot that undoes the other's removal.
    await Promise.all([closeThreadTab("a"), closeThreadTab("b")]);
    const state = await readOpenTabsState();
    expect(state.openThreadIds).toEqual(["c"]);
  });

  test("a switch racing a close does not resurrect the closed tab", async () => {
    const { openThreadTab, closeThreadTab, recordThreadSwitch, readOpenTabsState } = await import(
      "./open-tabs.ts"
    );
    await openThreadTab("a");
    await openThreadTab("b");
    // Closing "a" while switching to "b" races a read-modify-write on the
    // same file; "a" must stay closed rather than reappearing because
    // recordThreadSwitch read the state before the close was written.
    await Promise.all([closeThreadTab("a"), recordThreadSwitch("b")]);
    const state = await readOpenTabsState();
    expect(state.openThreadIds).toEqual(["b"]);
  });
});
