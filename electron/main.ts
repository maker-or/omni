import { app, BrowserWindow, Menu, shell, ipcMain, dialog } from "electron";
import { join, dirname } from "node:path";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import * as pty from "node-pty";
import { markLaunchComplete, readLaunchState } from "./launch-state";
import { readCompanionState, writeCompanionState } from "./companion-state";
import { createProject, getProject, listProjects } from "./projects";
import { getActiveProjectId, setActiveProjectId } from "./session";
import { AUTH_CALLBACK_SUCCESS_HTML } from "./auth-callback-success";
import {
  isAllowedClerkAuthUrl,
  resolveClerkSignInUrl,
  resolveClerkSignUpUrl,
} from "./clerk-auth-config";
import {
  getDb,
  getMostRecentAuthUser,
  upsertAuthUser,
  getSelectedAgentIds,
  setSelectedAgentIds,
} from "./db";
import { listThreads, listThreadsByIds, listProjectThreads } from "./threads";
import { listMcpServers, createMcpServer, updateMcpServer, deleteMcpServer } from "./mcp-servers";
import { AgentManager } from "./agent";
import {
  broadcastOpenTabsChanged,
  closeThreadTab,
  openThreadTab,
  readOpenTabsState,
  recordThreadSwitch,
  setActiveThreadTab,
} from "./open-tabs";
import {
  checkAllDependencies,
  checkGit,
  installGit,
  installMise,
  installNodeAndBunWithMise,
  getMisePath,
  getMiseExecArgs,
  prependStandardPaths,
  type DependencyStatus,
} from "./dependency-installer";
import { captureAnalytics, identifyAnalyticsUser, shutdownAnalytics } from "./analytics";
import type { AnalyticsProperties } from "./analytics-schema";
import { sanitizeErrorType, sanitizeIdentifier } from "./analytics-sanitize";

// Initialize PATH prepend early for child process resolutions
prependStandardPaths();

import {
  initializeWorkspaces,
  backupActiveWorkspace,
  restoreFromBackup,
  getActivePath,
  getBackupPath,
  startDevFileWatcher,
  stopDevFileWatcher,
  getActiveDependenciesPath,
  getInstallationMetadataPath,
  getPipperLibraryPath,
  getPipperLibraryDisplayPath,
  usesLocalDevelopmentWorkspace,
} from "./workspace-manager";
import { UpdateManager } from "./update-manager";
import { LauncherUpdateManager } from "./launcher-update-manager";
import { launchLauncherInstaller } from "./launcher-update-install.ts";
import { resolveLauncherUpdateManifestUrl } from "./launcher-update-config.ts";
import {
  PIPPER_LAUNCHER_MAC_MANIFEST_URL,
  PIPPER_LAUNCHER_WINDOWS_MANIFEST_URL,
} from "../contracts/launcher-release-urls.ts";

const mainDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_AGENT_UPDATE_MANIFEST_URL = "https://pipper.dev/api/agent-update.json";
const DEFAULT_UPSTREAM_REPOSITORY_URL = "https://github.com/maker-or/omni";

const ptyProcesses = new Map<string, pty.IPty>();
const execFileAsync = promisify(execFile);

function resolveWindowsShell(): string {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const candidates = [
    join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    join(systemRoot, "Sysnative", "WindowsPowerShell", "v1.0", "powershell.exe"),
    "powershell.exe",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "powershell.exe";
}

const FILE_MENTION_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
]);

async function listProjectFiles(projectPath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      {
        cwd: projectPath,
        maxBuffer: 1024 * 1024 * 4,
      },
    );
    return Array.from(new Set(String(stdout).split(/\r?\n/).filter(Boolean))).sort();
  } catch {
    const results: string[] = [];
    const walk = (dir: string, prefix = "") => {
      if (results.length >= 5000) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") && entry.name !== ".env") continue;
        if (FILE_MENTION_IGNORED_DIRS.has(entry.name)) continue;
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) walk(absolute, relative);
        else if (entry.isFile()) results.push(relative);
      }
    };
    walk(projectPath);
    return results.sort();
  }
}
let currentTheme: "light" | "dark" | "system" = "system";

const isDev = !app.isPackaged;

if (isDev && !process.env.PIPPER_LIBRARY_PATH) {
  const devUserDataPath =
    process.env.PIPPER_DEV_USER_DATA_PATH ?? join(app.getPath("appData"), "pipper-dev");
  app.setPath("userData", devUserDataPath);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

function generateRandomId(): string {
  const hex = randomBytes(4).toString("hex");
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

function normalizeTheme(theme: string): "light" | "dark" | "system" {
  return theme === "light" || theme === "dark" || theme === "system" ? theme : "system";
}

function dirtyFilesFromPorcelain(status: string): string[] {
  const paths: string[] = [];
  for (const line of status.split("\n")) {
    if (!line.trim()) continue;
    const body = line.slice(3);
    if (!body) continue;
    const renameParts = body.split(" -> ");
    if (renameParts.length > 1) {
      paths.push(renameParts[0], renameParts[renameParts.length - 1]);
    } else {
      paths.push(body);
    }
  }
  return paths.filter(Boolean);
}

function isPatchMetadataFile(file: string): boolean {
  return file.replace(/\\/g, "/") === "patch.md";
}

function workspaceFileFingerprint(root: string, file: string): string | null {
  const filePath = join(root, file);
  if (!fs.existsSync(filePath)) return null;
  return fingerprintPath(filePath);
}

function fingerprintPath(filePath: string): string {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) return `symlink:${fs.readlinkSync(filePath)}`;
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(filePath).sort();
    const hash = createHash("sha256");
    for (const entry of entries) {
      hash.update(entry);
      hash.update("\0");
      hash.update(fingerprintPath(join(filePath, entry)));
      hash.update("\0");
    }
    return `directory:${hash.digest("hex")}`;
  }
  return `file:${createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

async function capturePipperEditBaseline(activePath: string): Promise<Map<string, string | null>> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: activePath });
  const files = dirtyFilesFromPorcelain(String(stdout)).filter(
    (file) => !isPatchMetadataFile(file),
  );
  return new Map(files.map((file) => [file, workspaceFileFingerprint(activePath, file)]));
}

async function ensurePipperEditBaseline(): Promise<void> {
  if (pipperEditBaseline) return;
  pipperEditBaseline = await capturePipperEditBaseline(getActivePath());
}

function changedSincePipperEditBaseline(activePath: string, file: string): boolean {
  if (!pipperEditBaseline) return false;
  if (!pipperEditBaseline.has(file)) return true;
  return pipperEditBaseline.get(file) !== workspaceFileFingerprint(activePath, file);
}

async function listPipperEditChangedFiles(activePath: string): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
    cwd: activePath,
  });
  return dirtyFilesFromPorcelain(String(stdout)).filter(
    (file) => !isPatchMetadataFile(file) && changedSincePipperEditBaseline(activePath, file),
  );
}

let mainWindow: BrowserWindow | null = null;
let launchWindow: BrowserWindow | null = null;
let companionWindow: BrowserWindow | null = null;
let agentManager: AgentManager | null = null;
let updateManager: UpdateManager | null = null;
let launcherUpdateManager: LauncherUpdateManager | null = null;
let pipperEditBaseline: Map<string, string | null> | null = null;
let allowCompanionClose = false;
let updateSubsystemReady = false;
let quitAuthorized = false;
let updateQuitInProgress = false;
let authCallbackServer: http.Server | null = null;
let authCallbackPort: number | null = null;
let pendingAuthCallback: Promise<void> | null = null;

function requireAgentManager(): AgentManager {
  if (!agentManager) {
    throw new Error("Agent manager is not initialized.");
  }
  return agentManager;
}

function requireUpdateManager(): UpdateManager {
  if (!updateManager) throw new Error("Update manager is not initialized.");
  return updateManager;
}

function requireLauncherUpdateManager(): LauncherUpdateManager {
  if (!launcherUpdateManager) throw new Error("Launcher update manager is not initialized.");
  return launcherUpdateManager;
}

function resolveRendererUrl(page: "main" | "launch", stage?: string): string {
  const base = process.env["ELECTRON_RENDERER_URL"];
  if (!base) return "";
  let url = page === "launch" ? `${base}/launch.html` : base;
  if (stage) {
    url += `?stage=${stage}`;
  }
  return url;
}

function resolveRendererFile(page: "main" | "launch"): string {
  return join(mainDir, "../renderer", page === "launch" ? "launch.html" : "index.html");
}

function getIconPath(): string | undefined {
  const path = isDev
    ? join(app.getAppPath(), "public/devIcon.png")
    : join(mainDir, "../renderer/icon.png");
  return fs.existsSync(path) ? path : undefined;
}

function sendToMainWindow(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function sendToCompanionWindow(channel: string, payload: unknown): void {
  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.webContents.send(channel, payload);
  }
}

function endCompanionSession(): void {
  broadcastToWindows("pipper:stateChanged", { editMode: false, processingId: null });
  pipperEditBaseline = null;
  try {
    void requireAgentManager()
      .disposeEditor()
      .catch((err) => {
        console.error("[Main] Failed to dispose editor session:", err);
      });
  } catch (err) {
    console.error("[Main] Failed to find editor session manager:", err);
  }
}

async function hasPipperEditChanges(): Promise<boolean> {
  if (!pipperEditBaseline) return false;
  return (await listPipperEditChangedFiles(getActivePath())).length > 0;
}

async function rejectPipperEditChanges(): Promise<void> {
  await restoreFromBackup();
  pipperEditBaseline = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reload();
  }
}

async function requestCompanionClose(): Promise<void> {
  const win = companionWindow;
  if (!win || win.isDestroyed()) return;

  if (!allowCompanionClose && (await hasPipperEditChanges().catch(() => true))) {
    const result = await dialog.showMessageBox(win, {
      type: "warning",
      buttons: ["Keep Editing", "Reject Changes", "Close Without Reverting"],
      defaultId: 0,
      cancelId: 0,
      title: "Unaccepted edit changes",
      message: "The edit session has workspace changes that have not been accepted or rejected.",
      detail:
        "Reject changes to restore the last backup, or close without reverting to leave the files dirty.",
    });

    if (result.response === 0) return;
    if (result.response === 1) {
      await rejectPipperEditChanges();
    }
  }

  allowCompanionClose = true;
  endCompanionSession();
  win.close();
}

function setMainWindowTitle(title: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(title);
  }
}

function resolveExternalUrl(kind: "clerkSignUp" | "clerkSignIn"): string {
  return kind === "clerkSignUp" ? resolveClerkSignUpUrl() : resolveClerkSignInUrl();
}

function isAllowedExternalUrl(inputUrl: string): boolean {
  return isAllowedClerkAuthUrl(inputUrl);
}

function assertAllowedExternalUrl(inputUrl: string): string {
  const trimmed = inputUrl.trim();
  if (!trimmed || !isAllowedExternalUrl(trimmed)) {
    throw new Error("External URL is not allowed.");
  }
  return trimmed;
}

function parseAuthCallback(url: string): {
  providerUserId: string | null;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
} {
  try {
    const parsed = new URL(url);
    return {
      providerUserId: parsed.searchParams.get("userId"),
      email: parsed.searchParams.get("email"),
      name: parsed.searchParams.get("name"),
      avatarUrl: parsed.searchParams.get("avatarUrl"),
    };
  } catch {
    return { providerUserId: null, email: null, name: null, avatarUrl: null };
  }
}

async function handleAuthCallback(url: string): Promise<void> {
  const payload = parseAuthCallback(url);
  if (!payload.providerUserId) {
    throw new Error("Auth callback missing provider user id.");
  }
  if (!payload.email) {
    throw new Error("Auth callback missing email.");
  }

  const record = upsertAuthUser({
    provider: "clerk",
    providerUserId: payload.providerUserId,
    email: payload.email,
    name: payload.name,
    avatarUrl: payload.avatarUrl,
  });

  console.log("[Main] Authenticated user stored:", record.provider_user_id);
  identifyAnalyticsUser({
    providerUserId: record.provider_user_id,
    email: record.email,
    name: record.name,
    avatarUrl: record.avatar_url,
  });

  if (launchWindow && !launchWindow.isDestroyed()) {
    launchWindow.webContents.send("launch:authComplete", record);
    launchWindow.show();
    launchWindow.focus();
  }
}

function getAuthenticatedUserForLaunch() {
  const user = getMostRecentAuthUser();
  if (!user?.provider_user_id || !user.email) return null;
  return user;
}

function requireAuthenticatedUserForLaunch() {
  const user = getAuthenticatedUserForLaunch();
  if (!user) throw new Error("Sign in is required before opening a project.");
  return user;
}

async function ensureAuthCallbackServer(): Promise<number> {
  if (authCallbackPort) return authCallbackPort;
  if (pendingAuthCallback) {
    await pendingAuthCallback;
    if (!authCallbackPort) throw new Error("Auth callback server failed to start.");
    return authCallbackPort;
  }

  pendingAuthCallback = new Promise<void>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end("Missing callback URL");
        return;
      }

      const requestUrl = new URL(req.url, `http://127.0.0.1:${authCallbackPort ?? 0}`);
      if (requestUrl.pathname !== "/auth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const fullUrl = requestUrl.toString();
      void handleAuthCallback(fullUrl)
        .then(() => {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(AUTH_CALLBACK_SUCCESS_HTML);
        })
        .catch((error) => {
          console.error("[Main] Auth callback handling failed:", error);
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Auth callback failed");
        });
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to start auth callback server."));
        return;
      }
      authCallbackServer = server;
      authCallbackPort = address.port;
      resolve();
    });
  });

  try {
    await pendingAuthCallback;
  } finally {
    pendingAuthCallback = null;
  }

  if (!authCallbackPort) throw new Error("Auth callback server failed to start.");
  return authCallbackPort;
}

function getAuthCallbackUrl(): string {
  if (!authCallbackPort) {
    throw new Error("Auth callback server is not ready.");
  }
  return `http://127.0.0.1:${authCallbackPort}/auth/callback`;
}

function loadInto(win: BrowserWindow, page: "main" | "launch", stage?: string): Promise<void> {
  console.log(`[Main] loadInto - page: ${page}, stage: ${stage}, isDev: ${isDev}`);
  if (isDev) {
    const url = resolveRendererUrl(page, stage);
    console.log(`[Main] loadInto (dev) - loading url: ${url}`);
    return win.loadURL(url);
  }
  const file = resolveRendererFile(page);
  const urlObj = pathToFileURL(file);
  if (stage) {
    urlObj.searchParams.set("stage", stage);
  }
  const fileUrl = urlObj.toString();
  console.log(`[Main] loadInto (prod) - loading file url: ${fileUrl}`);
  return win.loadURL(fileUrl);
}

let viteProcess: import("node:child_process").ChildProcess | null = null;
let viteServerUrl: string | null = null;
let viteStartPromise: Promise<string> | null = null;

function extractViteUrl(output: string): string | null {
  const match = output.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+/i);
  return match?.[0] ?? null;
}

async function startViteServer(): Promise<string> {
  if (viteServerUrl) {
    return viteServerUrl;
  }
  if (viteStartPromise) return viteStartPromise;

  const activePath = getActivePath();
  const cmd = getMisePath();
  const args = getMiseExecArgs(["bun", "run", "vite", "--host", "127.0.0.1"]);
  console.log(`[Main] Spawning Vite Dev Server in ${activePath} using Mise`);

  const startPromise = new Promise<string>((resolve, reject) => {
    // Let Vite choose its normal port and auto-increment if needed. This keeps
    // the packaged app and the development app from fighting over a fixed port.
    const child = spawn(cmd, args, {
      cwd: activePath,
      env: { ...process.env, NODE_ENV: "development" },
    });
    viteProcess = child;

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        try {
          child.kill("SIGKILL");
        } catch (err) {
          console.error("[Main] Failed to kill timed-out Vite process:", err);
        }
        settleReject(new Error("Timed out waiting for Vite dev server URL."));
      }
    }, 15000);

    const settleResolve = (url: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      viteServerUrl = url;
      console.log(`[Main] Vite server ready at ${url}`);
      resolve(url);
    };

    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (viteProcess === child) {
        viteProcess = null;
        viteServerUrl = null;
      }
      reject(error);
    };

    const maybeResolveFromOutput = (output: string) => {
      const url = extractViteUrl(output);
      if (!url) return;
      settleResolve(url);
    };

    child.stdout?.on("data", (data) => {
      const output = data.toString();
      console.log(`[Vite compiler stdout] ${output}`);
      maybeResolveFromOutput(output);
    });

    child.stderr?.on("data", (data) => {
      const output = data.toString();
      console.error(`[Vite compiler stderr] ${output}`);
      maybeResolveFromOutput(output);
    });

    child.on("error", (error) => {
      console.error("[Vite compiler] failed to start:", error);
      settleReject(error);
    });

    child.on("close", (code) => {
      console.log(`[Vite compiler] exited with code ${code}`);
      if (viteProcess === child) {
        viteProcess = null;
        viteServerUrl = null;
      }
      if (!settled) {
        settleReject(
          new Error(`Vite dev server exited before becoming ready (code ${code ?? "unknown"}).`),
        );
      }
    });
  }).finally(() => {
    viteStartPromise = null;
  });
  viteStartPromise = startPromise;

  return startPromise;
}

async function restartViteServer(): Promise<void> {
  console.log("[Main] Restarting Vite Dev Server to reflect changes...");
  if (viteProcess) {
    try {
      viteProcess.kill("SIGKILL");
    } catch (err) {
      console.error("[Main] Error killing Vite process:", err);
    }
    viteProcess = null;
    viteServerUrl = null;
    viteStartPromise = null;
    // Brief sleep to allow OS to release the port
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const url = await startViteServer();
  console.log(`[Main] Vite Dev Server restarted at: ${url}`);
}

async function createMainWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    title: generateRandomId(),
    show: false,
    icon: getIconPath(),
    backgroundColor: "#171717",
    titleBarStyle: "hidden",
    webPreferences: {
      preload: join(mainDir, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] [Level ${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    } else {
      console.warn(`[Main] Blocked external URL request: ${url}`);
    }
    return { action: "deny" };
  });

  try {
    const url = await startViteServer();
    console.log(`[Main] Loading guest UI URL: ${url}`);
    await mainWindow.loadURL(url);
  } catch (err) {
    console.error("[Main] Failed to start local compiler or load url:", err);
    void loadInto(mainWindow, "main");
  }
}

function createLaunchWindow(stage: "list" | "add" | "onboarding" = "list"): void {
  console.log(`[Main] createLaunchWindow - stage: ${stage}`);
  if (launchWindow && !launchWindow.isDestroyed()) {
    console.log("[Main] launchWindow already exists, reusing and loading stage:", stage);
    void loadInto(launchWindow, "launch", stage);
    launchWindow.show();
    launchWindow.focus();
    return;
  }

  console.log("[Main] Creating new launchWindow");
  launchWindow = new BrowserWindow({
    width: 720,
    height: 620,
    minWidth: 560,
    minHeight: 520,
    resizable: false,
    title: "Welcome to Pipper Code (Alpha)",
    show: false,
    icon: getIconPath(),
    backgroundColor: "#171717",
    webPreferences: {
      preload: join(mainDir, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  launchWindow.on("ready-to-show", () => {
    console.log("[Main] launchWindow ready-to-show");
    launchWindow?.show();
  });

  launchWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[Launch Renderer Console] [Level ${level}] ${message} (${sourceId}:${line})`);
  });

  launchWindow.on("closed", () => {
    console.log("[Main] launchWindow closed");
    launchWindow = null;
  });

  void loadInto(launchWindow, "launch", stage);
}

async function createCompanionWindow(): Promise<void> {
  console.log("[Main] createCompanionWindow");
  if (companionWindow && !companionWindow.isDestroyed()) {
    console.log("[Main] companionWindow already exists, showing it");
    companionWindow.show();
    companionWindow.focus();
    return;
  }

  const savedBounds = await readCompanionState();

  console.log("[Main] Creating new companionWindow");
  companionWindow = new BrowserWindow({
    width: savedBounds?.width ?? 400,
    height: savedBounds?.height ?? 640,
    minWidth: 320,
    minHeight: 480,
    x: savedBounds?.x,
    y: savedBounds?.y,
    parent: mainWindow ?? undefined,
    title: "Companion",
    show: false,
    icon: getIconPath(),
    backgroundColor: "#171717",
    titleBarStyle: "hidden",
    webPreferences: {
      preload: join(mainDir, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  companionWindow.on("ready-to-show", () => {
    console.log("[Main] companionWindow ready-to-show");
    companionWindow?.show();
  });

  companionWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[Companion Renderer Console] [Level ${level}] ${message} (${sourceId}:${line})`);
  });

  const saveBounds = () => {
    if (companionWindow && !companionWindow.isDestroyed()) {
      void writeCompanionState(companionWindow.getBounds());
    }
  };

  companionWindow.on("resize", saveBounds);
  companionWindow.on("move", saveBounds);

  companionWindow.on("close", (event) => {
    if (allowCompanionClose) return;
    event.preventDefault();
    void requestCompanionClose().catch((err) => {
      console.error("[Main] Failed to close companion safely:", err);
    });
  });

  companionWindow.on("closed", () => {
    console.log("[Main] companionWindow closed");
    companionWindow = null;
    allowCompanionClose = false;
  });

  void loadInto(companionWindow, "main", "companion");
}

function broadcastToWindows(channel: string, ...args: any[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.webContents.send(channel, ...args);
  }
  if (launchWindow && !launchWindow.isDestroyed()) {
    launchWindow.webContents.send(channel, ...args);
  }
}

function areDependenciesReady(deps: DependencyStatus): boolean {
  return deps.gitInstalled && deps.miseInstalled && deps.nodeMatch && deps.bunMatch;
}

function areWorkspacesInitialized(): boolean {
  if (usesLocalDevelopmentWorkspace()) {
    return (
      fs.existsSync(join(getActivePath(), "package.json")) &&
      fs.existsSync(join(getActivePath(), "node_modules"))
    );
  }

  return (
    fs.existsSync(getActivePath()) &&
    fs.existsSync(getBackupPath()) &&
    fs.existsSync(join(getActiveDependenciesPath(), "node_modules"))
  );
}

async function ensureDependencyRuntime(): Promise<DependencyStatus> {
  let deps = await checkAllDependencies();
  if (!deps.gitInstalled) {
    console.log("[Main] Installing missing Git...");
    await installGit();
    deps = await checkAllDependencies();
  }

  if (!deps.miseInstalled || !deps.nodeMatch || !deps.bunMatch) {
    console.log("[Main] Installing missing or mismatched launcher runtime dependencies...");
    await installMise();
    await installNodeAndBunWithMise();
    deps = await checkAllDependencies();
  }

  if (!areDependenciesReady(deps)) {
    throw new Error("Dependency setup did not produce the required Mise, Node, and Bun runtime.");
  }

  return deps;
}

async function isWorkspaceReady(): Promise<boolean> {
  const deps = await checkAllDependencies();
  return areDependenciesReady(deps) && areWorkspacesInitialized();
}

async function ensureWorkspaceReady(): Promise<void> {
  await ensureDependencyRuntime();
  await initializeWorkspaces(app.getAppPath(), isDev);
  if (!areWorkspacesInitialized()) {
    throw new Error("Workspace setup finished, but required workspace files are still missing.");
  }
}

async function runWorkspaceSetupForLauncher(): Promise<void> {
  try {
    await ensureWorkspaceReady();
    broadcastToWindows("launch:workspaceReady", {});
    await initializeUpdateSubsystem();
  } catch (error) {
    console.error("[Main] Background workspace initialization failed:", error);
    broadcastToWindows("launch:workspaceError", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function prepareProcessesForUpdate(): Promise<void> {
  await agentManager?.quiesceForUpdate();
  companionWindow?.close();
  for (const [id, process] of ptyProcesses) {
    try {
      process.kill();
    } catch (error) {
      console.warn(`[Update] Failed to stop terminal ${id}:`, error);
    }
  }
  ptyProcesses.clear();
  stopDevFileWatcher();
}

function isUpdateBusy(): boolean {
  return (
    updateManager != null &&
    [
      "preparing",
      "fetching-upstream",
      "agent-running",
      "installing-dependencies",
      "validating",
      "ready-to-promote",
      "promoting",
      "awaiting-health-check",
      "rolling-back",
    ].includes(updateManager.getState().phase)
  );
}

async function restartAfterPromotion(): Promise<void> {
  await restartViteServer();
  if (isDev) startDevFileWatcher();
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL(viteServerUrl ?? (await startViteServer()));
  }
  if (launchWindow && !launchWindow.isDestroyed()) launchWindow.webContents.reload();
}

async function initializeUpdateSubsystem(): Promise<void> {
  if (updateSubsystemReady || !updateManager) return;
  await updateManager.recover();
  updateManager.startPeriodicChecks();
  updateSubsystemReady = true;
  void updateManager.check();
}

function buildAppMenu(): void {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? ([{ role: "appMenu" }] as Electron.MenuItemConstructorOptions[]) : []),
    {
      label: "File",
      submenu: [isMac ? { role: "close" } : { role: "quit" }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { type: "separator" },
        {
          label: "Show Launch Window",
          click: () => createLaunchWindow(),
        },
      ],
    },
    {
      role: "window",
      submenu: [
        { role: "minimize" },
        ...(isMac
          ? ([{ type: "separator" }, { role: "front" }] as Electron.MenuItemConstructorOptions[])
          : ([{ role: "close" }] as Electron.MenuItemConstructorOptions[])),
      ],
    },
    {
      role: "help",
      submenu: [
        {
          label: "Check for Updates…",
          click: () => {
            void Promise.allSettled([launcherUpdateManager?.check(), updateManager?.check()]);
          },
        },
        {
          label: "Application Update Details…",
          click: () => {
            const noWindow =
              (!mainWindow || mainWindow.isDestroyed()) &&
              (!launchWindow || launchWindow.isDestroyed());
            if (noWindow) {
              createLaunchWindow();
              launchWindow?.webContents.once("did-finish-load", () =>
                launchWindow?.webContents.send("launcher-update:openDetails", {}),
              );
            }
            launcherUpdateManager?.showForSession();
            if (!noWindow) broadcastToWindows("launcher-update:openDetails", {});
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  ipcMain.handle("launcher-update:check", () => requireLauncherUpdateManager().check());
  ipcMain.handle("launcher-update:getState", () => requireLauncherUpdateManager().getState());
  ipcMain.handle("launcher-update:isDismissedForSession", () =>
    requireLauncherUpdateManager().isDismissedForSession(),
  );
  ipcMain.handle("launcher-update:download", () => requireLauncherUpdateManager().download());
  ipcMain.handle("launcher-update:cancelDownload", () =>
    requireLauncherUpdateManager().cancelDownload(),
  );
  ipcMain.handle("launcher-update:dismissForSession", () => {
    const state = requireLauncherUpdateManager().dismissForSession();
    broadcastToWindows("launcher-update:dismissedForSession", {});
    return state;
  });
  ipcMain.handle("launcher-update:retryDownload", () =>
    requireLauncherUpdateManager().retryDownload(),
  );
  ipcMain.handle("launcher-update:openDownloadFolder", () =>
    requireLauncherUpdateManager().openDownloadFolder(),
  );
  ipcMain.handle("launcher-update:downloadInBrowser", () =>
    requireLauncherUpdateManager().downloadInBrowser(),
  );
  ipcMain.handle("launcher-update:clearDownloadedUpdate", () =>
    requireLauncherUpdateManager().clearDownloadedUpdate(),
  );
  ipcMain.handle("launcher-update:getDiagnostics", () =>
    requireLauncherUpdateManager().getDiagnostics(),
  );
  ipcMain.handle("launcher-update:copyDiagnostics", () =>
    requireLauncherUpdateManager().copyDiagnostics(),
  );
  ipcMain.handle("launcher-update:installAndQuit", async () => {
    const manager = requireLauncherUpdateManager();
    if (isUpdateBusy())
      return { success: false, error: "Wait for the personalized update to finish." };
    try {
      const path = await manager.verifyDownloadedInstaller();
      await launchLauncherInstaller(path);
      quitAuthorized = true;
      app.quit();
      return { success: true };
    } catch (error) {
      const state = manager.recordFailure(error);
      return { success: false, error: state.error ?? "Unable to open the installer." };
    }
  });

  ipcMain.handle("update:check", () => requireUpdateManager().check());
  ipcMain.handle("update:getState", () => requireUpdateManager().getState());
  ipcMain.handle("update:getManifest", () => requireUpdateManager().getManifest());
  ipcMain.handle("update:getInstallation", () => requireUpdateManager().getInstallation());
  ipcMain.handle("update:getRun", (_event, runId: string) => requireUpdateManager().getRun(runId));
  ipcMain.handle("update:getUpdaterSnapshot", () => requireUpdateManager().getUpdaterSnapshot());
  ipcMain.handle("update:scheduleForQuit", () => requireUpdateManager().scheduleForQuit());
  ipcMain.handle("update:startNow", () => requireUpdateManager().startNow());
  ipcMain.handle("update:retryFailedUpdate", () => requireUpdateManager().retryFailedUpdate());
  ipcMain.handle("update:dismiss", () => requireUpdateManager().dismiss());
  ipcMain.handle("update:cancel", () => requireUpdateManager().cancel());
  ipcMain.handle("update:markActiveHealthy", (_event, version: string) =>
    requireUpdateManager().markActiveHealthy(version),
  );
  ipcMain.handle("update:quitWithoutUpdating", async () => {
    await requireUpdateManager().cancel();
    quitAuthorized = true;
    app.quit();
  });

  ipcMain.handle("projects:list", () => listProjects());

  ipcMain.handle("projects:getActive", () => {
    const id = getActiveProjectId();
    return id ? getProject(id) : null;
  });

  ipcMain.handle("projects:listFiles", async () => {
    const id = getActiveProjectId();
    const project = id ? getProject(id) : null;
    if (!project) return [];
    return listProjectFiles(project.path);
  });

  ipcMain.handle(
    "projects:create",
    (_event, input: { name: string; path: string; icon: string }) => {
      requireAuthenticatedUserForLaunch();
      const project = createProject(input);
      captureAnalytics("project_created", {
        windowType: "launch",
        properties: {
          project_id: project.id,
          icon: project.icon ?? undefined,
        },
      });
      return project;
    },
  );

  ipcMain.handle("dialog:pickDirectory", async () => {
    const win = launchWindow ?? mainWindow ?? BrowserWindow.getFocusedWindow();
    const options: import("electron").OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
      title: "Choose project folder",
      buttonLabel: "Select folder",
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("shell:openExternal", async (_event, url: string) => {
    await ensureAuthCallbackServer();
    const resolvedCallbackUrl = getAuthCallbackUrl();
    const appendReturnTo = (inputUrl: string): string =>
      `${inputUrl}${inputUrl.includes("?") ? "&" : "?"}return_to=${encodeURIComponent(resolvedCallbackUrl)}`;
    const resolvedUrl =
      url === "clerk:sign-up"
        ? appendReturnTo(resolveExternalUrl("clerkSignUp"))
        : url === "clerk:sign-in"
          ? appendReturnTo(resolveExternalUrl("clerkSignIn"))
          : url;

    await shell.openExternal(assertAllowedExternalUrl(resolvedUrl));
  });

  ipcMain.handle("launch:complete", async (_event, projectId: string) => {
    requireAuthenticatedUserForLaunch();

    const project = getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    if (isUpdateBusy()) throw new Error("Project launch is disabled during an update.");

    await ensureWorkspaceReady();

    setActiveProjectId(projectId);
    await markLaunchComplete(projectId);
    await requireAgentManager().activateProject(projectId);

    if (launchWindow && !launchWindow.isDestroyed()) {
      launchWindow.close();
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createMainWindow();
    }
  });

  ipcMain.handle("launch:show", (_event, stage?: "list" | "add" | "onboarding") => {
    console.log("[Main] IPC launch:show - received stage:", stage);
    createLaunchWindow(stage);
  });

  ipcMain.handle("launch:isWorkspaceReady", async () => {
    return isWorkspaceReady();
  });

  ipcMain.handle("launch:getUser", () => {
    return getAuthenticatedUserForLaunch();
  });

  ipcMain.handle("projects:setActive", async (_event, projectId: string) => {
    requireAuthenticatedUserForLaunch();
    if (isUpdateBusy()) throw new Error("Project switching is disabled during an update.");
    const project = getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    await ensureWorkspaceReady();
    const previousProjectId = getActiveProjectId();
    setActiveProjectId(projectId);
    try {
      await requireAgentManager().activateProject(projectId);
    } catch (err) {
      if (previousProjectId) setActiveProjectId(previousProjectId);
      console.error(`[Main] Failed to activate project ${projectId} in agent manager:`, err);
      throw err;
    }
    broadcastToWindows("projects:activeChanged", projectId);
  });

  ipcMain.handle("companion:open", () => {
    createCompanionWindow();
    const projectId = getActiveProjectId();
    if (projectId) {
      return requireAgentManager().activateProject(projectId);
    }
    return;
  });

  ipcMain.on("companion:minimize", () => {
    companionWindow?.minimize();
  });

  ipcMain.on("companion:close", () => {
    void requestCompanionClose().catch((err) => {
      console.error("[Main] Failed to close companion safely:", err);
    });
  });

  ipcMain.handle("threads:list", () => {
    return listThreads();
  });

  ipcMain.handle("threads:listByIds", (_event, ids: string[]) => {
    return listThreadsByIds(ids);
  });

  ipcMain.handle(
    "threads:listProject",
    (_event, input: { projectId: string; limit?: number; offset?: number }) => {
      return listProjectThreads(input.projectId, input.limit, input.offset);
    },
  );

  ipcMain.handle(
    "threads:create",
    (
      _event,
      projectId: string,
      title: string | null,
      afterThreadId?: string | null,
      agentId?: string | null,
    ) => {
      return requireAgentManager().createThread(
        projectId,
        title,
        afterThreadId ?? null,
        agentId ?? null,
      );
    },
  );

  ipcMain.handle("threads:rename", (_event, id: string, title: string) => {
    return requireAgentManager().renameThread(id, title);
  });

  ipcMain.handle("threads:delete", async (_event, id: string) => {
    await requireAgentManager().deleteThread(id);
    const next = await closeThreadTab(id);
    broadcastOpenTabsChanged(mainWindow, next);
  });

  ipcMain.handle("tabs:listOpen", () => readOpenTabsState());

  ipcMain.handle("tabs:open", async (_event, threadId: string) => {
    const next = await openThreadTab(threadId);
    broadcastOpenTabsChanged(mainWindow, next);
    return next;
  });

  ipcMain.handle("tabs:close", async (_event, threadId: string) => {
    try {
      await requireAgentManager().closeThreadSession(threadId);
    } catch (err) {
      console.warn("[IPC] closeThreadSession failed:", err);
    }
    const next = await closeThreadTab(threadId);
    broadcastOpenTabsChanged(mainWindow, next);
    return next;
  });

  ipcMain.handle("tabs:setActive", async (_event, threadId: string | null) => {
    const next = await setActiveThreadTab(threadId);
    broadcastOpenTabsChanged(mainWindow, next);
    return next;
  });

  ipcMain.handle("tabs:getActive", async () => {
    return (await readOpenTabsState()).activeThreadId;
  });

  ipcMain.handle("agent:getState", () => {
    try {
      const state = requireAgentManager().getState();
      console.log(
        `[IPC] agent:getState returned state for project: ${state.projectId}, thread: ${state.threadId}`,
      );
      return state;
    } catch (e: any) {
      console.error("[IPC] agent:getState error:", e);
      throw e;
    }
  });
  ipcMain.handle("agent:getCommands", () => requireAgentManager().getCommands());
  ipcMain.handle("agent:getConfigOptions", () => requireAgentManager().getConfigOptions());
  ipcMain.handle("agent:getCapabilities", () => requireAgentManager().getCapabilities());
  ipcMain.handle("agent:getStats", () => requireAgentManager().getStats());
  ipcMain.handle("agent:sendPrompt", (_event, input) => {
    try {
      return requireAgentManager().sendPrompt(input);
    } catch (e: any) {
      console.error("[IPC] agent:sendPrompt error:", e);
      throw e;
    }
  });
  ipcMain.handle("agent:replacePrompt", (_event, input) =>
    requireAgentManager().replacePrompt(input),
  );
  ipcMain.handle("agent:abort", () => requireAgentManager().abort());
  ipcMain.handle("agent:switchThread", async (_event, threadId: string) => {
    try {
      await requireAgentManager().switchThread(threadId);
      const next = await recordThreadSwitch(threadId);
      broadcastOpenTabsChanged(mainWindow, next);
    } catch (e: any) {
      console.error("[IPC] agent:switchThread error:", e);
      throw e;
    }
  });
  ipcMain.handle(
    "agent:createThread",
    (
      _event,
      projectId: string,
      title: string | null,
      afterThreadId?: string | null,
      agentId?: string | null,
    ) => {
      try {
        return requireAgentManager().createThread(
          projectId,
          title,
          afterThreadId ?? null,
          agentId ?? null,
        );
      } catch (e: any) {
        console.error("[IPC] agent:createThread error:", e);
        throw e;
      }
    },
  );
  ipcMain.handle("agent:setConfigOption", (_event, configId: string, value: string | boolean) =>
    requireAgentManager().setConfigOption(configId, value),
  );
  ipcMain.handle("agent:respondToPermission", (_event, response) =>
    requireAgentManager().respondToPermission(response),
  );
  ipcMain.handle("agent:listAgents", () => requireAgentManager().listAgents());
  ipcMain.handle("agent:switchAgent", (_event, agentId: string) =>
    requireAgentManager().switchAgent(agentId),
  );
  ipcMain.handle("agent:getPreferredAgentId", () => requireAgentManager().getPreferredAgentId());
  ipcMain.handle("agent:setPreferredAgentId", (_event, agentId: string) => {
    requireAgentManager().setPreferredAgentId(agentId);
  });
  ipcMain.handle("agent:getSelectedAgentIds", () => getSelectedAgentIds());
  ipcMain.handle("agent:setSelectedAgentIds", (_event, agentIds: string[]) => {
    setSelectedAgentIds(agentIds);
  });
  ipcMain.handle("agent:closeThreadSession", (_event, threadId: string) =>
    requireAgentManager().closeThreadSession(threadId),
  );
  ipcMain.handle("agent:setEditorText", (_event, text: string) =>
    requireAgentManager().setEditorText(text),
  );
  ipcMain.handle("agent:getEditorText", () => requireAgentManager().getEditorText());
  ipcMain.handle("agent:pasteToEditor", (_event, text: string) =>
    requireAgentManager().pasteToEditor(text),
  );
  ipcMain.on("agent:reportEditorText", (_event, text: string) => {
    requireAgentManager().reportEditorText(text);
  });

  ipcMain.handle("mcp:list", () => listMcpServers());
  ipcMain.handle("mcp:create", (_event, input) => createMcpServer(input));
  ipcMain.handle("mcp:update", (_event, id: string, input) => updateMcpServer(id, input));
  ipcMain.handle("mcp:delete", (_event, id: string) => {
    deleteMcpServer(id);
  });

  ipcMain.handle("terminal:create", (_event, sessionId: string, cwd?: string) => {
    if (isUpdateBusy()) throw new Error("New terminal sessions are disabled during an update.");
    if (ptyProcesses.has(sessionId)) {
      console.log(`[Main] PTY session ${sessionId} is already active. Reusing it.`);
      return;
    }

    const defaultShell =
      process.env["SHELL"] || (process.platform === "win32" ? resolveWindowsShell() : "bash");
    const shellArgs: string[] = [];
    if (
      process.platform !== "win32" &&
      (defaultShell.endsWith("zsh") || defaultShell.endsWith("bash") || defaultShell.endsWith("sh"))
    ) {
      shellArgs.push("-l");
    }

    let spawnCwd = cwd || os.homedir();
    if (spawnCwd && !fs.existsSync(spawnCwd)) {
      console.warn(
        `[Main] CWD directory does not exist: ${spawnCwd}. Falling back to home directory.`,
      );
      spawnCwd = os.homedir();
    }

    let ptyProcess: pty.IPty;
    try {
      console.log(
        `[Main] Spawning PTY session ${sessionId} - Shell: ${defaultShell}, Args: ${JSON.stringify(shellArgs)}, CWD: ${spawnCwd}`,
      );
      prependStandardPaths();
      ptyProcess = pty.spawn(defaultShell, shellArgs, {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: spawnCwd,
        env: {
          ...process.env,
          TERM: "xterm-256color",
        } as Record<string, string>,
      });

      ptyProcesses.set(sessionId, ptyProcess);
    } catch (err) {
      console.error(`[Main] Error spawning PTY process for session ${sessionId}:`, err);
      throw err;
    }

    ptyProcess.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("terminal:data", { sessionId, data });
      }
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("terminal:exit", {
          sessionId,
          exitCode,
          signal,
        });
      }
      ptyProcesses.delete(sessionId);
    });
  });

  ipcMain.on(
    "terminal:write",
    (_event, { sessionId, data }: { sessionId: string; data: string }) => {
      const ptyProcess = ptyProcesses.get(sessionId);
      if (ptyProcess) {
        ptyProcess.write(data);
      }
    },
  );

  ipcMain.on(
    "terminal:resize",
    (_event, { sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
      const ptyProcess = ptyProcesses.get(sessionId);
      if (ptyProcess) {
        try {
          ptyProcess.resize(cols, rows);
        } catch (e) {
          console.error(`Error resizing PTY ${sessionId}:`, e);
        }
      }
    },
  );

  ipcMain.handle("terminal:kill", (_event, sessionId: string) => {
    const ptyProcess = ptyProcesses.get(sessionId);
    if (ptyProcess) {
      try {
        ptyProcess.kill();
      } catch (e) {
        console.error(`Error killing PTY ${sessionId}:`, e);
      }
      ptyProcesses.delete(sessionId);
    }
  });

  ipcMain.handle("theme:getCurrent", () => currentTheme);

  ipcMain.on("theme:changed", (_event, theme: string) => {
    currentTheme = normalizeTheme(theme);
    broadcastToWindows("theme:changed", currentTheme);
  });

  // ─── Editor IPC ─────────────────────────────────────────────────────────────
  ipcMain.handle("editor:activate", async () => {
    if (isUpdateBusy()) throw new Error("Edit Mode is disabled during an update.");
    await ensurePipperEditBaseline();
    return requireAgentManager().activateEditor();
  });
  ipcMain.handle("editor:getState", () => requireAgentManager().getEditorState());
  ipcMain.handle(
    "editor:sendPrompt",
    (_event, input: { message: string; streamingBehavior?: "followUp" | "steer" }) =>
      requireAgentManager().sendEditorPrompt(input),
  );
  ipcMain.handle("editor:abort", () => requireAgentManager().abortEditor());
  ipcMain.handle("editor:setModel", (_event, model: { provider: string; modelId: string }) =>
    requireAgentManager().setEditorModel(model),
  );
  ipcMain.handle("editor:dispose", () => {
    pipperEditBaseline = null;
    return requireAgentManager().disposeEditor();
  });

  ipcMain.handle(
    "analytics:componentMutationRequested",
    (_event, input: { componentId?: string | null; source?: "overlay" | "companion" }) => {
      const projectId = getActiveProjectId();
      if (!projectId) return;
      captureAnalytics("component_mutation_requested", {
        windowType: input.source === "companion" ? "companion" : "main",
        properties: {
          project_id: projectId,
          component_id: sanitizeIdentifier(input.componentId),
          source: input.source ?? "overlay",
        },
      });
    },
  );

  // ─── Pipper IPC ─────────────────────────────────────────────────────────────
  ipcMain.handle("pipper:setProcessing", (_event, processingId: string | null) => {
    broadcastToWindows("pipper:stateChanged", { processingId });
  });
  ipcMain.handle("pipper:setOverlayVisible", (_event, overlayVisible: boolean) => {
    broadcastToWindows("pipper:stateChanged", { overlayVisible });
  });
  ipcMain.handle("pipper:enterEditMode", async () => {
    if (isUpdateBusy()) throw new Error("Edit Mode is disabled during an update.");
    await ensurePipperEditBaseline();
    broadcastToWindows("pipper:stateChanged", { editMode: true, overlayVisible: true });
  });
  ipcMain.handle("pipper:exitEditMode", () => {
    broadcastToWindows("pipper:stateChanged", { editMode: false });
  });
  ipcMain.handle("pipper:addComment", (_event, pipperId: string, text: string) => {
    // broadcast to companion window so it can auto-fill the InputMessage
    broadcastToWindows("pipper:commentAdded", { pipperId, text });
  });

  // ─── Onboarding IPC ─────────────────────────────────────────────────────────────
  ipcMain.handle("onboarding:verifyGit", async () => {
    return await checkGit();
  });

  ipcMain.handle("onboarding:startSetup", async (event) => {
    const sendProgress = (step: string, status: string, error?: string, gitInstalled?: boolean) => {
      event.sender.send("onboarding:progress", {
        step,
        status,
        error,
        gitInstalled,
      });
    };

    try {
      sendProgress("Checking Git installation...", "running");
      if (!(await checkGit())) {
        sendProgress("Installing Git...", "running", undefined, false);
        await installGit();
      }

      sendProgress("Checking Mise, Node, and Bun versions...", "running", undefined, true);
      const deps = await checkAllDependencies();

      if (!deps.miseInstalled || !deps.nodeMatch || !deps.bunMatch) {
        sendProgress("Installing Mise version manager...", "running", undefined, true);
        await installMise();

        sendProgress(
          "Setting up required Node and Bun versions locally...",
          "running",
          undefined,
          true,
        );
        await installNodeAndBunWithMise();
      }

      sendProgress(
        usesLocalDevelopmentWorkspace()
          ? "Initializing local development workspace..."
          : `Initializing workspaces inside ${getPipperLibraryDisplayPath()}...`,
        "running",
        undefined,
        true,
      );
      await initializeWorkspaces(app.getAppPath(), isDev);

      sendProgress("Pipper is ready!", "complete", undefined, true);
    } catch (err: any) {
      console.error("[Onboarding] Setup failed:", err);
      sendProgress("Setup failed.", "failed", err.message || String(err), true);
    }
  });

  // ─── Pipper Accept/Reject IPC ───────────────────────────────────────────────
  ipcMain.handle("pipper:acceptChanges", async (_event, intent?: string) => {
    const activePath = getActivePath();
    const projectId = getActiveProjectId();
    try {
      if (!pipperEditBaseline) {
        throw new Error("Edit session is still initializing. Try again in a moment.");
      }
      const filesChanged = await listPipperEditChangedFiles(activePath);
      if (filesChanged.length === 0) return { committed: false, filesChanged };
      const patchPath = join(activePath, "patch.md");
      const existing = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, "utf8") : "";
      const entry = {
        change_id: randomUUID(),
        files_changed: filesChanged,
        metadata_files: ["patch.md"],
        intent: intent?.trim() || "Accepted visual customization",
      };
      fs.writeFileSync(patchPath, `${JSON.stringify(entry, null, 2)}\n\n${existing}`);
      const filesToCommit = Array.from(new Set([...filesChanged, "patch.md"]));
      await execFileAsync("git", ["add", "--", ...filesToCommit], {
        cwd: activePath,
      });
      await execFileAsync(
        "git",
        ["commit", "--only", "-m", "Pipper Visual Edit Accept", "--", ...filesToCommit],
        {
          cwd: activePath,
        },
      );
      const { stdout: headOutput } = await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: activePath,
      });
      const installationPath = getInstallationMetadataPath();
      const installation = JSON.parse(fs.readFileSync(installationPath, "utf8"));
      installation.customized_head_commit = headOutput.trim();
      installation.last_healthy_at = new Date().toISOString();
      fs.writeFileSync(installationPath, `${JSON.stringify(installation, null, 2)}\n`);
      await backupActiveWorkspace();
      pipperEditBaseline = null;
      if (projectId) {
        captureAnalytics("mutation_accepted", {
          windowType: "companion",
          properties: {
            project_id: projectId,
            source: "companion",
          },
        });
      }
      return { committed: true, filesChanged };
    } catch (err: any) {
      if (projectId) {
        captureAnalytics("mutation_completed", {
          windowType: "companion",
          properties: {
            project_id: projectId,
            outcome: "error",
            source: "companion",
            error_type: sanitizeErrorType(err),
          },
        });
      }
      console.error("[Accept] Failed to back up active workspace:", err.message || err);
      throw err;
    }
  });

  ipcMain.handle("pipper:rejectChanges", async () => {
    const projectId = getActiveProjectId();
    try {
      await rejectPipperEditChanges();
      if (projectId) {
        captureAnalytics("mutation_rejected", {
          windowType: "companion",
          properties: {
            project_id: projectId,
            source: "companion",
            rejection_stage: "after_review",
          },
        });
        captureAnalytics("rollback_executed", {
          windowType: "companion",
          properties: {
            project_id: projectId,
            success: true,
          },
        });
      }
    } catch (err: any) {
      if (projectId) {
        captureAnalytics("rollback_executed", {
          windowType: "companion",
          properties: {
            project_id: projectId,
            success: false,
            error_type: sanitizeErrorType(err),
          },
        });
      }
      console.error("[Reject] Failed to restore workspace from backup:", err.message || err);
      throw err;
    }
  });
}

app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    const iconPath = getIconPath();
    if (iconPath) {
      try {
        app.dock?.setIcon(iconPath);
      } catch (err) {
        console.error("[Main] Failed to set macOS dock icon:", err);
      }
    }
  }
  buildAppMenu();
  getDb();
  const authUser = getAuthenticatedUserForLaunch();
  if (authUser) {
    identifyAnalyticsUser({
      providerUserId: authUser.provider_user_id,
      email: authUser.email,
      name: authUser.name,
      avatarUrl: authUser.avatar_url,
    });
  }
  agentManager = new AgentManager({
    sendToRenderer: sendToMainWindow,
    setWindowTitle: setMainWindowTitle,
    sendToFlyout: sendToCompanionWindow,
    broadcastActiveProject: (projectId: string) => {
      broadcastToWindows("projects:activeChanged", projectId);
    },
    captureAnalytics: (
      name: "mutation_started" | "mutation_completed" | "thread_created",
      properties: AnalyticsProperties,
    ) => {
      captureAnalytics(name, {
        windowType:
          properties.source === "overlay_comment" || properties.source === "companion_prompt"
            ? "companion"
            : "main",
        properties,
      });
    },
    reloadMainWindow: async () => {
      console.log("[Main] agent_end triggered. Restarting dev server and reloading main window...");
      try {
        await restartViteServer();
      } catch (err) {
        console.error("[Main] Failed to restart Vite server on agent_end:", err);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reload();
      }
    },
  });
  updateManager = new UpdateManager({
    manifestUrl:
      process.env.PIPPER_UPDATE_MANIFEST_URL ??
      import.meta.env.VITE_PIPPER_UPDATE_MANIFEST_URL ??
      DEFAULT_AGENT_UPDATE_MANIFEST_URL,
    repositoryUrl:
      process.env.PIPPER_UPSTREAM_REPOSITORY_URL ??
      import.meta.env.VITE_PIPPER_UPSTREAM_REPOSITORY_URL ??
      DEFAULT_UPSTREAM_REPOSITORY_URL,
    agent: agentManager,
    broadcastState: (state) => broadcastToWindows("update:stateChanged", state),
    broadcastProgress: (progress) => broadcastToWindows("update:progress", progress),
    broadcastUpdaterEvent: (payload) => broadcastToWindows("updater:event", payload),
    prepareForUpdate: prepareProcessesForUpdate,
    restartPromotedApp: restartAfterPromotion,
  });
  const launcherManifestUrl = resolveLauncherUpdateManifestUrl({
    platform: process.platform,
    macManifestUrl:
      process.env.PIPPER_LAUNCHER_UPDATE_MANIFEST_URL ??
      import.meta.env.VITE_PIPPER_LAUNCHER_UPDATE_MANIFEST_URL ??
      PIPPER_LAUNCHER_MAC_MANIFEST_URL,
    windowsManifestUrl:
      process.env.PIPPER_LAUNCHER_WINDOWS_UPDATE_MANIFEST_URL ??
      import.meta.env.VITE_PIPPER_LAUNCHER_WINDOWS_UPDATE_MANIFEST_URL ??
      PIPPER_LAUNCHER_WINDOWS_MANIFEST_URL,
  });
  const launcherUpdatesEnabled =
    app.isPackaged ||
    (process.env.PIPPER_ENABLE_LAUNCHER_UPDATES_IN_DEV === "1" && launcherManifestUrl != null);
  if (!launcherManifestUrl)
    console.info("[LauncherUpdate] Disabled: manifest URL is not configured.");
  launcherUpdateManager = new LauncherUpdateManager({
    currentVersion: app.getVersion(),
    manifestUrl: launcherManifestUrl,
    rootPath: join(getPipperLibraryPath(), "launcher-updates"),
    enabled: launcherUpdatesEnabled,
    broadcastState: (state) => broadcastToWindows("launcher-update:stateChanged", state),
    broadcastProgress: (progress) => broadcastToWindows("launcher-update:progress", progress),
  });
  registerIpc();
  await launcherUpdateManager.recover();
  launcherUpdateManager.startPeriodicChecks();
  void launcherUpdateManager.check();

  if (isDev && !usesLocalDevelopmentWorkspace()) {
    startDevFileWatcher();
  }

  if (!(await isWorkspaceReady())) {
    console.log("[Main] Launching launcher while workspace setup runs in background.");
    createLaunchWindow("list");
    void runWorkspaceSetupForLauncher();
  } else {
    // Keep the shared dependency cache aligned with the packaged template. The
    // workspace can be "ready" while still missing dependencies added by an app update.
    await ensureWorkspaceReady();
    await initializeUpdateSubsystem();
    const state = await readLaunchState();
    const authUser = getAuthenticatedUserForLaunch();
    if (state.completed && authUser) {
      if (state.projectId) {
        setActiveProjectId(state.projectId);
        await agentManager.activateFromLaunchState();
      }
      createMainWindow();
    } else {
      createLaunchWindow("list");
    }
  }

  app.on("activate", async () => {
    const hasMain = mainWindow && !mainWindow.isDestroyed();
    const hasLaunch = launchWindow && !launchWindow.isDestroyed();
    if (!hasMain && !hasLaunch) {
      if (!(await isWorkspaceReady())) {
        createLaunchWindow("list");
        void runWorkspaceSetupForLauncher();
        return;
      }

      void readLaunchState().then((s) => {
        const authUser = getAuthenticatedUserForLaunch();
        if (s.completed && authUser) {
          if (s.projectId) {
            setActiveProjectId(s.projectId);
            void agentManager?.activateFromLaunchState();
          }
          createMainWindow();
        } else {
          createLaunchWindow("list");
        }
      });
    }
  });
});

app.on("before-quit", (event) => {
  if (quitAuthorized || !updateManager?.getState().scheduled_for_quit) return;
  event.preventDefault();
  if (updateQuitInProgress) return;
  updateQuitInProgress = true;
  updateManager.announceScheduledQuit();
  if ((!mainWindow || mainWindow.isDestroyed()) && (!launchWindow || launchWindow.isDestroyed())) {
    createLaunchWindow("list");
  }
  void (async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (updateManager?.isCheckStale()) await updateManager.check();
    const result = await updateManager!.startNow();
    if (result.success) {
      quitAuthorized = true;
      app.quit();
    } else {
      updateQuitInProgress = false;
      if (result.cancelled) {
        quitAuthorized = true;
        app.quit();
      }
    }
  })();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  authCallbackServer?.close();
  updateManager?.stopPeriodicChecks();
  launcherUpdateManager?.stopPeriodicChecks();
  void agentManager?.dispose();
  void shutdownAnalytics();
  for (const [id, ptyProc] of ptyProcesses.entries()) {
    try {
      ptyProc.kill();
    } catch (e) {
      console.error(`Failed to kill PTY process ${id}`, e);
    }
  }
  ptyProcesses.clear();

  if (viteProcess) {
    try {
      viteProcess.kill();
    } catch (e) {
      console.error("Failed to kill Vite compiler process:", e);
    }
    viteProcess = null;
  }
});
