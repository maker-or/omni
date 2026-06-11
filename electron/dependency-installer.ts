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

export function getMisePath(): string {
  if (isMiseGlobal) return "mise";
  const localMise = join(os.homedir(), ".local/bin/mise");
  if (existsSync(localMise)) return localMise;
  return join(os.homedir(), ".local/share/mise/bin/mise");
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
    const { stdout } = await execAsync("node -v");
    const parsed = parseSemver(stdout.trim());
    if (!parsed) {
      console.log("[DependencyInstaller] Node version parse failed for output:", stdout);
      return false;
    }
    // We expect Node v24 as verified in development environment
    return parsed.major === 24;
  } catch (err: any) {
    console.log("[DependencyInstaller] Node version check failed:", err.message || err);
    return false;
  }
}

export async function checkBun(): Promise<boolean> {
  try {
    const { stdout } = await execAsync("bun --version");
    const parsed = parseSemver(stdout.trim());
    if (!parsed) {
      console.log("[DependencyInstaller] Bun version parse failed for output:", stdout);
      return false;
    }
    // We expect Bun v1.3 as verified in development environment
    return parsed.major === 1 && parsed.minor >= 3;
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
  console.log("[DependencyInstaller] Installing Node 24 and Bun 1.3 via Mise...");
  try {
    // Mise will read from local configs but we can pre-install them globally or locally
    await execAsync(`"${mise}" install node@24`);
    await execAsync(`"${mise}" install bun@1.3`);
  } catch (err: any) {
    console.error("[DependencyInstaller] Error installing Node/Bun via Mise command:", err);
    throw err;
  }
  console.log("[DependencyInstaller] Node 24 and Bun 1.3 installed via Mise.");
}
