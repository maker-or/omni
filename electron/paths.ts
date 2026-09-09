import { app } from "electron";
import { join } from "node:path";
import os from "node:os";

/** Shared with the sandboxed App Intents extension on macOS. */
export const PIPPER_APP_GROUP_IDENTIFIER = "group.com.maker-or.omni.pipper";

/** Primary user-owned storage (ad-hoc-friendly, no Team ID required). */
export function getPipperSharedPath(): string {
  if (process.env.PIPPER_LIBRARY_PATH) return process.env.PIPPER_LIBRARY_PATH;
  return process.platform === "darwin"
    ? join(os.homedir(), "Library", "pipper")
    : join(app.getPath("appData"), "pipper");
}

/** User-owned storage that remains for launcher update artifacts and state. */
export function getPipperLibraryPath(): string {
  return getPipperSharedPath();
}
