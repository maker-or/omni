import { cpSync, rmSync, symlinkSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getMisePath } from "./dependency-installer";

const execAsync = promisify(exec);

export function getPipperLibraryPath(): string {
  return join(os.homedir(), "Library/pipper");
}

export function getActivePath(): string {
  return join(getPipperLibraryPath(), "active");
}

export function getBackupPath(): string {
  return join(getPipperLibraryPath(), "backup");
}

export function getSharedPath(): string {
  return join(getPipperLibraryPath(), "shared");
}

function copyTemplateFiles(srcDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  const entries = readdirSync(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const name = entry.name;
    // Exclude launcher binary code, caches, and node_modules from the clone
    if (
      name === "node_modules" ||
      name === "electron" ||
      name === "out" ||
      name === ".git" ||
      name === "dist" ||
      name === ".env"
    ) {
      continue;
    }
    const srcPath = join(srcDir, name);
    const destPath = join(destDir, name);

    cpSync(srcPath, destPath, { recursive: true });
  }
}

export async function initializeWorkspaces(
  appResourcesPath: string,
  isDev: boolean,
): Promise<void> {
  const libRoot = getPipperLibraryPath();
  const activeDir = getActivePath();
  const backupDir = getBackupPath();
  const sharedDir = getSharedPath();

  mkdirSync(libRoot, { recursive: true });
  mkdirSync(sharedDir, { recursive: true });

  // Resolve template source path
  const templatePath = isDev ? process.cwd() : join(appResourcesPath, "app-template");

  console.log(`[WorkspaceManager] Initializing workspaces from: ${templatePath}`);

  // 1. Copy source files to active if not present
  if (!existsSync(activeDir) || readdirSync(activeDir).length === 0) {
    console.log("[WorkspaceManager] Copying files to active workspace...");
    copyTemplateFiles(templatePath, activeDir);
  }

  // 2. Copy source files to backup if not present
  if (!existsSync(backupDir) || readdirSync(backupDir).length === 0) {
    console.log("[WorkspaceManager] Copying files to backup workspace...");
    copyTemplateFiles(templatePath, backupDir);
  }

  // 3. Initialize package.json inside shared directory for dependency installation
  const activePkgJson = join(activeDir, "package.json");
  const sharedPkgJson = join(sharedDir, "package.json");
  if (existsSync(activePkgJson) && !existsSync(sharedPkgJson)) {
    try {
      const pkg = JSON.parse(readFileSync(activePkgJson, "utf8"));
      if (pkg.scripts) {
        delete pkg.scripts.postinstall;
      }
      writeFileSync(sharedPkgJson, JSON.stringify(pkg, null, 2), "utf8");
      console.log("[WorkspaceManager] Created cleaned package.json in shared folder (removed postinstall).");
    } catch (err) {
      console.error("[WorkspaceManager] Failed to create cleaned package.json in shared folder:", err);
      cpSync(activePkgJson, sharedPkgJson);
    }
  }

  // 4. Run dependency setup inside shared directory
  const sharedNodeModules = join(sharedDir, "node_modules");
  if (!existsSync(sharedNodeModules)) {
    console.log("[WorkspaceManager] Installing workspace dependencies inside shared folder...");
    const mise = getMisePath();
    // Run bun install using local Mise environment
    try {
      await execAsync(`"${mise}" exec -- bun install`, { cwd: sharedDir });
    } catch (err: any) {
      console.error("[WorkspaceManager] dependency installation command failed!");
      if (err.stdout) console.error("[WorkspaceManager] stdout:\n", err.stdout);
      if (err.stderr) console.error("[WorkspaceManager] stderr:\n", err.stderr);
      throw err;
    }
  }

  // 5. Establish symlinks inside active/backup if missing
  const activeNodeModules = join(activeDir, "node_modules");
  if (!existsSync(activeNodeModules)) {
    console.log("[WorkspaceManager] Linking shared node_modules to active workspace...");
    symlinkSync(sharedNodeModules, activeNodeModules, "dir");
  }

  const backupNodeModules = join(backupDir, "node_modules");
  if (!existsSync(backupNodeModules)) {
    console.log("[WorkspaceManager] Linking shared node_modules to backup workspace...");
    symlinkSync(sharedNodeModules, backupNodeModules, "dir");
  }

  console.log("[WorkspaceManager] Workspace initialization complete.");
}

export async function backupActiveWorkspace(): Promise<void> {
  const activeDir = getActivePath();
  const backupDir = getBackupPath();

  console.log("[WorkspaceManager] Mirroring active changes to backup...");

  // Delete all contents in backup (except symlinked node_modules)
  if (existsSync(backupDir)) {
    const entries = readdirSync(backupDir);
    for (const entry of entries) {
      if (entry === "node_modules") continue;
      rmSync(join(backupDir, entry), { recursive: true, force: true });
    }
  }

  // Copy files from active to backup (excluding .git and node_modules)
  copyTemplateFiles(activeDir, backupDir);
}

export async function restoreFromBackup(): Promise<void> {
  const activeDir = getActivePath();
  console.log("[WorkspaceManager] Triggering hard reset inside active workspace...");

  // Run Git hard reset inside active directory to revert all uncommitted changes
  // This is extremely safe and retains the local .git folder.
  const cmd = "git reset --hard HEAD && git clean -fd";
  try {
    await execAsync(cmd, { cwd: activeDir });
  } catch (err: any) {
    console.error("[WorkspaceManager] git restore failed!");
    if (err.stdout) console.error("[WorkspaceManager] stdout:\n", err.stdout);
    if (err.stderr) console.error("[WorkspaceManager] stderr:\n", err.stderr);
    throw err;
  }
}
