import { describe, expect, test } from "vitest";
import {
  isCloseTabShortcutEvent,
  isNewTabShortcutEvent,
  tabIndexFromShortcutEvent,
  tabValueAtShortcutIndex,
  tabValuesInBarOrder,
} from "./tab-shortcuts";

function keyEvent(partial: Partial<KeyboardEvent> & Pick<KeyboardEvent, "key">): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    defaultPrevented: false,
    isComposing: false,
    code: "",
    ...partial,
  } as KeyboardEvent;
}

describe("global tab number shortcuts", () => {
  test("numbers tabs left to right: threads, then terminals", () => {
    expect(tabValuesInBarOrder(["thread-a", "thread-b"], ["term-1"], "terminal:")).toEqual([
      "thread-a",
      "thread-b",
      "terminal:term-1",
    ]);
  });

  test("⌘1–⌘4 map to the first four visible tabs", () => {
    const tabs = tabValuesInBarOrder(["t1", "t2", "t3"], ["term"], "terminal:");
    expect(tabValueAtShortcutIndex(tabs, 0)).toBe("t1");
    expect(tabValueAtShortcutIndex(tabs, 1)).toBe("t2");
    expect(tabValueAtShortcutIndex(tabs, 2)).toBe("t3");
    expect(tabValueAtShortcutIndex(tabs, 3)).toBe("terminal:term");
  });

  test("a number past the open tab count is a no-op", () => {
    expect(tabValueAtShortcutIndex(["only"], 1)).toBeNull();
    expect(tabValueAtShortcutIndex(["only"], 8)).toBeNull();
  });

  test("⌘1 through ⌘9 are recognized; other chords are not", () => {
    expect(tabIndexFromShortcutEvent(keyEvent({ key: "1", metaKey: true, code: "Digit1" }))).toBe(
      0,
    );
    expect(tabIndexFromShortcutEvent(keyEvent({ key: "4", ctrlKey: true, code: "Digit4" }))).toBe(
      3,
    );
    expect(tabIndexFromShortcutEvent(keyEvent({ key: "9", metaKey: true, code: "Digit9" }))).toBe(
      8,
    );
    expect(tabIndexFromShortcutEvent(keyEvent({ key: "1" }))).toBeNull();
    expect(
      tabIndexFromShortcutEvent(keyEvent({ key: "1", metaKey: true, shiftKey: true })),
    ).toBeNull();
    expect(
      tabIndexFromShortcutEvent(keyEvent({ key: "0", metaKey: true, code: "Digit0" })),
    ).toBeNull();
  });

  test("⌘T / Ctrl+T is the new-tab shortcut", () => {
    expect(isNewTabShortcutEvent(keyEvent({ key: "t", metaKey: true, code: "KeyT" }))).toBe(true);
    expect(isNewTabShortcutEvent(keyEvent({ key: "T", ctrlKey: true, code: "KeyT" }))).toBe(true);
    expect(isNewTabShortcutEvent(keyEvent({ key: "t" }))).toBe(false);
    expect(
      isNewTabShortcutEvent(keyEvent({ key: "t", metaKey: true, shiftKey: true, code: "KeyT" })),
    ).toBe(false);
  });

  test("⌘W / Ctrl+W is the close-tab shortcut", () => {
    expect(isCloseTabShortcutEvent(keyEvent({ key: "w", metaKey: true, code: "KeyW" }))).toBe(true);
    expect(isCloseTabShortcutEvent(keyEvent({ key: "W", ctrlKey: true, code: "KeyW" }))).toBe(true);
    expect(isCloseTabShortcutEvent(keyEvent({ key: "w" }))).toBe(false);
    expect(
      isCloseTabShortcutEvent(keyEvent({ key: "w", metaKey: true, shiftKey: true, code: "KeyW" })),
    ).toBe(false);
  });
});
