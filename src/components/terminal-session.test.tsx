import { describe, expect, it } from "vitest";
import {
  areTerminalSessionPropsEqual,
  calculateTerminalGridSize,
  normalizeTerminalSize,
} from "./terminal-session";

describe("terminal session sizing", () => {
  it("calculates the full grid before WTerm mounts", () => {
    expect(calculateTerminalGridSize(1_280, 720, 8, 18)).toEqual({
      cols: 160,
      rows: 40,
    });
  });

  it("ignores zero-sized hidden measurements and clamps unsafe dimensions", () => {
    expect(calculateTerminalGridSize(0, 720, 8, 18)).toBeNull();
    expect(normalizeTerminalSize(1, 5_000)).toEqual({ cols: 2, rows: 1_000 });
  });

  it("skips rerenders for terminal sessions unaffected by a tab switch", () => {
    const previous = { sessionId: "terminal-1", cwd: "/repo", isActive: false };
    expect(areTerminalSessionPropsEqual(previous, { ...previous })).toBe(true);
    expect(areTerminalSessionPropsEqual(previous, { ...previous, isActive: true })).toBe(false);
  });
});
