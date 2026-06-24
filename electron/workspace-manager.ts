import {
  appendFileSync,
  rmSync,
  symlinkSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  readlinkSync,
  renameSync,
  watch,
} from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { app } from "electron";
import type { FSWatcher } from "node:fs";
import { getMiseExecCommand } from "./dependency-installer";

const execAsync = promisify(exec);

export function getPipperLibraryPath(): string {
  try {
    if (process.platform === "darwin") {
      return join(os.homedir(), "Library/pipper");
    }
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

export function getCandidatePath(): string {
  return join(getPipperLibraryPath(), "candidate");
}

export function getPreviousPath(): string {
  return join(getPipperLibraryPath(), "previous");
}

export function getUpdatesPath(): string {
  return join(getPipperLibraryPath(), "updates");
}

export function getUpdateStatePath(): string {
  return join(getUpdatesPath(), "state.json");
}

export function getInstallationMetadataPath(): string {
  return join(getPipperLibraryPath(), "installation.json");
}

export function getActiveDependenciesPath(): string {
  return join(getSharedPath(), "active-deps");
}

export function getCandidateDependenciesPath(): string {
  return join(getSharedPath(), "candidate-deps");
}

type CopyPolicy = "packaged-template" | "managed-workspace" | "recovery-snapshot";

const COMMON_EXCLUSIONS = new Set([
  "node_modules",
  "out",
  "dist",
  "release",
  ".cache",
  ".vite",
  "logs",
]);
const TEMPLATE_EXCLUSIONS = new Set([
  ...COMMON_EXCLUSIONS,
  "electron",
  ".git",
  "app-template",
  "marketing",
  ".env",
  "updates",
  "installation.json",
]);

function shouldExclude(name: string, policy: CopyPolicy): boolean {
  if (COMMON_EXCLUSIONS.has(name) || name.endsWith(".log")) return true;
  return policy === "packaged-template" && TEMPLATE_EXCLUSIONS.has(name);
}

function copyRecursive(src: string, dest: string, policy: CopyPolicy = "recovery-snapshot"): void {
  const stat = lstatSync(src);
  if (stat.isSymbolicLink()) {
    mkdirSync(dirname(dest), { recursive: true });
    symlinkSync(readlinkSync(src), dest);
    return;
  }
  if (stat.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    const entries = readdirSync(src);
    for (const entry of entries) {
      if (!shouldExclude(entry, policy)) copyRecursive(join(src, entry), join(dest, entry), policy);
    }
  } else {
    mkdirSync(dirname(dest), { recursive: true });
    const data = readFileSync(src);
    writeFileSync(dest, data);
  }
}

function copyWithPolicy(srcDir: string, destDir: string, policy: CopyPolicy): void {
  mkdirSync(destDir, { recursive: true });
  const entries = readdirSync(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const name = entry.name;
    if (shouldExclude(name, policy)) continue;
    const srcPath = join(srcDir, name);
    const destPath = join(destDir, name);
    copyRecursive(srcPath, destPath, policy);
  }
}

export function copyPackagedTemplate(srcDir: string, destDir: string): void {
  copyWithPolicy(srcDir, destDir, "packaged-template");
}

export function copyManagedWorkspace(srcDir: string, destDir: string): void {
  copyWithPolicy(srcDir, destDir, "managed-workspace");
}

export function copyRecoverySnapshot(srcDir: string, destDir: string): void {
  copyWithPolicy(srcDir, destDir, "recovery-snapshot");
}

function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export interface CandidateSnapshot {
  active_head: string;
  candidate_head: string;
  file_count: number;
  critical_checksums: Record<string, string>;
}

async function gitHead(path: string): Promise<string> {
  const { stdout } = await execAsync("git rev-parse HEAD", { cwd: path });
  return stdout.trim();
}

async function isGitWorkspaceClean(path: string): Promise<boolean> {
  const { stdout } = await execAsync("git status --porcelain", { cwd: path });
  return stdout.trim() === "";
}

function ensureWorkspaceGitExcludes(workspacePath: string): void {
  const gitInfoPath = join(workspacePath, ".git", "info");
  if (!existsSync(gitInfoPath)) return;
  const excludePath = join(gitInfoPath, "exclude");
  const required = ["node_modules", "dist", "out", ".cache", ".vite", "logs"];
  const current = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
  const missing = required.filter((entry) => !current.split(/\r?\n/).includes(entry));
  if (missing.length > 0) appendFileSync(excludePath, `${missing.join("\n")}\n`);
}

async function repairInstallationHeadIfActiveClean(installationPath: string, activeDir: string) {
  if (!existsSync(installationPath) || !existsSync(join(activeDir, ".git"))) return;
  try {
    if (!(await isGitWorkspaceClean(activeDir))) return;
    const installation = JSON.parse(readFileSync(installationPath, "utf8"));
    const head = await gitHead(activeDir);
    if (installation.customized_head_commit === head) return;
    installation.customized_head_commit = head;
    installation.last_healthy_at = new Date().toISOString();
    writeFileSync(installationPath, `${JSON.stringify(installation, null, 2)}\n`);
    console.log("[WorkspaceManager] Repaired installation metadata to match clean active HEAD.");
  } catch (error) {
    console.warn("[WorkspaceManager] Failed to repair installation metadata:", error);
  }
}

function countFiles(path: string): number {
  let count = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    count += entry.isDirectory() ? countFiles(join(path, entry.name)) : 1;
  }
  return count;
}

export async function createCandidateFromActive(): Promise<CandidateSnapshot> {
  const active = getActivePath();
  const candidate = getCandidatePath();
  if (!existsSync(join(active, ".git"))) throw new Error("Active workspace has no Git history.");
  rmSync(candidate, { recursive: true, force: true });
  copyManagedWorkspace(active, candidate);
  const activeHead = await gitHead(active);
  const candidateHead = await gitHead(candidate);
  if (candidateHead !== activeHead) throw new Error("Candidate Git HEAD does not match active.");
  const criticalChecksums: Record<string, string> = {};
  for (const relative of ["package.json", "bun.lock", "patch.md"]) {
    const path = join(candidate, relative);
    if (existsSync(path)) criticalChecksums[relative] = fileSha256(path);
  }
  return {
    active_head: activeHead,
    candidate_head: candidateHead,
    file_count: countFiles(candidate),
    critical_checksums: criticalChecksums,
  };
}

export function removeCandidate(): void {
  rmSync(getCandidatePath(), { recursive: true, force: true });
  rmSync(getCandidateDependenciesPath(), { recursive: true, force: true });
}

export async function prepareCandidateDependencies(packageChanged: boolean): Promise<void> {
  const candidate = getCandidatePath();
  const dependencies = getCandidateDependenciesPath();
  rmSync(dependencies, { recursive: true, force: true });
  mkdirSync(dependencies, { recursive: true });
  for (const name of ["package.json", "bun.lock"]) {
    const source = join(candidate, name);
    if (existsSync(source)) copyRecursive(source, join(dependencies, name));
  }
  const install = packageChanged ? "bun install" : "bun install --frozen-lockfile";
  await execAsync(getMiseExecCommand(install), {
    cwd: dependencies,
    maxBuffer: 10 * 1024 * 1024,
  });
  const generatedLock = join(dependencies, "bun.lock");
  if (existsSync(generatedLock)) copyRecursive(generatedLock, join(candidate, "bun.lock"));
  ensureNodeModulesSymlink(join(candidate, "node_modules"), join(dependencies, "node_modules"));
}

export function promoteCandidate(): void {
  const active = getActivePath();
  const candidate = getCandidatePath();
  const previous = getPreviousPath();
  if (existsSync(previous)) throw new Error("Previous workspace already exists.");
  if (!existsSync(candidate)) throw new Error("Candidate workspace does not exist.");
  renameSync(active, previous);
  try {
    renameSync(candidate, active);
  } catch (error) {
    renameSync(previous, active);
    throw error;
  }
}

export function finalizePromotion(): void {
  const backup = getBackupPath();
  const previous = getPreviousPath();
  if (!existsSync(previous)) throw new Error("Previous workspace is unavailable.");
  rmSync(backup, { recursive: true, force: true });
  renameSync(previous, backup);
}

export function rollbackPromotion(): void {
  const active = getActivePath();
  const previous = getPreviousPath();
  if (!existsSync(previous)) return;
  if (existsSync(active)) {
    renameSync(active, join(getPipperLibraryPath(), `candidate-failed-${Date.now()}`));
  }
  renameSync(previous, active);
}

export function recoverInterruptedPromotion(): "none" | "restored" | "candidate-promoted" {
  const active = getActivePath();
  const previous = getPreviousPath();
  const candidate = getCandidatePath();
  if (existsSync(active) || !existsSync(previous)) return "none";
  if (existsSync(candidate)) {
    renameSync(candidate, active);
    return "candidate-promoted";
  }
  renameSync(previous, active);
  return "restored";
}

let initPromise: Promise<void> | null = null;

export async function initializeWorkspaces(
  appResourcesPath: string,
  isDev: boolean,
): Promise<void> {
  if (initPromise) {
    console.log("[WorkspaceManager] Initialization already in progress, awaiting existing run...");
    return initPromise;
  }

  initPromise = (async () => {
    const libRoot = getPipperLibraryPath();
    const activeDir = getActivePath();
    const backupDir = getBackupPath();
    const sharedDir = getSharedPath();

    mkdirSync(libRoot, { recursive: true });
    mkdirSync(sharedDir, { recursive: true });

    // Resolve template source path
    const templatePath = isDev ? process.cwd() : join(appResourcesPath, "app-template");

    console.log(`[WorkspaceManager] Initializing workspaces from: ${templatePath}`);

    // 1. Copy source files to active if not present or incomplete
    if (
      !existsSync(activeDir) ||
      readdirSync(activeDir).length === 0 ||
      !existsSync(join(activeDir, "package.json"))
    ) {
      console.log("[WorkspaceManager] Copying files to active workspace...");
      copyPackagedTemplate(templatePath, activeDir);
    }

    // Initialize Git in active workspace if not present
    const activeGitDir = join(activeDir, ".git");
    if (!existsSync(activeGitDir)) {
      console.log("[WorkspaceManager] Initializing git repository in active workspace...");
      try {
        await execAsync("git init", { cwd: activeDir });
        ensureWorkspaceGitExcludes(activeDir);
        await execAsync("git add .", { cwd: activeDir });
        await execAsync("git commit -m 'Initial commit'", {
          cwd: activeDir,
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "Pipper",
            GIT_AUTHOR_EMAIL: "pipper@internal",
            GIT_COMMITTER_NAME: "Pipper",
            GIT_COMMITTER_EMAIL: "pipper@internal",
          },
        });
      } catch (err) {
        console.warn("[WorkspaceManager] Failed to initialize git in active workspace:", err);
      }
    } else {
      ensureWorkspaceGitExcludes(activeDir);
    }

    // 2. Copy source files to backup if not present or incomplete
    if (
      !existsSync(backupDir) ||
      readdirSync(backupDir).length === 0 ||
      !existsSync(join(backupDir, "package.json"))
    ) {
      console.log("[WorkspaceManager] Copying files to backup workspace...");
      copyRecoverySnapshot(activeDir, backupDir);
    }

    // Launcher-controlled metadata is created once and never inferred from an edited package.json again.
    const installationPath = getInstallationMetadataPath();
    if (!existsSync(installationPath)) {
      const head = await gitHead(activeDir);
      let installedVersion = "0.0.0";
      try {
        const packagedMetadataPath = join(templatePath, "installation.json");
        if (existsSync(packagedMetadataPath)) {
          const packagedMetadata = JSON.parse(readFileSync(packagedMetadataPath, "utf8"));
          if (typeof packagedMetadata.installed_version === "string") {
            installedVersion = packagedMetadata.installed_version;
          }
        } else {
          const packaged = JSON.parse(readFileSync(join(templatePath, "package.json"), "utf8"));
          if (typeof packaged.version === "string") installedVersion = packaged.version;
        }
      } catch (error) {
        console.warn("[WorkspaceManager] Could not read initial packaged version:", error);
      }
      writeFileSync(
        installationPath,
        `${JSON.stringify(
          {
            installed_version: installedVersion,
            customized_head_commit: head,
            last_healthy_at: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
    }

    // 3. Initialize package.json inside shared directory for dependency installation
    const activePkgJson = join(activeDir, "package.json");
    const templatePkgJson = join(templatePath, "package.json");
    const activeDependenciesDir = getActiveDependenciesPath();
    mkdirSync(activeDependenciesDir, { recursive: true });
    const sharedPkgJson = join(activeDependenciesDir, "package.json");
    let dependencyManifestChanged = false;
    const packageSource = existsSync(activePkgJson) ? activePkgJson : templatePkgJson;
    if (existsSync(packageSource)) {
      try {
        const pkg = JSON.parse(readFileSync(packageSource, "utf8"));
        if (pkg.scripts) {
          delete pkg.scripts.postinstall;
        }
        const nextManifest = `${JSON.stringify(pkg, null, 2)}\n`;
        const currentManifest = existsSync(sharedPkgJson)
          ? readFileSync(sharedPkgJson, "utf8")
          : "";
        dependencyManifestChanged = currentManifest !== nextManifest;
        if (dependencyManifestChanged) {
          writeFileSync(sharedPkgJson, nextManifest, "utf8");
          console.log("[WorkspaceManager] Updated shared dependency manifest.");
        }
        const activeLock = join(activeDir, "bun.lock");
        if (existsSync(activeLock))
          copyRecursive(activeLock, join(activeDependenciesDir, "bun.lock"));
      } catch (err) {
        console.error("[WorkspaceManager] Failed to update shared package.json:", err);
        copyRecursive(packageSource, sharedPkgJson);
        dependencyManifestChanged = true;
      }
    }

    // 4. Run dependency setup inside shared directory
    const sharedNodeModules = join(activeDependenciesDir, "node_modules");
    if (!existsSync(sharedNodeModules) || dependencyManifestChanged) {
      console.log("[WorkspaceManager] Installing workspace dependencies inside shared folder...");
      // Run bun install using the launcher-pinned Mise runtime.
      try {
        await execAsync(getMiseExecCommand("bun install"), {
          cwd: activeDependenciesDir,
          maxBuffer: 10 * 1024 * 1024,
        });
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

    await repairInstallationHeadIfActiveClean(installationPath, activeDir);

    console.log("[WorkspaceManager] Workspace initialization complete.");
  })();

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

function ensureNodeModulesSymlink(symlinkPath: string, targetPath: string): void {
  let needsSymlink = true;
  try {
    const stat = lstatSync(symlinkPath);
    if (stat.isSymbolicLink()) {
      const currentTarget = readlinkSync(symlinkPath);
      if (currentTarget === targetPath) {
        needsSymlink = false;
      } else {
        rmSync(symlinkPath, { force: true });
      }
    } else {
      console.log(
        `[WorkspaceManager] Removing existing non-symlink node_modules at ${symlinkPath}...`,
      );
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

  // Recovery snapshots preserve Git history and Markdown customization context.
  copyRecoverySnapshot(activeDir, backupDir);
}

export async function restoreFromBackup(): Promise<void> {
  const activeDir = getActivePath();
  console.log("[WorkspaceManager] Triggering hard reset inside active workspace...");

  // 1. Capture untracked files to avoid data loss
  const untrackedFiles: string[] = [];
  try {
    const { stdout } = await execAsync("git ls-files --others --exclude-standard", {
      cwd: activeDir,
    });
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
    console.log(
      `[WorkspaceManager] Backing up ${untrackedFiles.length} untracked files to: ${backupDir}`,
    );
    try {
      mkdirSync(backupDir, { recursive: true });
      for (const file of untrackedFiles) {
        const src = join(activeDir, file);
        const dest = join(backupDir, file);
        if (existsSync(src)) {
          mkdirSync(dirname(dest), { recursive: true });
          copyRecursive(src, dest);
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

let devFileWatcher: FSWatcher | null = null;

export function startDevFileWatcher(): void {
  if (devFileWatcher) return;
  const srcDir = process.cwd();
  const activeDir = getActivePath();

  console.log(`[WorkspaceManager] Starting development file watcher on: ${srcDir}`);

  try {
    devFileWatcher = watch(srcDir, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;

      const normalized = filename.replace(/\\/g, "/");
      const firstSegment = normalized.split("/")[0];
      if (
        firstSegment === "node_modules" ||
        firstSegment === "electron" ||
        firstSegment === "out" ||
        firstSegment === ".git" ||
        firstSegment === "release" ||
        firstSegment === "app-template" ||
        firstSegment.startsWith(".")
      ) {
        return;
      }

      const srcPath = join(srcDir, normalized);
      const destPath = join(activeDir, normalized);

      try {
        if (existsSync(srcPath)) {
          const stat = lstatSync(srcPath);
          if (stat.isFile()) {
            mkdirSync(dirname(destPath), { recursive: true });
            const data = readFileSync(srcPath);
            writeFileSync(destPath, data);
            console.log(`[Watcher] Synced file: ${normalized}`);
          }
        } else {
          if (existsSync(destPath)) {
            rmSync(destPath, { recursive: true, force: true });
            console.log(`[Watcher] Removed file: ${normalized}`);
          }
        }
      } catch (err) {
        console.error(`[Watcher] Failed to sync ${normalized}:`, err);
      }
    });
  } catch (err) {
    console.error("[Watcher] Failed to start file watcher:", err);
  }
}

export function stopDevFileWatcher(): void {
  devFileWatcher?.close();
  devFileWatcher = null;
}
