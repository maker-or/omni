import { app, BrowserWindow, Menu, shell, ipcMain, dialog } from "electron";
import { join, dirname } from "node:path";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import { spawn, exec } from "node:child_process";
import { promisify } from "node:util";
import * as pty from "node-pty";
import { markLaunchComplete, readLaunchState } from "./launch-state";
import { readCompanionState, writeCompanionState } from "./companion-state";
import { createProject, getProject, listProjects } from "./projects";
import { getActiveProjectId, setActiveProjectId } from "./session";
import { getDb, getMostRecentAuthUser, upsertAuthUser } from "./db";
import {
  listThreads,
  listThreadsByIds,
  listProjectThreads,
  getMessages,
  createMessage,
} from "./threads";
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
  checkNode,
  checkBun,
  installMise,
  installNodeAndBunWithMise,
  getMisePath,
  prependStandardPaths,
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
} from "./workspace-manager";
import { UpdateManager } from "./update-manager";

const mainDir = dirname(fileURLToPath(import.meta.url));

const ptyProcesses = new Map<string, pty.IPty>();

const isDev = !app.isPackaged;
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

function generateRandomId(): string {
  const hex = randomBytes(4).toString("hex");
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

let mainWindow: BrowserWindow | null = null;
let launchWindow: BrowserWindow | null = null;
let companionWindow: BrowserWindow | null = null;
let agentManager: AgentManager | null = null;
let updateManager: UpdateManager | null = null;
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
    ? join(app.getAppPath(), "public/icon.png")
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

function setMainWindowTitle(title: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(title);
  }
}

function resolveExternalUrl(kind: "clerkSignUp" | "clerkSignIn"): string {
  const url =
    kind === "clerkSignUp"
      ? (process.env["PIPPER_CLERK_SIGN_UP_URL"] ?? import.meta.env.VITE_CLERK_SIGN_UP_URL)
      : (process.env["PIPPER_CLERK_SIGN_IN_URL"] ?? import.meta.env.VITE_CLERK_SIGN_IN_URL);

  if (url) return url;
  const frontendUrl = import.meta.env.VITE_CLERK_FRONTEND_URL;
  if (frontendUrl) return frontendUrl;
  return "https://clerk.com";
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
    console.warn("[Main] Auth callback missing provider user id");
    return;
  }

  const record = upsertAuthUser({
    provider: "clerk",
    providerUserId: payload.providerUserId,
    email: payload.email,
    name: payload.name,
    avatarUrl: payload.avatarUrl,
  });

  console.log("[Main] Authenticated user stored:", record.provider_user_id);
  identifyAnalyticsUser(record.provider_user_id);

  if (launchWindow && !launchWindow.isDestroyed()) {
    launchWindow.webContents.send("launch:authComplete", record);
    launchWindow.show();
    launchWindow.focus();
  }
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
          res.end(
            "<!doctype html><html><body><h1>Signed in</h1><p>You can return to the desktop app.</p></body></html>",
          );
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

function extractViteUrl(output: string): string | null {
  const match = output.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+/i);
  return match?.[0] ?? null;
}

async function startViteServer(): Promise<string> {
  if (viteProcess && viteServerUrl) {
    return viteServerUrl;
  }

  const activePath = getActivePath();
  const cmd = getMisePath();
  console.log(`[Main] Spawning Vite Dev Server in ${activePath} using Mise`);

  return new Promise((resolve, reject) => {
    // Let Vite choose its normal port and auto-increment if needed. This keeps
    // the packaged app and the development app from fighting over a fixed port.
    viteProcess = spawn(cmd, ["exec", "--", "bun", "run", "vite", "--host", "127.0.0.1"], {
      cwd: activePath,
      env: { ...process.env, NODE_ENV: "development" },
    });

    let resolved = false;

    const maybeResolveFromOutput = (output: string) => {
      const url = extractViteUrl(output);
      if (!url) return;
      viteServerUrl = url;
      if (!resolved) {
        resolved = true;
        console.log(`[Main] Vite server ready at ${url}`);
        resolve(url);
      }
    };

    viteProcess.stdout?.on("data", (data) => {
      const output = data.toString();
      console.log(`[Vite compiler stdout] ${output}`);
      maybeResolveFromOutput(output);
    });

    viteProcess.stderr?.on("data", (data) => {
      const output = data.toString();
      console.error(`[Vite compiler stderr] ${output}`);
      maybeResolveFromOutput(output);
    });

    viteProcess.on("close", (code) => {
      console.log(`[Vite compiler] exited with code ${code}`);
      viteProcess = null;
      viteServerUrl = null;
      if (!resolved) {
        reject(
          new Error(`Vite dev server exited before becoming ready (code ${code ?? "unknown"}).`),
        );
      }
    });

    const maxTimeout = 15000;
    setTimeout(() => {
      if (!resolved) {
        reject(new Error("Timed out waiting for Vite dev server URL."));
      }
    }, maxTimeout);
  });
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
    shell.openExternal(url);
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
    alwaysOnTop: true,
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

  companionWindow.on("closed", () => {
    console.log("[Main] companionWindow closed");
    companionWindow = null;
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
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  ipcMain.handle("update:check", () => requireUpdateManager().check());
  ipcMain.handle("update:getState", () => requireUpdateManager().getState());
  ipcMain.handle("update:scheduleForQuit", () => requireUpdateManager().scheduleForQuit());
  ipcMain.handle("update:startNow", () => requireUpdateManager().startNow());
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

  ipcMain.handle(
    "projects:create",
    (_event, input: { name: string; path: string; icon: string }) => {
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

    if (typeof resolvedUrl !== "string" || resolvedUrl.trim().length === 0) {
      throw new Error("Invalid URL.");
    }
    await shell.openExternal(resolvedUrl);
  });

  ipcMain.handle("launch:complete", async (_event, projectId: string) => {
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
    const deps = await checkAllDependencies();
    const activePath = getActivePath();
    const backupPath = getBackupPath();
    const activeDependenciesPath = getActiveDependenciesPath();
    const workspacesInitialized =
      fs.existsSync(activePath) &&
      fs.existsSync(backupPath) &&
      fs.existsSync(join(activeDependenciesPath, "node_modules"));
    return !!(deps.gitInstalled && deps.nodeMatch && deps.bunMatch && workspacesInitialized);
  });

  ipcMain.handle("launch:getUser", () => {
    const user = getMostRecentAuthUser();
    if (user) return user;
    return { name: "Developer", email: "developer@local" };
  });

  ipcMain.handle("projects:setActive", async (_event, projectId: string) => {
    if (isUpdateBusy()) throw new Error("Project switching is disabled during an update.");
    setActiveProjectId(projectId);
    try {
      await requireAgentManager().activateProject(projectId);
    } catch (err) {
      console.error(`[Main] Failed to activate project ${projectId} in agent manager:`, err);
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
    companionWindow?.close();
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
    (_event, projectId: string, title: string, afterThreadId?: string | null) => {
      return requireAgentManager().createThread(projectId, title, afterThreadId ?? null);
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

  ipcMain.handle("messages:list", (_event, threadId: string) => {
    return getMessages(threadId);
  });

  ipcMain.handle(
    "messages:create",
    (_event, input: { thread_id: string; role: string; content: string }) => {
      return createMessage(input);
    },
  );

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
  ipcMain.handle("agent:getCommands", () => {
    console.log("[IPC] agent:getCommands called");
    return requireAgentManager().getCommands();
  });
  ipcMain.handle("agent:getModels", () => {
    console.log("[IPC] agent:getModels called");
    return requireAgentManager().getModels();
  });
  ipcMain.handle("agent:getStats", () => {
    console.log("[IPC] agent:getStats called");
    return requireAgentManager().getStats();
  });
  ipcMain.handle("agent:sendPrompt", (_event, input) => {
    console.log("[IPC] agent:sendPrompt called with:", JSON.stringify(input));
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
  ipcMain.handle("agent:abort", () => {
    console.log("[IPC] agent:abort called");
    return requireAgentManager().abort();
  });
  ipcMain.handle("agent:switchThread", async (_event, threadId: string) => {
    console.log("[IPC] agent:switchThread called with threadId:", threadId);
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
    (_event, projectId: string, title: string, afterThreadId?: string | null) => {
      console.log("[IPC] agent:createThread called with:", {
        projectId,
        title,
        afterThreadId,
      });
      try {
        return requireAgentManager().createThread(projectId, title, afterThreadId ?? null);
      } catch (e: any) {
        console.error("[IPC] agent:createThread error:", e);
        throw e;
      }
    },
  );
  ipcMain.handle("agent:cycleModel", (_event, direction?: "forward" | "backward") => {
    console.log("[IPC] agent:cycleModel called, direction:", direction);
    return requireAgentManager().cycleModel(direction);
  });
  ipcMain.handle("agent:setModel", (_event, model: { provider: string; modelId: string }) => {
    console.log("[IPC] agent:setModel called with model:", model);
    return requireAgentManager().setModel(model);
  });
  ipcMain.handle("agent:setThinkingLevel", (_event, level: any) => {
    console.log("[IPC] agent:setThinkingLevel called with level:", level);
    return requireAgentManager().setThinkingLevel(level);
  });
  ipcMain.handle("agent:cycleThinkingLevel", () => {
    console.log("[IPC] agent:cycleThinkingLevel called");
    return requireAgentManager().cycleThinkingLevel();
  });
  ipcMain.handle("agent:compact", (_event, customInstructions?: string) => {
    console.log("[IPC] agent:compact called with customInstructions:", customInstructions);
    return requireAgentManager().compact(customInstructions);
  });
  ipcMain.handle("agent:respondToUiRequest", (_event, response) => {
    console.log("[IPC] agent:respondToUiRequest called with response:", response);
    return requireAgentManager().respondToUiRequest(response);
  });
  ipcMain.handle("agent:setEditorText", (_event, text: string) => {
    console.log("[IPC] agent:setEditorText called");
    return requireAgentManager().setEditorText(text);
  });
  ipcMain.handle("agent:getEditorText", () => {
    console.log("[IPC] agent:getEditorText called");
    return requireAgentManager().getEditorText();
  });
  ipcMain.handle("agent:pasteToEditor", (_event, text: string) => {
    console.log("[IPC] agent:pasteToEditor called");
    return requireAgentManager().pasteToEditor(text);
  });
  ipcMain.on("agent:reportEditorText", (_event, text: string) => {
    console.log("[IPC] agent:reportEditorText received");
    requireAgentManager().reportEditorText(text);
  });

  ipcMain.handle("terminal:create", (_event, sessionId: string, cwd?: string) => {
    if (isUpdateBusy()) throw new Error("New terminal sessions are disabled during an update.");
    if (ptyProcesses.has(sessionId)) {
      console.log(`[Main] PTY session ${sessionId} is already active. Reusing it.`);
      return;
    }

    const defaultShell =
      process.env["SHELL"] || (process.platform === "win32" ? "powershell.exe" : "bash");
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

  ipcMain.on("theme:changed", (_event, theme: string) => {
    broadcastToWindows("theme:changed", theme);
  });

  // ─── Editor IPC ─────────────────────────────────────────────────────────────
  ipcMain.handle("editor:activate", () => {
    if (isUpdateBusy()) throw new Error("Edit Mode is disabled during an update.");
    return requireAgentManager().activateEditor();
  });
  ipcMain.handle("editor:getState", () => requireAgentManager().getEditorState());
  ipcMain.handle("editor:sendPrompt", (_event, input: { message: string }) =>
    requireAgentManager().sendEditorPrompt(input),
  );
  ipcMain.handle("editor:dispose", () => requireAgentManager().disposeEditor());

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
  ipcMain.handle("pipper:enterEditMode", () => {
    if (isUpdateBusy()) throw new Error("Edit Mode is disabled during an update.");
    broadcastToWindows("pipper:stateChanged", { editMode: true });
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
      const gitOk = await checkGit();
      if (!gitOk) {
        sendProgress("Git is required. Please install Git.", "failed", undefined, false);
        return;
      }

      sendProgress("Checking Node and Bun versions...", "running", undefined, true);
      const nodeOk = await checkNode();
      const bunOk = await checkBun();

      if (!nodeOk || !bunOk) {
        sendProgress("Installing Mise version manager...", "running", undefined, true);
        await installMise();

        sendProgress("Setting up Node and Bun versions locally...", "running", undefined, true);
        await installNodeAndBunWithMise();
      }

      sendProgress(
        "Initializing workspaces inside ~/Library/pipper...",
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
      const { stdout } = await promisify(exec)("git status --porcelain", { cwd: activePath });
      const filesChanged = stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => line.slice(3).split(" -> ").at(-1) ?? "")
        .filter((file) => file !== "patch.md");
      if (filesChanged.length === 0) return;
      const patchPath = join(activePath, "patch.md");
      const existing = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, "utf8") : "";
      const entry = {
        change_id: randomUUID(),
        files_changed: filesChanged,
        intent: intent?.trim() || "Accepted visual customization",
      };
      fs.writeFileSync(patchPath, `${JSON.stringify(entry, null, 2)}\n\n${existing}`);
      await promisify(exec)("git add -A && git commit -m 'Pipper Visual Edit Accept'", {
        cwd: activePath,
      });
      const { stdout: headOutput } = await promisify(exec)("git rev-parse HEAD", {
        cwd: activePath,
      });
      const installationPath = getInstallationMetadataPath();
      const installation = JSON.parse(fs.readFileSync(installationPath, "utf8"));
      installation.customized_head_commit = headOutput.trim();
      installation.last_healthy_at = new Date().toISOString();
      fs.writeFileSync(installationPath, `${JSON.stringify(installation, null, 2)}\n`);
      await backupActiveWorkspace();
      if (projectId) {
        captureAnalytics("mutation_accepted", {
          windowType: "companion",
          properties: {
            project_id: projectId,
            source: "companion",
          },
        });
      }
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
      await restoreFromBackup();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reload();
      }
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
  const authUser = getMostRecentAuthUser();
  if (authUser) {
    identifyAnalyticsUser(authUser.provider_user_id);
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
      null,
    repositoryUrl:
      process.env.PIPPER_UPSTREAM_REPOSITORY_URL ??
      import.meta.env.VITE_PIPPER_UPSTREAM_REPOSITORY_URL ??
      null,
    agent: agentManager,
    broadcastState: (state) => broadcastToWindows("update:stateChanged", state),
    broadcastProgress: (progress) => broadcastToWindows("update:progress", progress),
    prepareForUpdate: prepareProcessesForUpdate,
    restartPromotedApp: restartAfterPromotion,
  });
  registerIpc();

  if (isDev) {
    startDevFileWatcher();
  }

  // Check dependencies and workspace status on startup
  const deps = await checkAllDependencies();
  const activePath = getActivePath();
  const backupPath = getBackupPath();
  const activeDependenciesPath = getActiveDependenciesPath();
  const workspacesInitialized =
    fs.existsSync(activePath) &&
    fs.existsSync(backupPath) &&
    fs.existsSync(join(activeDependenciesPath, "node_modules"));

  if (!deps.gitInstalled || !deps.nodeMatch || !deps.bunMatch || !workspacesInitialized) {
    console.log("[Main] Launching launcher while workspace setup runs in background.");
    createLaunchWindow("list");
    void (async () => {
      try {
        if (!deps.gitInstalled || !deps.nodeMatch || !deps.bunMatch) {
          console.log("[Main] Running dependency setup in background...");
          await initializeWorkspaces(app.getAppPath(), isDev);
        } else if (!workspacesInitialized) {
          console.log("[Main] Initializing workspaces in background...");
          await initializeWorkspaces(app.getAppPath(), isDev);
        }
        broadcastToWindows("launch:workspaceReady", {});
        await initializeUpdateSubsystem();
      } catch (error) {
        console.error("[Main] Background workspace initialization failed:", error);
        broadcastToWindows("launch:workspaceError", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  } else {
    // Keep the shared dependency cache aligned with the packaged template. The
    // workspace can be "ready" while still missing dependencies added by an app update.
    await initializeWorkspaces(app.getAppPath(), isDev);
    await initializeUpdateSubsystem();
    const state = await readLaunchState();
    if (state.completed) {
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
      const activeDeps = await checkAllDependencies();
      const activeInit =
        fs.existsSync(activePath) &&
        fs.existsSync(backupPath) &&
        fs.existsSync(join(activeDependenciesPath, "node_modules"));

      if (
        !activeDeps.gitInstalled ||
        !activeDeps.nodeMatch ||
        !activeDeps.bunMatch ||
        !activeInit
      ) {
        createLaunchWindow("list");
        void initializeWorkspaces(app.getAppPath(), isDev)
          .then(async () => {
            broadcastToWindows("launch:workspaceReady", {});
            await initializeUpdateSubsystem();
          })
          .catch((error) => {
            console.error("[Main] Background workspace initialization failed:", error);
            broadcastToWindows("launch:workspaceError", {
              message: error instanceof Error ? error.message : String(error),
            });
          });
        return;
      }

      void readLaunchState().then((s) => {
        if (s.completed) {
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
  if ((!mainWindow || mainWindow.isDestroyed()) && (!launchWindow || launchWindow.isDestroyed())) {
    createLaunchWindow("list");
  }
  void (async () => {
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
