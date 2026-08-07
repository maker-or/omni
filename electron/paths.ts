import { app } from "electron";
import { join } from "node:path";
import os from "node:os";

/** User-owned storage that remains for launcher update artifacts and state. */
export function getPipperLibraryPath(): string {
  if (process.env.PIPPER_LIBRARY_PATH) return process.env.PIPPER_LIBRARY_PATH;
  try {
    return process.platform === "darwin"
      ? join(os.homedir(), "Library/pipper")
      : join(app.getPath("appData"), "pipper");
  } catch {
    const home = os.homedir();
    if (process.platform === "win32") {
      return join(process.env.APPDATA || join(home, "AppData/Roaming"), "pipper");
    }
    return process.platform === "darwin"
      ? join(home, "Library/pipper")
      : join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "pipper");
  }
}
