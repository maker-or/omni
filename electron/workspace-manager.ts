import { cpSync, rmSync, symlinkSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, lstatSync } from "node:fs";
import { join, dirname } from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { app } from "electron";
import { getMisePath } from "./dependency-installer";

const execAsync = promisify(exec);

export function getPipperLibraryPath(): string {
  try {
    const appData = app.getPath("appData");
    return join(appData, "pipper");
  } catch (err) {
    const home = os.homedir();
    if (process.platform === "win32") {
      return join(process.env.APPDATA || join(home, "AppData/Roaming"), "pipper");
    } else if (process.platform === "darwin") {
      return join(home, "Library/pipper");
    } else {
      return join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "pipper");
    }
  }
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
  console.log("[WorkspaceManager] Linking shared node_modules to active workspace...");
  ensureNodeModulesSymlink(activeNodeModules, sharedNodeModules);

  const backupNodeModules = join(backupDir, "node_modules");
  console.log("[WorkspaceManager] Linking shared node_modules to backup workspace...");
  ensureNodeModulesSymlink(backupNodeModules, sharedNodeModules);

  console.log("[WorkspaceManager] Workspace initialization complete.");
}

function ensureNodeModulesSymlink(symlinkPath: string, targetPath: string): void {
  let needsSymlink = true;
  try {
    const stat = lstatSync(symlinkPath);
    if (stat.isSymbolicLink()) {
      needsSymlink = false;
    } else {
      console.log(`[WorkspaceManager] Removing existing non-symlink node_modules at ${symlinkPath}...`);
      rmSync(symlinkPath, { recursive: true, force: true });
    }
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      console.error(`[WorkspaceManager] Failed to lstat ${symlinkPath}:`, err);
    }
  }

  if (needsSymlink) {
    symlinkSync(targetPath, symlinkPath, "dir");
  }
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

  // 1. Capture untracked files to avoid data loss
  const untrackedFiles: string[] = [];
  try {
    const { stdout } = await execAsync("git ls-files --others --exclude-standard", { cwd: activeDir });
    const trimmed = stdout.trim();
    if (trimmed) {
      untrackedFiles.push(...trimmed.split("\n"));
    }
  } catch (err) {
    console.warn("[WorkspaceManager] Failed to list untracked files:", err);
  }

  // 2. Programmatically back up untracked files if any exist
  if (untrackedFiles.length > 0) {
    const backupDir = join(getPipperLibraryPath(), "untracked_backup", Date.now().toString());
    console.log(`[WorkspaceManager] Backing up ${untrackedFiles.length} untracked files to: ${backupDir}`);
    try {
      mkdirSync(backupDir, { recursive: true });
      for (const file of untrackedFiles) {
        const src = join(activeDir, file);
        const dest = join(backupDir, file);
        if (existsSync(src)) {
          mkdirSync(dirname(dest), { recursive: true });
          cpSync(src, dest, { recursive: true });
        }
      }
    } catch (err) {
      console.error("[WorkspaceManager] Failed to create backup of untracked files:", err);
    }
  }

  // 3. Run Git reset and clean
  // This is safe because we have backed up any untracked files first.
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
