import { exec, execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
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

function getWindowsLocalAppData(): string {
  return process.env.LOCALAPPDATA ?? join(os.homedir(), "AppData", "Local");
}

function getMiseShimPaths(): string[] {
  const homeDir = os.homedir();
  const shared = [
    join(homeDir, ".local", "share", "mise", "shims"),
    join(homeDir, ".local", "share", "mise", "bin"),
  ];

  if (!isWindows()) return shared;

  const localAppData = getWindowsLocalAppData();
  return [join(localAppData, "mise", "shims"), join(localAppData, "mise", "bin"), ...shared];
}

function getStandardPaths(): string[] {
  const homeDir = os.homedir();
  const shared = [
    join(homeDir, ".local", "bin"),
    join(homeDir, ".bun", "bin"),
    ...getMiseShimPaths(),
  ];

  if (isWindows()) {
    const localAppData = getWindowsLocalAppData();
    return [
      join(localAppData, "Microsoft", "WinGet", "Links"),
      join(localAppData, "Programs", "Git", "cmd"),
      join(localAppData, "Programs", "Git", "bin"),
      join(homeDir, "scoop", "shims"),
      join(homeDir, "scoop", "apps", "mise", "current"),
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
  const shared = [
    join(homeDir, ".local", "bin", executable),
    join(homeDir, ".local", "share", "mise", "bin", executable),
  ];

  if (!isWindows()) return shared;

  const localAppData = getWindowsLocalAppData();
  return [
    join(localAppData, "Microsoft", "WinGet", "Links", executable),
    join(homeDir, "scoop", "apps", "mise", "current", executable),
    join(homeDir, "scoop", "shims", executable),
    ...shared,
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

/**
 * Env for `mise exec` children with bun's fake-node shim dirs stripped from
 * PATH. When the app itself is launched via `bun run` / `bunx --bun` (dev),
 * bun prepends a temp dir whose `node` is a symlink to bun; that shim wins
 * over mise's runtime, so `node -v` reports bun and version verification
 * fails — misrouting dev launches into the launcher with a setup error.
 */
export function getMiseExecEnv(): NodeJS.ProcessEnv {
  const delimiter = pathDelimiter();
  const path = process.env.PATH ?? "";
  return {
    ...process.env,
    PATH: path
      .split(delimiter)
      .filter((entry) => !/[\\/]bun-node-[^\\/]*$/.test(entry))
      .join(delimiter),
  };
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

async function commandExists(command: string): Promise<boolean> {
  try {
    if (isWindows()) {
      await execFileAsync("where.exe", [command], { windowsHide: true });
    } else {
      await execAsync(`command -v ${command}`);
    }
    return true;
  } catch {
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
  if (!(await commandExists("winget"))) {
    console.log("[DependencyInstaller] winget is not available; skipping Git winget install.");
    return false;
  }

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
    prependStandardPaths();
    return checkGit();
  }
}

async function installGitFromGitHubRelease(): Promise<boolean> {
  const script = `
$ErrorActionPreference = 'Stop'
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { '64-bit' }
$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/git-for-windows/git/releases/latest' -Headers @{ 'User-Agent' = 'Pipper' }
$asset = $release.assets | Where-Object { $_.name -match "^Git-.*-$arch\\.exe$" } | Select-Object -First 1
if (-not $asset) { throw "No Git for Windows $arch installer found for $($release.tag_name)" }
$installer = Join-Path $env:TEMP 'pipper-git-install.exe'
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $installer -UseBasicParsing
$process = Start-Process -FilePath $installer -ArgumentList '/VERYSILENT','/NORESTART' -PassThru -Wait
Remove-Item $installer -Force
if ($process.ExitCode -ne 0) { throw "Git installer exited with code $($process.ExitCode)" }
`.trim();

  try {
    console.log("[DependencyInstaller] Installing Git via Git for Windows release download...");
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 10 * 60 * 1000 },
    );
    prependStandardPaths();
    return checkGit();
  } catch (err: any) {
    console.log(
      "[DependencyInstaller] Git for Windows release install failed:",
      err.message || err,
    );
    prependStandardPaths();
    return checkGit();
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

  if (isWindows() && (await installGitFromGitHubRelease())) {
    console.log("[DependencyInstaller] Git installed successfully via Git for Windows.");
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
    const { stdout } = await execAsync(getMiseExecCommand("node -v"), { env: getMiseExecEnv() });
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
    const { stdout } = await execAsync(getMiseExecCommand("bun --version"), {
      env: getMiseExecEnv(),
    });
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

async function ensureMiseWindowsUserPath(): Promise<void> {
  const homeDir = os.homedir();
  const localAppData = getWindowsLocalAppData();
  const pathsToAdd = [join(homeDir, ".local", "bin"), join(localAppData, "mise", "shims")];
  const pathsLiteral = pathsToAdd.map((entry) => `'${entry.replace(/\\/g, "\\\\")}'`).join(", ");

  const script = `
$pathsToAdd = @(${pathsLiteral})
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$segments = if ($userPath) { $userPath -split ';' | Where-Object { $_ } } else { @() }
$changed = $false
foreach ($candidate in $pathsToAdd) {
  if ($segments -notcontains $candidate) {
    $segments += $candidate
    $changed = $true
  }
}
if ($changed) {
  [Environment]::SetEnvironmentVariable('Path', ($segments -join ';'), 'User')
}
`.trim();

  try {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true },
    );
    prependStandardPaths();
  } catch (err: any) {
    console.log("[DependencyInstaller] Failed to persist Mise user PATH:", err.message || err);
  }
}

async function installMiseUnix(): Promise<void> {
  console.log("[DependencyInstaller] Installing Mise via curl...");
  await execAsync("curl https://mise.run | sh");
}

async function installMiseWithWinget(): Promise<boolean> {
  if (!(await commandExists("winget"))) {
    console.log("[DependencyInstaller] winget is not available; skipping Mise winget install.");
    return false;
  }

  try {
    console.log("[DependencyInstaller] Installing Mise via winget...");
    await execFileAsync(
      "winget",
      [
        "install",
        "--id",
        "jdx.mise",
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
    return checkMise();
  } catch (err: any) {
    console.log("[DependencyInstaller] winget Mise install failed:", err.message || err);
    prependStandardPaths();
    return checkMise();
  }
}

async function installMiseWithScoop(): Promise<boolean> {
  if (!(await commandExists("scoop"))) {
    console.log("[DependencyInstaller] Scoop is not available; skipping Mise Scoop install.");
    return false;
  }

  try {
    console.log("[DependencyInstaller] Installing Mise via Scoop...");
    await execFileAsync("scoop", ["install", "mise"], { windowsHide: true });
    prependStandardPaths();
    return checkMise();
  } catch (err: any) {
    console.log("[DependencyInstaller] Scoop Mise install failed:", err.message || err);
    prependStandardPaths();
    return checkMise();
  }
}

async function installMiseFromGitHubRelease(): Promise<boolean> {
  const homeDir = os.homedir();
  const installDir = join(homeDir, ".local", "bin");
  const misePath = join(installDir, miseExecutableName());
  const installDirPs = installDir.replace(/\\/g, "\\\\");

  const script = `
$ErrorActionPreference = 'Stop'
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/jdx/mise/releases/latest' -Headers @{ 'User-Agent' = 'Pipper' }
$version = $release.tag_name
$assetName = "mise-$version-windows-$arch.zip"
$asset = $release.assets | Where-Object { $_.name -eq $assetName }
if (-not $asset) { throw "No Windows $arch asset for $version" }
$zip = Join-Path $env:TEMP 'pipper-mise-install.zip'
$extract = Join-Path $env:TEMP 'pipper-mise-install-extract'
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $extract -Force
$installDir = '${installDirPs}'
if (-not (Test-Path $installDir)) { New-Item -ItemType Directory -Path $installDir -Force | Out-Null }
Copy-Item (Join-Path $extract 'mise\\bin\\mise.exe') (Join-Path $installDir 'mise.exe') -Force
Remove-Item $zip -Force
Remove-Item $extract -Recurse -Force
`.trim();

  try {
    console.log("[DependencyInstaller] Installing Mise via GitHub release download...");
    mkdirSync(installDir, { recursive: true });
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true },
    );
    prependStandardPaths();
    if (!existsSync(misePath) && !(await checkMise())) return false;
    await execFileAsync(misePath, ["--version"], { windowsHide: true });
    await ensureMiseWindowsUserPath();
    return true;
  } catch (err: any) {
    console.log("[DependencyInstaller] GitHub release Mise install failed:", err.message || err);
    prependStandardPaths();
    return checkMise();
  }
}

async function finalizeMiseWindowsInstall(method: string): Promise<void> {
  await ensureMiseWindowsUserPath();
  console.log(`[DependencyInstaller] Mise installed successfully via ${method}.`);
}

async function installMiseWindows(): Promise<void> {
  if (await installMiseWithWinget()) {
    await finalizeMiseWindowsInstall("winget");
    return;
  }

  if (await installMiseWithScoop()) {
    await finalizeMiseWindowsInstall("Scoop");
    return;
  }

  if (await installMiseFromGitHubRelease()) {
    console.log("[DependencyInstaller] Mise installed successfully via GitHub release.");
    return;
  }

  throw new Error(
    "Mise installation failed. Pipper needs PowerShell and internet access to download Mise automatically. Restart Pipper after installing Mise manually.",
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
      prependStandardPaths();
      const verified = await checkMise();
      if (!verified) {
        throw new Error("Mise installation failed or executable was not found at standard path.");
      }
      console.log("[DependencyInstaller] Mise installed successfully.");
    }
  } catch (err: any) {
    console.error("[DependencyInstaller] Error installing Mise:", err);
    throw err;
  }
}

export async function installNodeAndBunWithMise(): Promise<void> {
  const mise = getMisePath();
  console.log(
    `[DependencyInstaller] Installing Node ${REQUIRED_NODE_VERSION} and Bun ${REQUIRED_BUN_VERSION} via Mise...`,
  );
  try {
    await execAsync(`"${mise}" install node@${REQUIRED_NODE_VERSION}`);
    await execAsync(`"${mise}" install bun@${REQUIRED_BUN_VERSION}`);
    if (isWindows()) {
      await execAsync(`"${mise}" reshim`);
      prependStandardPaths();
      await ensureMiseWindowsUserPath();
    }
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
