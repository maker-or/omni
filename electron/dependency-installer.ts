import { exec, execFile } from "node:child_process";
import { existsSync } from "node:fs";
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

function miseExecutableName(): string {
  return isWindows() ? "mise.exe" : "mise";
}

function getStandardPaths(): string[] {
  const homeDir = os.homedir();
  const shared = [
    join(homeDir, ".local", "bin"),
    join(homeDir, ".bun", "bin"),
    join(homeDir, ".local", "share", "mise", "shims"),
    join(homeDir, ".local", "share", "mise", "bin"),
  ];

  if (isWindows()) {
    const localAppData = process.env.LOCALAPPDATA ?? join(homeDir, "AppData", "Local");
    return [
      join(localAppData, "Programs", "Git", "cmd"),
      join(localAppData, "Programs", "Git", "bin"),
      join(homeDir, "scoop", "shims"),
      ...shared,
    ];
  }

  return ["/opt/homebrew/bin", "/usr/local/bin", ...shared];
}

// Prepend standard search paths to process.env.PATH so GUI Electron apps can resolve git, mise, and bun.
export function prependStandardPaths(): void {
  const delimiter = pathDelimiter();
  const currentPaths = process.env.PATH ? process.env.PATH.split(delimiter) : [];
  for (const candidate of getStandardPaths()) {
    if (!currentPaths.includes(candidate)) {
      currentPaths.unshift(candidate);
    }
  }
  process.env.PATH = currentPaths.join(delimiter);
}

export interface DependencyStatus {
  gitInstalled: boolean;
  nodeMatch: boolean;
  bunMatch: boolean;
  miseInstalled: boolean;
}

export const REQUIRED_NODE_VERSION = "24.13.1";
export const REQUIRED_BUN_VERSION = "1.3.11";

let isMiseGlobal = false;

function getMiseCandidatePaths(): string[] {
  const homeDir = os.homedir();
  const executable = miseExecutableName();
  return [
    join(homeDir, ".local", "bin", executable),
    join(homeDir, ".local", "share", "mise", "bin", executable),
  ];
}

export async function checkMiseGlobal(): Promise<boolean> {
  try {
    const { stdout } = await execAsync("mise --version");
    if (stdout.toLowerCase().includes("mise")) {
      isMiseGlobal = true;
      return true;
    }
    return false;
  } catch (err: any) {
    console.log("[DependencyInstaller] Global mise check failed/not found:", err.message || err);
    return false;
  }
}

function resolveMisePath(): string | null {
  if (isMiseGlobal) return "mise";
  for (const candidate of getMiseCandidatePaths()) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function getMisePath(): string {
  const mise = resolveMisePath();
  if (!mise) {
    throw new Error(
      "Mise executable was not found. Run dependency setup before launching a project.",
    );
  }
  return mise;
}

export function getMiseExecArgs(command: string[]): string[] {
  return ["exec", `node@${REQUIRED_NODE_VERSION}`, `bun@${REQUIRED_BUN_VERSION}`, "--", ...command];
}

export function getMiseExecCommand(command: string): string {
  const mise = getMisePath();
  return `"${mise}" exec node@${REQUIRED_NODE_VERSION} bun@${REQUIRED_BUN_VERSION} -- ${command}`;
}

export async function checkMise(): Promise<boolean> {
  const globalOk = await checkMiseGlobal();
  if (globalOk) return true;
  return getMiseCandidatePaths().some((candidate) => existsSync(candidate));
}

function parseSemver(versionStr: string): { major: number; minor: number } | null {
  const match = versionStr.match(/v?(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
  };
}

export async function checkGit(): Promise<boolean> {
  try {
    const { stdout } = await execAsync("git --version");
    return stdout.toLowerCase().includes("git version");
  } catch (err: any) {
    console.log("[DependencyInstaller] Git version check failed:", err.message || err);
    return false;
  }
}

async function installGitWithHomebrew(): Promise<boolean> {
  try {
    await execAsync("brew --version");
    console.log("[DependencyInstaller] Installing Git via Homebrew...");
    await execAsync("brew install git");
    prependStandardPaths();
    return checkGit();
  } catch (err: any) {
    console.log("[DependencyInstaller] Homebrew Git install unavailable:", err.message || err);
    return false;
  }
}

async function installGitWithWinget(): Promise<boolean> {
  try {
    console.log("[DependencyInstaller] Installing Git via winget...");
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
    return checkGit();
  } catch (err: any) {
    console.log("[DependencyInstaller] winget Git install failed:", err.message || err);
    return false;
  }
}

async function installGitWithMise(): Promise<boolean> {
  await installMise();
  const mise = getMisePath();
  console.log("[DependencyInstaller] Installing Git via Mise...");
  await execAsync(`"${mise}" install git`);
  prependStandardPaths();
  return checkGit();
}

export async function installGit(): Promise<void> {
  if (await checkGit()) return;

  if (!isWindows() && (await installGitWithHomebrew())) {
    console.log("[DependencyInstaller] Git installed successfully via Homebrew.");
    return;
  }

  if (isWindows() && (await installGitWithWinget())) {
    console.log("[DependencyInstaller] Git installed successfully via winget.");
    return;
  }

  if (await installGitWithMise()) {
    console.log("[DependencyInstaller] Git installed successfully via Mise.");
    return;
  }

  throw new Error("Git installation failed. Restart Pipper after installing Git manually.");
}

export async function checkNode(): Promise<boolean> {
  try {
    if (!(await checkMise())) return false;
    const { stdout } = await execAsync(getMiseExecCommand("node -v"));
    const parsed = parseSemver(stdout.trim());
    if (!parsed) {
      console.log("[DependencyInstaller] Node version parse failed for output:", stdout);
      return false;
    }
    return stdout.trim().replace(/^v/, "") === REQUIRED_NODE_VERSION;
  } catch (err: any) {
    console.log("[DependencyInstaller] Node version check failed:", err.message || err);
    return false;
  }
}

export async function checkBun(): Promise<boolean> {
  try {
    if (!(await checkMise())) return false;
    const { stdout } = await execAsync(getMiseExecCommand("bun --version"));
    const parsed = parseSemver(stdout.trim());
    if (!parsed) {
      console.log("[DependencyInstaller] Bun version parse failed for output:", stdout);
      return false;
    }
    return stdout.trim() === REQUIRED_BUN_VERSION;
  } catch (err: any) {
    console.log("[DependencyInstaller] Bun version check failed:", err.message || err);
    return false;
  }
}

export async function checkAllDependencies(): Promise<DependencyStatus> {
  const [gitInstalled, nodeMatch, bunMatch, miseInstalled] = await Promise.all([
    checkGit(),
    checkNode(),
    checkBun(),
    checkMise(),
  ]);
  console.log(`[DependencyInstaller] Checking dependencies...`, {
    gitInstalled,
    nodeMatch,
    bunMatch,
    miseInstalled,
  });

  return {
    gitInstalled,
    nodeMatch,
    bunMatch,
    miseInstalled,
  };
}

async function installMiseUnix(): Promise<void> {
  console.log("[DependencyInstaller] Installing Mise via curl...");
  await execAsync("curl https://mise.run | sh");
}

async function installMiseWindows(): Promise<void> {
  console.log("[DependencyInstaller] Installing Mise via PowerShell...");
  await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://mise.run | iex"],
    { windowsHide: true },
  );
}

export async function installMise(): Promise<void> {
  const ok = await checkMise();
  if (ok) return;

  try {
    if (isWindows()) {
      await installMiseWindows();
    } else {
      await installMiseUnix();
    }
  } catch (err: any) {
    console.error("[DependencyInstaller] Error installing Mise:", err);
    throw err;
  }

  prependStandardPaths();

  const verified = await checkMise();
  if (!verified) {
    throw new Error("Mise installation failed or executable was not found at standard path.");
  }
  console.log("[DependencyInstaller] Mise installed successfully.");
}

export async function installNodeAndBunWithMise(): Promise<void> {
  const mise = getMisePath();
  console.log(
    `[DependencyInstaller] Installing Node ${REQUIRED_NODE_VERSION} and Bun ${REQUIRED_BUN_VERSION} via Mise...`,
  );
  try {
    await execAsync(`"${mise}" install node@${REQUIRED_NODE_VERSION}`);
    await execAsync(`"${mise}" install bun@${REQUIRED_BUN_VERSION}`);
  } catch (err: any) {
    console.error("[DependencyInstaller] Error installing Node/Bun via Mise command:", err);
    throw err;
  }
  const [nodeOk, bunOk] = await Promise.all([checkNode(), checkBun()]);
  if (!nodeOk || !bunOk) {
    throw new Error(
      `Mise installed runtime versions, but verification failed. Required Node ${REQUIRED_NODE_VERSION}, Bun ${REQUIRED_BUN_VERSION}.`,
    );
  }
  console.log("[DependencyInstaller] Required Node and Bun versions installed via Mise.");
}
