import { exec, execFile } from "node:child_process";
import { join } from "node:path";
import os from "node:os";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function isWindows(): boolean {
  return process.platform === "win32";
}

function pathDelimiter(): string {
  return isWindows() ? ";" : ":";
}

function getStandardPaths(): string[] {
  const home = os.homedir();
  const shared = [join(home, ".local", "bin"), join(home, ".bun", "bin")];
  if (isWindows()) {
    const appData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return [
      join(appData, "Microsoft", "WinGet", "Links"),
      join(appData, "Programs", "Git", "cmd"),
      join(appData, "Programs", "Git", "bin"),
      join(home, "scoop", "shims"),
      ...shared,
    ];
  }
  return ["/opt/homebrew/bin", "/usr/local/bin", ...shared];
}

/** Add GUI-visible locations for Git and user project tools to PATH. */
export function prependStandardPaths(): void {
  const delimiter = pathDelimiter();
  const paths = process.env.PATH?.split(delimiter) ?? [];
  for (const candidate of getStandardPaths().reverse()) {
    if (!paths.includes(candidate)) paths.unshift(candidate);
  }
  process.env.PATH = paths.join(delimiter);
}

export async function checkGit(): Promise<boolean> {
  try {
    const { stdout } = await execAsync("git --version");
    return stdout.toLowerCase().includes("git version");
  } catch {
    return false;
  }
}

async function commandExists(command: string): Promise<boolean> {
  try {
    if (isWindows()) await execFileAsync("where.exe", [command], { windowsHide: true });
    else await execAsync(`command -v ${command}`);
    return true;
  } catch {
    return false;
  }
}

/** Best-effort first-run Git help. Project runtimes are the user's responsibility. */
export async function installGit(): Promise<void> {
  if (await checkGit()) return;

  if (!isWindows() && (await commandExists("brew"))) {
    await execAsync("brew install git");
    prependStandardPaths();
    if (await checkGit()) return;
  }

  if (isWindows() && (await commandExists("winget"))) {
    await execFileAsync(
      "winget",
      [
        "install",
        "--id",
        "Git.Git",
        "-e",
        "--source",
        "winget",
        "--accept-package-agreements",
        "--accept-source-agreements",
        "--silent",
      ],
      { windowsHide: true },
    );
    prependStandardPaths();
    if (await checkGit()) return;
  }

  throw new Error("Git is required for projects. Install Git and restart Pipper.");
}
