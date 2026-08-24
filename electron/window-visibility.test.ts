import { describe, expect, test } from "vitest";

import { WindowVisibilityGate } from "./window-visibility.ts";

describe("WindowVisibilityGate", () => {
  test("starts visible (fail-open) before any report", () => {
    const gate = new WindowVisibilityGate();
    expect(gate.isVisible()).toBe(true);
  });

  test("window events flip visibility", () => {
    const gate = new WindowVisibilityGate();
    gate.setWindowVisible(false);
    expect(gate.isVisible()).toBe(false);
    gate.setWindowVisible(true);
    expect(gate.isVisible()).toBe(true);
  });

  test("a hidden renderer report keeps the window hidden even if window claims visible", () => {
    // Models occlusion: BrowserWindow says visible, Chromium page says hidden.
    const gate = new WindowVisibilityGate();
    gate.setRendererVisible(false);
    expect(gate.isVisible()).toBe(false);
    gate.setRendererVisible(true);
    expect(gate.isVisible()).toBe(true);
  });

  test("both sources must agree to be visible", () => {
    const gate = new WindowVisibilityGate();
    gate.setWindowVisible(false);
    gate.setRendererVisible(true);
    expect(gate.isVisible()).toBe(false);
  });

  test("onChange fires only on effective transitions", () => {
    const gate = new WindowVisibilityGate();
    const seen: boolean[] = [];
    gate.onChange((visible) => seen.push(visible));

    gate.setWindowVisible(false);
    gate.setWindowVisible(false); // no-op
    gate.setRendererVisible(true); // still hidden overall
    gate.setRendererVisible(false); // already hidden — no transition
    gate.setWindowVisible(true);
    gate.setRendererVisible(true);

    expect(seen).toEqual([false, true]);
  });
});
