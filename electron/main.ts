import { app, BrowserWindow, Menu, shell, ipcMain, dialog } from "electron";
import { join, dirname } from "node:path";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import * as pty from "node-pty";
import {
  markLaunchComplete,
  readLaunchState,
  readWorkspaceSelections,
  updateWorkspaceSelection,
} from "./launch-state";
import { pickWorkspaceThread } from "../contracts/workspace-scope.ts";
import { createProject, getProject, listProjects } from "./projects";
import {
  createWorktree,
  listBranches,
  listWorktrees,
  resolveInstallCommand,
  samePath,
  switchWorktreeBranch,
} from "./worktree-manager";
import type { WorktreeSetupProgress } from "../contracts/worktrees.ts";
import type { ProjectFileGitStatus, ProjectFileTreeSnapshot } from "../contracts/projects.ts";
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
import { getThread, listThreads, listThreadsByIds, listProjectThreads } from "./threads";
import { listMcpServers, createMcpServer, updateMcpServer, deleteMcpServer } from "./mcp-servers";
import { AgentManager } from "./agent";
import { probeAgentById } from "./agents/handshake-probe.ts";
import {
  broadcastOpenTabsChanged,
  closeThreadTab,
  openThreadTab,
  readOpenTabsState,
  recordThreadSwitch,
  setActiveThreadTab,
} from "./open-tabs";
import { checkGit, installGit, prependStandardPaths } from "./dependency-installer";
import {
  captureAnalytics,
  captureAnalyticsException,
  flushAnalytics,
  identifyAnalyticsUser,
  setActiveAgentContext,
  shutdownAnalytics,
} from "./analytics";
import {
  flushTelemetry,
  initializeTelemetry,
  logTelemetryError,
  shutdownTelemetry,
} from "./telemetry";
import type { AnalyticsEventName, AnalyticsProperties } from "./analytics-schema";
import { sanitizeErrorType } from "./analytics-sanitize";

// Initialize PATH prepend early for child process resolutions
prependStandardPaths();

import { getPipperLibraryPath } from "./paths";
import { LauncherUpdateManager } from "./launcher-update-manager";
import { launchLauncherInstaller } from "./launcher-update-install.ts";
import { resolveLauncherUpdateManifestUrl } from "./launcher-update-config.ts";
import {
  PIPPER_LAUNCHER_MAC_MANIFEST_URL,
  PIPPER_LAUNCHER_WINDOWS_MANIFEST_URL,
} from "../contracts/launcher-release-urls.ts";

const mainDir = dirname(fileURLToPath(import.meta.url));

interface RendererPtySession {
  process: pty.IPty;
  dataDisposable: pty.IDisposable;
  exitDisposable: pty.IDisposable;
}

const ptyProcesses = new Map<string, RendererPtySession>();
const execFileAsync = promisify(execFile);

function disposePtySession(session: RendererPtySession): void {
  session.dataDisposable.dispose();
  session.exitDisposable.dispose();
}

function killAllPtyProcesses(reason: string): void {
  for (const [id, session] of ptyProcesses) {
    try {
      session.process.kill();
    } catch (error) {
      console.warn(`[${reason}] Failed to stop terminal ${id}:`, error);
    }
    disposePtySession(session);
  }
  ptyProcesses.clear();
}

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
    try {
      walk(projectPath);
    } catch {
      return [];
    }
    return results.sort();
  }
}

function parseProjectGitStatus(output: string): ProjectFileTreeSnapshot["gitStatus"] {
  const entries: ProjectFileTreeSnapshot["gitStatus"] = [];
  const records = output.split("\0");

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;

    const code = record.slice(0, 2);
    const path = record.slice(3);
    let status: ProjectFileGitStatus | null = null;

    if (code === "??") status = "untracked";
    else if (code === "!!") status = "ignored";
    else if (code.includes("R") || code.includes("C")) status = "renamed";
    else if (code.includes("D")) status = "deleted";
    else if (code.includes("A")) status = "added";
    else if (code.includes("M") || code.includes("T") || code.includes("U")) {
      status = "modified";
    }

    if (status) entries.push({ path, status });

    // Porcelain v1 emits a second NUL-delimited source path for renames and
    // copies. The first path is the destination, which is the one in ls-files.
    if (code.includes("R") || code.includes("C")) index += 1;
  }

  return entries;
}

async function listProjectFileTree(projectPath: string): Promise<ProjectFileTreeSnapshot> {
  const [paths, gitStatus] = await Promise.all([
    listProjectFiles(projectPath),
    execFileAsync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      cwd: projectPath,
      maxBuffer: 1024 * 1024 * 4,
    })
      .then(({ stdout }) => parseProjectGitStatus(String(stdout)))
      .catch(() => []),
  ]);

  return { paths, gitStatus };
}
let currentTheme: "light" | "dark" | "system" = "system";

const isDev = !app.isPackaged;

initializeTelemetry();

if (isDev && !process.env.PIPPER_LIBRARY_PATH) {
  const devUserDataPath =
    process.env.PIPPER_DEV_USER_DATA_PATH ?? join(app.getPath("appData"), "pipper-dev");
  app.setPath("userData", devUserDataPath);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

// Without these, an uncaught error anywhere in the main process (e.g. handling
// an ACP session/update from an agent) crashes the whole process and takes
// every window down with it. Log and keep running instead.
process.on("uncaughtException", (err) => {
  console.error("[main] Uncaught exception:", err);
  captureAnalyticsException(err, { source: "agent_runtime", error_type: sanitizeErrorType(err) });
  logTelemetryError("Uncaught exception in Electron main process", {
    error_type: sanitizeErrorType(err) ?? "Error",
  });
});
process.on("unhandledRejection", (reason) => {
  console.error("[main] Unhandled rejection:", reason);
  captureAnalyticsException(reason, {
    source: "agent_runtime",
    error_type: sanitizeErrorType(reason),
  });
  logTelemetryError("Unhandled rejection in Electron main process", {
    error_type: sanitizeErrorType(reason) ?? "Error",
  });
});

function generateRandomId(): string {
  const hex = randomBytes(4).toString("hex");
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

function normalizeTheme(theme: string): "light" | "dark" | "system" {
  return theme === "light" || theme === "dark" || theme === "system" ? theme : "system";
}

let mainWindow: BrowserWindow | null = null;
let launchWindow: BrowserWindow | null = null;
let agentManager: AgentManager | null = null;
let launcherUpdateManager: LauncherUpdateManager | null = null;
let authCallbackServer: http.Server | null = null;
let authCallbackPort: number | null = null;
let pendingAuthCallback: Promise<void> | null = null;

function requireAgentManager(): AgentManager {
  if (!agentManager) {
    throw new Error("Agent manager is not initialized.");
  }
  return agentManager;
}

function requireLauncherUpdateManager(): LauncherUpdateManager {
  if (!launcherUpdateManager) throw new Error("Launcher update manager is not initialized.");
  return launcherUpdateManager;
}

/**
 * Enter a workspace (the project root or a linked worktree): persist it as
 * the project's canonical workspace, then restore that workspace's own last
 * active thread — its most-recently-used open tab, else its most recent
 * thread from history, else a fresh thread. A workspace switch is a context
 * change, not a collapse to one canonical thread per worktree.
 */
async function activateProjectWorktree(projectId: string, targetPath: string) {
  const project = getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const target = listWorktrees(project.path).find((worktree) =>
    samePath(worktree.path, targetPath),
  );
  if (!target) throw new Error("Worktree is no longer available");

  const worktreePath = target.isProjectRoot ? null : target.path;
  await updateWorkspaceSelection(project.id, target.path);

  const tabsState = await readOpenTabsState();
  let thread = pickWorkspaceThread({
    projectId: project.id,
    workspacePath: worktreePath,
    openThreadIds: tabsState.openThreadIds,
    threadSwitchHistory: tabsState.threadSwitchHistory,
    threads: listThreads(),
  });
  if (thread) {
    await requireAgentManager().switchThread(thread.id);
  } else {
    thread = await requireAgentManager().createThread(project.id, null, null, null, worktreePath);
  }

  captureAnalytics("workspace_switched", {
    windowType: "main",
    properties: { project_id: project.id, is_main: worktreePath === null },
  });

  const next = await openThreadTab(thread.id);
  broadcastOpenTabsChanged(mainWindow, next);
  return { thread, worktree: target };
}

const WORKTREE_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Install a freshly created worktree's dependencies in the background so the
 * workspace is ready to run without a manual install. The package manager is
 * detected from the worktree's lockfile; progress is broadcast to the
 * renderer (`worktrees:setupProgress`) for toasts. Never throws — a failed
 * install must not undo the created worktree, it just reports.
 */
async function installWorktreeDependencies(
  projectId: string,
  worktreePath: string,
  workspaceName: string,
): Promise<void> {
  const report = (
    progress: Omit<WorktreeSetupProgress, "projectId" | "worktreePath" | "workspaceName">,
  ) =>
    broadcastToWindows("worktrees:setupProgress", {
      projectId,
      worktreePath,
      workspaceName,
      ...progress,
    } satisfies WorktreeSetupProgress);

  const install = resolveInstallCommand(worktreePath);
  if (!install) {
    report({ status: "skipped" });
    return;
  }

  report({ status: "installing", manager: install.manager });
  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn(install.command, install.args, {
        cwd: worktreePath,
        env: process.env,
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      let outputTail = "";
      const collect = (chunk: Buffer) => {
        outputTail = (outputTail + chunk.toString()).slice(-4000);
      };
      child.stdout?.on("data", collect);
      child.stderr?.on("data", collect);
      const timeout = setTimeout(() => {
        child.kill();
        rejectPromise(new Error(`${install.manager} install timed out after 10 minutes.`));
      }, WORKTREE_INSTALL_TIMEOUT_MS);
      child.on("error", (err) => {
        clearTimeout(timeout);
        rejectPromise(
          new Error(`Could not run ${install.manager}: ${err.message}. Is it installed?`),
        );
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) resolvePromise();
        else {
          const tail = outputTail.trim().split("\n").slice(-8).join("\n");
          rejectPromise(new Error(`${install.manager} install exited with code ${code}.\n${tail}`));
        }
      });
    });
    report({ status: "installed", manager: install.manager });
  } catch (err) {
    console.error(`[Worktree] Dependency install failed for ${worktreePath}:`, err);
    report({
      status: "failed",
      manager: install.manager,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Predicate for "tab in the same (project, workspace) as this thread", used
 * to keep next-active selection inside the current workspace when a tab
 * closes. Must be built before the thread row is deleted.
 */
function makeWorkspacePeerPredicate(threadId: string): ((id: string) => boolean) | undefined {
  const closed = getThread(threadId);
  if (!closed) return undefined;
  const workspacePath = closed.worktree_path ?? null;
  return (id) => {
    const candidate = getThread(id);
    return (
      candidate !== null &&
      candidate.project_id === closed.project_id &&
      (candidate.worktree_path ?? null) === workspacePath
    );
  };
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
    killAllPtyProcesses("WindowClosed");
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

  void loadInto(mainWindow, "main");
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
    width: 960,
    height: 720,
    minWidth: 640,
    minHeight: 560,
    resizable: true,
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

function broadcastToWindows(channel: string, ...args: any[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
  if (launchWindow && !launchWindow.isDestroyed()) {
    launchWindow.webContents.send(channel, ...args);
  }
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
            void launcherUpdateManager?.check();
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
    try {
      const path = await manager.verifyDownloadedInstaller();
      await launchLauncherInstaller(path);
      app.quit();
      return { success: true };
    } catch (error) {
      const state = manager.recordFailure(error);
      return { success: false, error: state.error ?? "Unable to open the installer." };
    }
  });

  ipcMain.handle("projects:list", () => listProjects());

  ipcMain.handle("projects:getActive", () => {
    const id = getActiveProjectId();
    return id ? getProject(id) : null;
  });

  ipcMain.handle("projects:listFiles", async () => {
    // Follow the active worktree's cwd, not the project root, so file paths
    // reflect the selected workspace. Falls back to the project root.
    const cwd = requireAgentManager().getActiveCwd();
    if (cwd && fs.existsSync(cwd)) return listProjectFiles(cwd);
    const id = getActiveProjectId();
    const project = id ? getProject(id) : null;
    if (!project || !fs.existsSync(project.path)) return [];
    return listProjectFiles(project.path);
  });

  ipcMain.handle("projects:getFileTree", async () => {
    // Keep the flyout aligned with the currently selected worktree.
    const cwd = requireAgentManager().getActiveCwd();
    if (cwd && fs.existsSync(cwd)) return listProjectFileTree(cwd);
    const id = getActiveProjectId();
    const project = id ? getProject(id) : null;
    if (!project || !fs.existsSync(project.path)) return { paths: [], gitStatus: [] };
    return listProjectFileTree(project.path);
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

  ipcMain.handle("worktrees:list", (_event, projectId: string) => {
    const project = getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    // Include the project root so the title bar can show its real branch
    // alongside the linked worktrees.
    return listWorktrees(project.path);
  });

  ipcMain.handle("worktrees:switch", async (_event, input: { projectId: string; path: string }) => {
    const { thread } = await activateProjectWorktree(input.projectId, input.path);
    return thread;
  });

  // The persisted canonical workspace per project — the renderer hydrates its
  // selection map from this so header, tab scoping, and new-thread/terminal
  // targets agree after a relaunch.
  ipcMain.handle("worktrees:getSelections", () => readWorkspaceSelections());

  ipcMain.handle("worktrees:listBranches", (_event, input: { projectId: string }) => {
    const project = getProject(input.projectId);
    if (!project) throw new Error(`Project not found: ${input.projectId}`);
    return listBranches(project.path);
  });

  ipcMain.handle(
    "worktrees:switchBranch",
    async (_event, input: { projectId: string; path: string; branch: string }) => {
      const project = getProject(input.projectId);
      if (!project) throw new Error(`Project not found: ${input.projectId}`);

      const worktree = switchWorktreeBranch(project.path, input.path, input.branch);
      try {
        const { thread } = await activateProjectWorktree(input.projectId, worktree.path);
        return { thread, worktree };
      } catch (err) {
        // Activation failed: restore the worktree state to match the mutated Git branch
        const restoredWorktree = listWorktrees(project.path).find((w) =>
          samePath(w.path, input.path),
        );
        if (restoredWorktree) {
          return { thread: null, worktree: restoredWorktree };
        }
        throw err;
      }
    },
  );

  ipcMain.handle("worktrees:create", (_event, input: { projectId: string; name: string }) => {
    const project = getProject(input.projectId);
    if (!project) throw new Error(`Project not found: ${input.projectId}`);
    const worktree = createWorktree({
      projectPath: project.path,
      projectId: project.id,
      name: input.name,
    });
    captureAnalytics("worktree_created", {
      windowType: "main",
      properties: { project_id: project.id },
    });
    // A fresh worktree must be usable without a manual `bun/npm install` —
    // kick that off in the background (installs can take minutes; the create
    // itself stays snappy) and stream progress to the renderer for toasts.
    void installWorktreeDependencies(project.id, worktree.path, input.name);
    // Return the same annotated Git view used by the title bar, rather than
    // a locally invented display label for the newly-created checkout.
    return (
      listWorktrees(project.path).find((item) => samePath(item.path, worktree.path)) ?? worktree
    );
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
    setActiveProjectId(projectId);
    await markLaunchComplete(projectId);
    await requireAgentManager().activateProject(projectId);

    if (launchWindow && !launchWindow.isDestroyed()) {
      launchWindow.close();
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      killAllPtyProcesses("LaunchComplete");
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

  ipcMain.handle("launch:getUser", () => {
    return getAuthenticatedUserForLaunch();
  });

  ipcMain.handle("projects:setActive", async (_event, projectId: string) => {
    requireAuthenticatedUserForLaunch();
    const project = getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
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
      worktreePath?: string | null,
    ) => {
      return requireAgentManager().createThread(
        projectId,
        title,
        afterThreadId ?? null,
        agentId ?? null,
        worktreePath ?? null,
      );
    },
  );

  ipcMain.handle("threads:rename", (_event, id: string, title: string) => {
    return requireAgentManager().renameThread(id, title);
  });

  ipcMain.handle("threads:delete", async (_event, id: string) => {
    const isPeer = makeWorkspacePeerPredicate(id);
    await requireAgentManager().deleteThread(id);
    const next = await closeThreadTab(id, isPeer);
    broadcastOpenTabsChanged(mainWindow, next);
  });

  ipcMain.handle("tabs:listOpen", () => readOpenTabsState());

  ipcMain.handle("tabs:open", async (_event, threadId: string) => {
    const next = await openThreadTab(threadId);
    broadcastOpenTabsChanged(mainWindow, next);
    return next;
  });

  ipcMain.handle("tabs:close", async (_event, threadId: string) => {
    const isPeer = makeWorkspacePeerPredicate(threadId);
    try {
      await requireAgentManager().closeThreadSession(threadId);
    } catch (err) {
      console.warn("[IPC] closeThreadSession failed:", err);
    }
    const next = await closeThreadTab(threadId, isPeer);
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
  ipcMain.handle("agent:getRunningThreads", () => requireAgentManager().getRunningThreadIds());
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
      worktreePath?: string | null,
    ) => {
      try {
        return requireAgentManager().createThread(
          projectId,
          title,
          afterThreadId ?? null,
          agentId ?? null,
          worktreePath ?? null,
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
  ipcMain.handle("agent:probeAgent", (_event, agentId: string) => probeAgentById(agentId));
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

  ipcMain.handle("subagents:getConfig", () => requireAgentManager().getSubagentConfig());
  ipcMain.handle("subagents:setConfig", (_event, partial) =>
    requireAgentManager().setSubagentConfig(partial),
  );
  ipcMain.handle("subagents:listRuns", () => requireAgentManager().getSubagentRuns());

  ipcMain.handle("mcp:list", () => listMcpServers());
  ipcMain.handle("mcp:create", (_event, input) => createMcpServer(input));
  ipcMain.handle("mcp:update", (_event, id: string, input) => updateMcpServer(id, input));
  ipcMain.handle("mcp:delete", (_event, id: string) => {
    deleteMcpServer(id);
  });

  ipcMain.handle(
    "terminal:create",
    (_event, sessionId: string, cwd?: string, requestedCols?: number, requestedRows?: number) => {
      if (ptyProcesses.has(sessionId)) {
        console.log(`[Main] PTY session ${sessionId} is already active. Reusing it.`);
        return;
      }

      const defaultShell =
        process.env["SHELL"] || (process.platform === "win32" ? resolveWindowsShell() : "bash");
      const shellArgs: string[] = [];
      if (
        process.platform !== "win32" &&
        (defaultShell.endsWith("zsh") ||
          defaultShell.endsWith("bash") ||
          defaultShell.endsWith("sh"))
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

      const cols =
        Number.isInteger(requestedCols) && requestedCols! > 0 ? Math.min(requestedCols!, 1000) : 80;
      const rows =
        Number.isInteger(requestedRows) && requestedRows! > 0 ? Math.min(requestedRows!, 1000) : 24;

      let ptyProcess: pty.IPty;
      try {
        console.log(
          `[Main] Spawning PTY session ${sessionId} - Shell: ${defaultShell}, Args: ${JSON.stringify(shellArgs)}, CWD: ${spawnCwd}, Size: ${cols}x${rows}`,
        );
        prependStandardPaths();
        ptyProcess = pty.spawn(defaultShell, shellArgs, {
          name: "xterm-256color",
          cols,
          rows,
          cwd: spawnCwd,
          env: {
            ...process.env,
            TERM: "xterm-256color",
          } as Record<string, string>,
        });
      } catch (err) {
        console.error(`[Main] Error spawning PTY process for session ${sessionId}:`, err);
        throw err;
      }

      const dataDisposable = ptyProcess.onData((data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("terminal:data", { sessionId, data });
        }
      });
      let session!: RendererPtySession;
      const exitDisposable = ptyProcess.onExit(({ exitCode, signal }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("terminal:exit", {
            sessionId,
            exitCode,
            signal,
          });
        }
        if (ptyProcesses.get(sessionId) === session) ptyProcesses.delete(sessionId);
        disposePtySession(session);
      });
      session = { process: ptyProcess, dataDisposable, exitDisposable };
      ptyProcesses.set(sessionId, session);
    },
  );

  ipcMain.handle(
    "terminal:write",
    (_event, { sessionId, data }: { sessionId: string; data: string }) => {
      const session = ptyProcesses.get(sessionId);
      if (!session) throw new Error(`Terminal session ${sessionId} is not running.`);
      try {
        session.process.write(data);
      } catch (error) {
        console.error(`Error writing to PTY ${sessionId}:`, error);
        throw error;
      }
    },
  );

  ipcMain.handle(
    "terminal:resize",
    (_event, { sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
      const session = ptyProcesses.get(sessionId);
      if (!session) throw new Error(`Terminal session ${sessionId} is not running.`);
      try {
        session.process.resize(cols, rows);
      } catch (error) {
        console.error(`Error resizing PTY ${sessionId}:`, error);
        throw error;
      }
    },
  );

  ipcMain.handle("terminal:kill", (_event, sessionId: string) => {
    const session = ptyProcesses.get(sessionId);
    if (session) {
      ptyProcesses.delete(sessionId);
      try {
        session.process.kill();
      } catch (error) {
        console.error(`Error killing PTY ${sessionId}:`, error);
      }
      disposePtySession(session);
    }
  });

  ipcMain.handle("theme:getCurrent", () => currentTheme);

  ipcMain.on("theme:changed", (_event, theme: string) => {
    currentTheme = normalizeTheme(theme);
    broadcastToWindows("theme:changed", currentTheme);
  });

  ipcMain.handle(
    "analytics:captureException",
    (_event, input: { name?: string; message?: string; stack?: string }) => {
      const error = new Error(input.message?.slice(0, 1000) || "Unknown renderer exception");
      error.name = input.name?.slice(0, 128) || "Error";
      if (input.stack) error.stack = input.stack.slice(0, 10_000);
      captureAnalyticsException(error, {
        source: "agent_panel",
        error_type: sanitizeErrorType(error),
      });
      logTelemetryError("Uncaught renderer exception", {
        error_type: sanitizeErrorType(error) ?? "Error",
      });
    },
  );

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
      // Track the first-run setup funnel. The human step string is slugified to a
      // stable identifier; raw error text is never sent (it can contain paths).
      captureAnalytics("onboarding_step", {
        windowType: "launch",
        properties: {
          step: step
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .slice(0, 64),
          status,
          success: status !== "failed",
        },
      });
    };

    try {
      sendProgress("Checking Git installation...", "running");
      if (!(await checkGit())) {
        sendProgress("Installing Git...", "running", undefined, false);
        await installGit();
      }

      sendProgress("Pipper is ready!", "complete", undefined, true);
    } catch (err: any) {
      console.error("[Onboarding] Setup failed:", err);
      sendProgress("Setup failed.", "failed", err.message || String(err), true);
    }
  });
}

/**
// ─── Usage & duration tracking ──────────────────────────────────────────────
/** Wall-clock start of this app session; diffed on quit for session_duration_ms. */
const sessionStartedAt = Date.now();
const USAGE_HEARTBEAT_INTERVAL_MS = 60_000;
let usageHeartbeatTimer: NodeJS.Timeout | null = null;
const TELEMETRY_FLUSH_INTERVAL_MS = 15_000;
let telemetryFlushTimer: NodeJS.Timeout | null = null;

/**
 * Emit `app_heartbeat` every interval, but only while a window is focused, so the
 * sum of heartbeats measures *active* (attention) time rather than idle-open time.
 * Base properties already carry the active agent, so this is attributable per agent.
 */
function startUsageHeartbeat(): void {
  if (usageHeartbeatTimer) return;
  usageHeartbeatTimer = setInterval(() => {
    const focused = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused());
    if (!focused) return;
    captureAnalytics("app_heartbeat", {
      windowType: "background",
      properties: { heartbeat_seconds: USAGE_HEARTBEAT_INTERVAL_MS / 1000 },
    });
  }, USAGE_HEARTBEAT_INTERVAL_MS);
  usageHeartbeatTimer.unref?.();
}

/**
 * macOS commonly keeps Electron apps resident after their windows close. Flush
 * independently of quitting so exceptions are visible within seconds, not only
 * after the user explicitly exits the app.
 */
function startTelemetryFlush(): void {
  if (telemetryFlushTimer) return;
  telemetryFlushTimer = setInterval(() => {
    void Promise.all([flushAnalytics(), flushTelemetry()]).catch((error) => {
      console.error("[Telemetry] Periodic flush failed:", error);
    });
  }, TELEMETRY_FLUSH_INTERVAL_MS);
  telemetryFlushTimer.unref?.();
}

app.whenReady().then(async () => {
  startUsageHeartbeat();
  startTelemetryFlush();
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
    broadcastActiveProject: (projectId: string) => {
      broadcastToWindows("projects:activeChanged", projectId);
    },
    captureAnalytics: (name: AnalyticsEventName, properties: AnalyticsProperties) => {
      captureAnalytics(name, {
        windowType: "main",
        properties,
      });
    },
    setAgentContext: setActiveAgentContext,
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

  const state = await readLaunchState();
  const currentAuthUser = getAuthenticatedUserForLaunch();
  if (state.completed && currentAuthUser) {
    if (state.projectId) {
      setActiveProjectId(state.projectId);
      await agentManager.activateFromLaunchState();
    }
    createMainWindow();
  } else {
    createLaunchWindow("list");
  }

  app.on("activate", async () => {
    const hasMain = mainWindow && !mainWindow.isDestroyed();
    const hasLaunch = launchWindow && !launchWindow.isDestroyed();
    if (!hasMain && !hasLaunch) {
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/** Prevents re-entrant will-quit after we flush analytics and call app.quit(). */
let analyticsQuitFlushed = false;
/** True while the async dispose/flush chain from will-quit is in flight. */
let analyticsQuitInProgress = false;

app.on("will-quit", (event) => {
  // Ensure PostHog identify / $set person-profile batches flush before the
  // process exits. Without this, short sessions can drop email/avatar entirely.
  if (analyticsQuitFlushed) return;
  event.preventDefault();
  if (analyticsQuitInProgress) return;
  analyticsQuitInProgress = true;

  authCallbackServer?.close();
  launcherUpdateManager?.stopPeriodicChecks();
  if (usageHeartbeatTimer) {
    clearInterval(usageHeartbeatTimer);
    usageHeartbeatTimer = null;
  }
  if (telemetryFlushTimer) {
    clearInterval(telemetryFlushTimer);
    telemetryFlushTimer = null;
  }
  captureAnalytics("app_closed", {
    windowType: "background",
    properties: { session_duration_ms: Date.now() - sessionStartedAt },
  });
  killAllPtyProcesses("Quit");

  void (async () => {
    try {
      await agentManager?.dispose();
    } catch (err) {
      console.error("[Main] Failed to dispose agent manager on quit:", err);
    }
    try {
      await shutdownAnalytics();
    } catch (err) {
      console.error("[Main] Failed to flush analytics on quit:", err);
    } finally {
      try {
        await shutdownTelemetry();
      } catch (err) {
        console.error("[Main] Failed to flush observability telemetry on quit:", err);
      }
      analyticsQuitFlushed = true;
      analyticsQuitInProgress = false;
      app.quit();
    }
  })();
});
