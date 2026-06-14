import { app, BrowserWindow, Menu, shell, ipcMain, dialog } from "electron";
import { join, dirname } from "node:path";
import net from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import { spawn, exec } from "node:child_process";
import { promisify } from "node:util";
import * as pty from "node-pty";
import { markLaunchComplete, readLaunchState } from "./launch-state";
import { readCompanionState, writeCompanionState } from "./companion-state";
import { createProject, getProject, listProjects } from "./projects";
import { getActiveProjectId, setActiveProjectId } from "./session";
import { getDb } from "./db";
import { listThreads, listProjectThreads, getMessages, createMessage } from "./threads";
import { AgentManager } from "./agent";
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

// Initialize PATH prepend early for child process resolutions
prependStandardPaths();

import {
  initializeWorkspaces,
  backupActiveWorkspace,
  restoreFromBackup,
  getActivePath,
  getBackupPath,
  getSharedPath,
  startDevFileWatcher,
} from "./workspace-manager";

const mainDir = dirname(fileURLToPath(import.meta.url));

const ptyProcesses = new Map<string, pty.IPty>();

const isDev = !app.isPackaged;

function generateRandomId(): string {
  const hex = randomBytes(4).toString("hex");
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

let mainWindow: BrowserWindow | null = null;
let launchWindow: BrowserWindow | null = null;
let companionWindow: BrowserWindow | null = null;
let agentManager: AgentManager | null = null;

function requireAgentManager(): AgentManager {
  if (!agentManager) {
    throw new Error("Agent manager is not initialized.");
  }
  return agentManager;
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

function startViteServer(): Promise<string> {
  return new Promise((resolve) => {
    if (viteProcess) {
      resolve("http://localhost:1953");
      return;
    }

    const activePath = getActivePath();
    const cmd = getMisePath();
    console.log(`[Main] Spawning Vite Dev Server in ${activePath} using Mise on port 1953`);

    // Use bun run vite directly for faster startup
    viteProcess = spawn(
      cmd,
      ["exec", "--", "bun", "run", "vite", "--port", "1953", "--strictPort"],
      {
        cwd: activePath,
        env: { ...process.env, NODE_ENV: "development" },
      },
    );

    let resolved = false;

    viteProcess.stdout?.on("data", (data) => {
      const output = data.toString();
      console.log(`[Vite compiler stdout] ${output}`);
      if (output.includes("http://localhost:1953") && !resolved) {
        resolved = true;
        resolve("http://localhost:1953");
      }
    });

    viteProcess.stderr?.on("data", (data) => {
      console.error(`[Vite compiler stderr] ${data}`);
    });

    viteProcess.on("close", (code) => {
      console.log(`[Vite compiler] exited with code ${code}`);
      viteProcess = null;
    });

    // Polling loop to check if port 1953 is ready
    const pollInterval = 200;
    const maxTimeout = 10000;
    const startTime = Date.now();

    const checkInterval = setInterval(() => {
      if (resolved) {
        clearInterval(checkInterval);
        return;
      }

      const socket = net.connect({ port: 1953, host: "127.0.0.1" }, () => {
        socket.end();
        if (!resolved) {
          resolved = true;
          clearInterval(checkInterval);
          console.log("[Main] Vite server detected online via port polling.");
          resolve("http://localhost:1953");
        }
      });

      socket.on("error", () => {
        // Socket connection failed, port is not ready yet
      });

      socket.setTimeout(150);
      socket.on("timeout", () => {
        socket.destroy();
      });

      if (Date.now() - startTime > maxTimeout) {
        clearInterval(checkInterval);
        if (!resolved) {
          resolved = true;
          console.warn("[Main] Vite server port check timed out, resolving fallback url");
          resolve("http://localhost:1953");
        }
      }
    }, pollInterval);
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
    backgroundColor: "#fafafa",
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
    title: "Welcome to Pipper",
    show: false,
    backgroundColor: "#fafafa",
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
    backgroundColor: "#fafafa",
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
  ipcMain.handle("projects:list", () => listProjects());

  ipcMain.handle("projects:getActive", () => {
    const id = getActiveProjectId();
    return id ? getProject(id) : null;
  });

  ipcMain.handle(
    "projects:create",
    (_event, input: { name: string; path: string; icon: string }) => {
      return createProject(input);
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

  ipcMain.handle("projects:setActive", (_event, projectId: string) => {
    setActiveProjectId(projectId);
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

  ipcMain.handle("threads:delete", (_event, id: string) => {
    return requireAgentManager().deleteThread(id);
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
  ipcMain.handle("agent:abort", () => {
    console.log("[IPC] agent:abort called");
    return requireAgentManager().abort();
  });
  ipcMain.handle("agent:switchThread", (_event, threadId: string) => {
    console.log("[IPC] agent:switchThread called with threadId:", threadId);
    try {
      return requireAgentManager().switchThread(threadId);
    } catch (e: any) {
      console.error("[IPC] agent:switchThread error:", e);
      throw e;
    }
  });
  ipcMain.handle(
    "agent:createThread",
    (_event, projectId: string, title: string, afterThreadId?: string | null) => {
      console.log("[IPC] agent:createThread called with:", { projectId, title, afterThreadId });
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
    if (ptyProcesses.has(sessionId)) {
      try {
        ptyProcesses.get(sessionId)?.kill();
      } catch (e) {}
      ptyProcesses.delete(sessionId);
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
  ipcMain.handle("editor:activate", () => requireAgentManager().activateEditor());
  ipcMain.handle("editor:getState", () => requireAgentManager().getEditorState());
  ipcMain.handle("editor:sendPrompt", (_event, input: { message: string }) =>
    requireAgentManager().sendEditorPrompt(input),
  );
  ipcMain.handle("editor:dispose", () => requireAgentManager().disposeEditor());

  // ─── Pipper IPC ─────────────────────────────────────────────────────────────
  ipcMain.handle("pipper:setProcessing", (_event, processingId: string | null) => {
    broadcastToWindows("pipper:stateChanged", { processingId });
  });
  ipcMain.handle("pipper:enterEditMode", () => {
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
      event.sender.send("onboarding:progress", { step, status, error, gitInstalled });
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
  ipcMain.handle("pipper:acceptChanges", async () => {
    const activePath = getActivePath();
    const execPromise = promisify(exec);
    try {
      await execPromise('git add -u && git commit -m "Pipper Visual Edit Accept"', {
        cwd: activePath,
      });
    } catch (err) {
      console.warn("[Accept] git commit warning (probably no changes to commit):", err);
    }
    try {
      await backupActiveWorkspace();
    } catch (err: any) {
      console.error("[Accept] Failed to back up active workspace:", err.message || err);
      throw err;
    }
  });

  ipcMain.handle("pipper:rejectChanges", async () => {
    try {
      await restoreFromBackup();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reload();
      }
    } catch (err: any) {
      console.error("[Reject] Failed to restore workspace from backup:", err.message || err);
      throw err;
    }
  });
}

app.whenReady().then(async () => {
  buildAppMenu();
  getDb();
  agentManager = new AgentManager({
    sendToRenderer: sendToMainWindow,
    setWindowTitle: setMainWindowTitle,
    sendToFlyout: sendToCompanionWindow,
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
  registerIpc();

  if (isDev) {
    startDevFileWatcher();
  }

  // Check dependencies and workspace status on startup
  const deps = await checkAllDependencies();
  const activePath = getActivePath();
  const backupPath = getBackupPath();
  const sharedPath = getSharedPath();
  const workspacesInitialized =
    fs.existsSync(activePath) &&
    fs.existsSync(backupPath) &&
    fs.existsSync(join(sharedPath, "node_modules"));

  if (!deps.gitInstalled || !deps.nodeMatch || !deps.bunMatch || !workspacesInitialized) {
    console.log("[Main] Launching onboarding wizard: requirements not met.");
    createLaunchWindow("onboarding");
  } else {
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
        fs.existsSync(join(sharedPath, "node_modules"));

      if (
        !activeDeps.gitInstalled ||
        !activeDeps.nodeMatch ||
        !activeDeps.bunMatch ||
        !activeInit
      ) {
        createLaunchWindow("onboarding");
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  void agentManager?.dispose();
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
