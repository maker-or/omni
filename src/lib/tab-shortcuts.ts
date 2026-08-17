/**
 * Global tab-bar shortcuts.
 *
 * Visible tabs are numbered left → right, starting at 1. ⌘1 / Ctrl+1 selects
 * the first tab, ⌘2 the second, through ⌘9. Tabs past the ninth have no
 * number key; a press for an empty slot is a no-op.
 *
 * ⌘T / Ctrl+T opens a new thread draft — the same action as "New thread" in
 * the tab-bar plus menu. A draft is tab-less until the first send.
 *
 * Bindings live here so a future settings keymap can override the defaults
 * without changing the tab-bar itself.
 */

export const TAB_SHORTCUT_MAX_INDEX = 8;

export function tabValuesInBarOrder(
  threadIds: readonly string[],
  terminalIds: readonly string[],
  terminalPrefix: string,
): string[] {
  return [...threadIds, ...terminalIds.map((id) => `${terminalPrefix}${id}`)];
}

export function tabValueAtShortcutIndex(tabValues: readonly string[], index: number): string | null {
  if (!Number.isInteger(index) || index < 0 || index > TAB_SHORTCUT_MAX_INDEX) return null;
  return tabValues[index] ?? null;
}

/**
 * Returns the 0-based tab index for a number-row shortcut, or null if the
 * event is not a tab-switch binding.
 */
function isPlainModShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.shiftKey || event.repeat) return false;
  if (event.isComposing) return false;
  return event.metaKey || event.ctrlKey;
}

export function tabIndexFromShortcutEvent(event: KeyboardEvent): number | null {
  if (!isPlainModShortcut(event)) return null;

  const fromCode = event.code.match(/^Digit([1-9])$/);
  const fromKey = /^[1-9]$/.test(event.key) ? event.key : null;
  const digit = fromCode?.[1] ?? fromKey;
  if (!digit) return null;

  return Number(digit) - 1;
}

/** ⌘T / Ctrl+T — new thread draft. */
export function isNewTabShortcutEvent(event: KeyboardEvent): boolean {
  if (!isPlainModShortcut(event)) return false;
  return event.code === "KeyT" || event.key.toLowerCase() === "t";
}
