import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** AppKit resolves the user's current page-swipe preference, including Off. */
export async function isFluidPageSwipeEnabled(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        'ObjC.import("AppKit"); $.NSEvent.isSwipeTrackingFromScrollEventsEnabled',
      ],
      { timeout: 3000 },
    );
    return stdout.trim() === "true";
  } catch {
    // If the system preference cannot be read, leave ordinary scrolling alone.
    return false;
  }
}
