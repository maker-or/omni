import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// Prepend standard macOS search paths to process.env.PATH.
// This ensures that GUI Electron apps can resolve binaries like git, node, bun, and mise.
const homeDir = os.homedir();
const standardPaths = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  join(homeDir, ".local/bin"),
  join(homeDir, ".bun/bin"),
  join(homeDir, ".local/share/mise/shims"),
  join(homeDir, ".local/share/mise/bin"),
];

export function prependStandardPaths(): void {
  const currentPaths = process.env.PATH ? process.env.PATH.split(":") : [];
  for (const p of standardPaths) {
    if (!currentPaths.includes(p)) {
      currentPaths.unshift(p); // Prepend so standard paths take precedence
    }
  }
  process.env.PATH = currentPaths.join(":");
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
  const localMise = join(os.homedir(), ".local/bin/mise");
  if (existsSync(localMise)) return localMise;
  const alternateMise = join(os.homedir(), ".local/share/mise/bin/mise");
  if (existsSync(alternateMise)) return alternateMise;
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
  return (
    existsSync(join(os.homedir(), ".local/bin/mise")) ||
    existsSync(join(os.homedir(), ".local/share/mise/bin/mise"))
  );
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

export async function installMise(): Promise<void> {
  const ok = await checkMise();
  if (ok) return;
  console.log("[DependencyInstaller] Installing Mise via curl...");
  try {
    // Run the official Mise installer sh script
    await execAsync("curl https://mise.run | sh");
  } catch (err: any) {
    console.error("[DependencyInstaller] Error running curl installation for Mise:", err);
    throw err;
  }
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
