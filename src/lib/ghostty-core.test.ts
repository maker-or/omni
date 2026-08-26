import { beforeEach, describe, expect, it, vi } from "vitest";

const { load } = vi.hoisted(() => ({
  load: vi.fn(),
}));

vi.mock("@wterm/ghostty", () => ({
  GhosttyCore: { load },
}));

vi.mock("@wterm/ghostty/ghostty-vt.wasm?url", () => ({
  default: "/assets/version-matched-ghostty.wasm",
}));

import { GHOSTTY_SCROLLBACK_LIMIT_BYTES, loadGhosttyCore } from "./ghostty-core";

describe("loadGhosttyCore", () => {
  beforeEach(() => {
    load.mockReset();
  });

  it("loads the version-matched package asset through an Electron-safe explicit URL", async () => {
    const core = {};
    load.mockResolvedValue(core);

    await expect(loadGhosttyCore()).resolves.toBe(core);
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith({
      wasmPath: "/assets/version-matched-ghostty.wasm",
      scrollbackLimit: GHOSTTY_SCROLLBACK_LIMIT_BYTES,
    });
  });
});
