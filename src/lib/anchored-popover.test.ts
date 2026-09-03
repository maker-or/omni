import { describe, expect, test } from "vitest";
import { calculateAnchoredPopoverPosition } from "./anchored-popover";

const viewport = {
  viewportWidth: 1000,
  viewportHeight: 800,
  popoverWidth: 360,
};

describe("anchored popover placement", () => {
  test("opens below a composer near the top", () => {
    const position = calculateAnchoredPopoverPosition(
      { top: 40, right: 840, bottom: 84, left: 160, width: 680 },
      viewport,
    );

    expect(position.placement).toBe("bottom");
    expect(position.top).toBe(90);
    expect(position.bottom).toBeUndefined();
  });

  test("opens above a composer near the bottom", () => {
    const position = calculateAnchoredPopoverPosition(
      { top: 700, right: 840, bottom: 744, left: 160, width: 680 },
      viewport,
    );

    expect(position.placement).toBe("top");
    expect(position.bottom).toBe(106);
    expect(position.top).toBeUndefined();
  });

  test("uses the roomier side around the viewport midpoint", () => {
    const position = calculateAnchoredPopoverPosition(
      { top: 300, right: 840, bottom: 344, left: 160, width: 680 },
      viewport,
    );

    expect(position.placement).toBe("bottom");
    expect(position.maxHeight).toBe(442);
  });

  test("keeps anchored-width menus inside the viewport", () => {
    const position = calculateAnchoredPopoverPosition(
      { top: 40, right: 1080, bottom: 84, left: 900, width: 180 },
      { ...viewport, popoverWidth: "anchor" },
    );

    expect(position.width).toBe(180);
    expect(position.left).toBe(812);
  });

  test("keeps a slash menu usable when its text anchor is only one glyph wide", () => {
    const position = calculateAnchoredPopoverPosition(
      { top: 40, right: 112, bottom: 84, left: 104, width: 8 },
      { ...viewport, popoverWidth: "anchor", minWidth: 320 },
    );

    expect(position.width).toBe(320);
    expect(position.left).toBe(104);
  });
});
