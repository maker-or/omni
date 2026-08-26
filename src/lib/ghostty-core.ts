import { GhosttyCore } from "@wterm/ghostty";
import ghosttyWasmUrl from "@wterm/ghostty/ghostty-vt.wasm?url";

export const GHOSTTY_SCROLLBACK_LIMIT_BYTES = 1024 * 1024;

export function loadGhosttyCore(): Promise<GhosttyCore> {
  // Vite owns the emitted URL while the package owns the version-matched
  // binary. Passing it explicitly also permits Electron's file:// renderer.
  return GhosttyCore.load({
    wasmPath: ghosttyWasmUrl,
    scrollbackLimit: GHOSTTY_SCROLLBACK_LIMIT_BYTES,
  });
}
