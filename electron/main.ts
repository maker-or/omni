import { app, BrowserWindow, Menu, shell, ipcMain, dialog } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import * as pty from "node-pty";
import { markLaunchComplete, readLaunchState } from "./launch-state";
import { createProject, getProject, listProjects } from "./projects";
import { getActiveProjectId, setActiveProjectId } from "./session";
import { getDb } from "./db";
import { listThreads, createThread, deleteThread, getMessages, createMessage } from "./threads";

const mainDir = dirname(fileURLToPath(import.meta.url));

const ptyProcesses = new Map<string, pty.IPty>();

const isDev = !app.isPackaged;

function generateRandomId(): string {
  const hex = randomBytes(4).toString("hex");
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

let mainWindow: BrowserWindow | null = null;
let launchWindow: BrowserWindow | null = null;

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

function createMainWindow(): void {
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
    if (isDev) {
      mainWindow?.webContents.openDevTools();
    }
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

  void loadInto(mainWindow, "main");
}

function createLaunchWindow(stage: "list" | "add" = "list"): void {
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

  ipcMain.handle("launch:show", (_event, stage?: "list" | "add") => {
    console.log("[Main] IPC launch:show - received stage:", stage);
    createLaunchWindow(stage);
  });

  ipcMain.handle("projects:setActive", (_event, projectId: string) => {
    setActiveProjectId(projectId);
  });

  ipcMain.handle("threads:list", () => {
    return listThreads();
  });

  ipcMain.handle("threads:create", (_event, projectId: string, title: string) => {
    return createThread(projectId, title);
  });

  ipcMain.handle("threads:delete", (_event, id: string) => {
    return deleteThread(id);
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

  ipcMain.handle("terminal:create", (_event, sessionId: string, cwd?: string) => {
    if (ptyProcesses.has(sessionId)) {
      try {
        ptyProcesses.get(sessionId)?.kill();
      } catch (e) {}
      ptyProcesses.delete(sessionId);
    }

    const defaultShell = process.env["SHELL"] || (process.platform === "win32" ? "powershell.exe" : "bash");
    const shellArgs: string[] = [];
    if (process.platform !== "win32" && (defaultShell.endsWith("zsh") || defaultShell.endsWith("bash") || defaultShell.endsWith("sh"))) {
      shellArgs.push("-l");
    }
    
    let spawnCwd = cwd || os.homedir();
    if (spawnCwd && !fs.existsSync(spawnCwd)) {
      console.warn(`[Main] CWD directory does not exist: ${spawnCwd}. Falling back to home directory.`);
      spawnCwd = os.homedir();
    }

    let ptyProcess: pty.IPty;
    try {
      console.log(`[Main] Spawning PTY session ${sessionId} - Shell: ${defaultShell}, Args: ${JSON.stringify(shellArgs)}, CWD: ${spawnCwd}`);
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
        mainWindow.webContents.send("terminal:exit", { sessionId, exitCode, signal });
      }
      ptyProcesses.delete(sessionId);
    });
  });

  ipcMain.on("terminal:write", (_event, { sessionId, data }: { sessionId: string; data: string }) => {
    const ptyProcess = ptyProcesses.get(sessionId);
    if (ptyProcess) {
      ptyProcess.write(data);
    }
  });

  ipcMain.on("terminal:resize", (_event, { sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
    const ptyProcess = ptyProcesses.get(sessionId);
    if (ptyProcess) {
      try {
        ptyProcess.resize(cols, rows);
      } catch (e) {
        console.error(`Error resizing PTY ${sessionId}:`, e);
      }
    }
  });

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
}

app.whenReady().then(async () => {
  buildAppMenu();
  getDb();
  registerIpc();

  const state = await readLaunchState();
  if (state.completed) {
    if (state.projectId) {
      setActiveProjectId(state.projectId);
    }
    createMainWindow();
  } else {
    createLaunchWindow();
  }

  app.on("activate", () => {
    const hasMain = mainWindow && !mainWindow.isDestroyed();
    const hasLaunch = launchWindow && !launchWindow.isDestroyed();
    if (!hasMain && !hasLaunch) {
      void readLaunchState().then((s) => {
        if (s.completed) {
          if (s.projectId) {
            setActiveProjectId(s.projectId);
          }
          createMainWindow();
        } else {
          createLaunchWindow();
        }
      });
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  for (const [id, ptyProc] of ptyProcesses.entries()) {
    try {
      ptyProc.kill();
    } catch (e) {
      console.error(`Failed to kill PTY process ${id}`, e);
    }
  }
  ptyProcesses.clear();
});
