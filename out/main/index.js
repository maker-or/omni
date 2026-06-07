import { BrowserWindow, Menu, app, dialog, ipcMain, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
//#region electron/launch-state.ts
var FILE_NAME = "launch-state.json";
var DEFAULT_STATE = {
	completed: false,
	completedAt: null,
	projectId: null
};
function statePath() {
	return join(app.getPath("userData"), FILE_NAME);
}
async function readLaunchState() {
	try {
		const raw = await readFile(statePath(), "utf-8");
		const parsed = JSON.parse(raw);
		return {
			completed: parsed.completed === true,
			completedAt: typeof parsed.completedAt === "string" ? parsed.completedAt : null,
			projectId: typeof parsed.projectId === "string" ? parsed.projectId : null
		};
	} catch {
		return { ...DEFAULT_STATE };
	}
}
async function writeLaunchState(state) {
	const file = statePath();
	await mkdir(join(file, ".."), { recursive: true });
	await writeFile(file, JSON.stringify(state, null, 2), "utf-8");
}
async function markLaunchComplete(projectId) {
	await writeLaunchState({
		completed: true,
		completedAt: (/* @__PURE__ */ new Date()).toISOString(),
		projectId
	});
}
//#endregion
//#region electron/db.ts
var db = null;
function getDb() {
	if (db) return db;
	db = new DatabaseSync(join(app.getPath("userData"), "omni.sqlite"));
	db.exec("PRAGMA foreign_keys = ON;");
	db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          icon TEXT
        );
      `);
	db.exec(`
        CREATE TABLE IF NOT EXISTS threads (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES
  projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_threads_project_id
  ON threads(project_id);
      `);
	db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (thread_id) REFERENCES threads(id)
  ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_messages_thread_id
  ON messages(thread_id);
        CREATE INDEX IF NOT EXISTS
  idx_messages_thread_created ON messages(thread_id,
  created_at);
      `);
	return db;
}
//#endregion
//#region electron/projects.ts
function listProjects() {
	return getDb().prepare("SELECT * FROM projects ORDER BY name ASC").all();
}
function getProject(id) {
	return getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) || null;
}
function createProject(input) {
	const db = getDb();
	const row = {
		id: randomUUID(),
		name: input.name.trim(),
		path: input.path,
		icon: input.icon
	};
	try {
		db.prepare("INSERT INTO projects (id, name, path, icon) VALUES (?, ?, ?, ?)").run(row.id, row.name, row.path, row.icon);
	} catch (err) {
		if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) throw new Error("A project already exists at this path.");
		throw err;
	}
	return row;
}
//#endregion
//#region electron/session.ts
var activeProjectId = null;
function setActiveProjectId(id) {
	activeProjectId = id;
}
function getActiveProjectId() {
	return activeProjectId;
}
//#endregion
//#region electron/threads.ts
function listThreads() {
	return getDb().prepare("SELECT * FROM threads").all();
}
function createThread(projectId, title) {
	const db = getDb();
	const row = {
		id: randomUUID(),
		project_id: projectId,
		title: title.trim()
	};
	db.prepare("INSERT INTO threads (id, project_id, title) VALUES (?, ?, ?)").run(row.id, row.project_id, row.title);
	return row;
}
function deleteThread(id) {
	getDb().prepare("DELETE FROM threads WHERE id = ?").run(id);
}
function getMessages(threadId) {
	return getDb().prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC").all();
}
function createMessage(input) {
	const db = getDb();
	const row = {
		id: randomUUID(),
		thread_id: input.thread_id,
		role: input.role,
		content: input.content,
		created_at: Date.now()
	};
	db.prepare("INSERT INTO messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)").run(row.id, row.thread_id, row.role, row.content, row.created_at);
	return row;
}
//#endregion
//#region electron/main.ts
var mainDir = dirname(fileURLToPath(import.meta.url));
var isDev = !app.isPackaged;
function generateRandomId() {
	const hex = randomBytes(4).toString("hex");
	return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}
var mainWindow = null;
var launchWindow = null;
function resolveRendererUrl(page, stage) {
	const base = process.env["ELECTRON_RENDERER_URL"];
	if (!base) return "";
	let url = page === "launch" ? `${base}/launch.html` : base;
	if (stage) url += `?stage=${stage}`;
	return url;
}
function resolveRendererFile(page) {
	return join(mainDir, "../renderer", page === "launch" ? "launch.html" : "index.html");
}
function loadInto(win, page, stage) {
	if (isDev) return win.loadURL(resolveRendererUrl(page, stage));
	const file = resolveRendererFile(page);
	const fileUrl = stage ? `file://${file}?stage=${stage}` : `file://${file}`;
	return win.loadURL(fileUrl);
}
function createMainWindow() {
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
			nodeIntegration: false
		}
	});
	mainWindow.on("ready-to-show", () => mainWindow?.show());
	mainWindow.on("closed", () => {
		mainWindow = null;
	});
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		shell.openExternal(url);
		return { action: "deny" };
	});
	loadInto(mainWindow, "main");
}
function createLaunchWindow(stage = "list") {
	if (launchWindow && !launchWindow.isDestroyed()) {
		loadInto(launchWindow, "launch", stage);
		launchWindow.show();
		launchWindow.focus();
		return;
	}
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
			nodeIntegration: false
		}
	});
	launchWindow.on("ready-to-show", () => launchWindow?.show());
	launchWindow.on("closed", () => {
		launchWindow = null;
	});
	loadInto(launchWindow, "launch", stage);
}
function buildAppMenu() {
	const isMac = process.platform === "darwin";
	const template = [
		...isMac ? [{ role: "appMenu" }] : [],
		{
			label: "File",
			submenu: [isMac ? { role: "close" } : { role: "quit" }]
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
				{ role: "selectAll" }
			]
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
					click: () => createLaunchWindow()
				}
			]
		},
		{
			role: "window",
			submenu: [{ role: "minimize" }, ...isMac ? [{ type: "separator" }, { role: "front" }] : [{ role: "close" }]]
		}
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function registerIpc() {
	ipcMain.handle("projects:list", () => listProjects());
	ipcMain.handle("projects:getActive", () => {
		const id = getActiveProjectId();
		return id ? getProject(id) : null;
	});
	ipcMain.handle("projects:create", (_event, input) => {
		return createProject(input);
	});
	ipcMain.handle("dialog:pickDirectory", async () => {
		const win = launchWindow ?? mainWindow ?? BrowserWindow.getFocusedWindow();
		const options = {
			properties: ["openDirectory", "createDirectory"],
			title: "Choose project folder",
			buttonLabel: "Select folder"
		};
		const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
		if (result.canceled || result.filePaths.length === 0) return null;
		return result.filePaths[0] ?? null;
	});
	ipcMain.handle("launch:complete", async (_event, projectId) => {
		if (!getProject(projectId)) throw new Error(`Project not found: ${projectId}`);
		setActiveProjectId(projectId);
		await markLaunchComplete(projectId);
		if (launchWindow && !launchWindow.isDestroyed()) launchWindow.close();
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.reload();
			mainWindow.show();
			mainWindow.focus();
		} else createMainWindow();
	});
	ipcMain.handle("launch:show", (_event, stage) => {
		createLaunchWindow(stage);
	});
	ipcMain.handle("projects:setActive", (_event, projectId) => {
		setActiveProjectId(projectId);
	});
	ipcMain.handle("threads:list", () => {
		return listThreads();
	});
	ipcMain.handle("threads:create", (_event, projectId, title) => {
		return createThread(projectId, title);
	});
	ipcMain.handle("threads:delete", (_event, id) => {
		return deleteThread(id);
	});
	ipcMain.handle("messages:list", (_event, threadId) => {
		return getMessages(threadId);
	});
	ipcMain.handle("messages:create", (_event, input) => {
		return createMessage(input);
	});
}
app.whenReady().then(async () => {
	buildAppMenu();
	getDb();
	registerIpc();
	const state = await readLaunchState();
	if (state.completed) {
		if (state.projectId) setActiveProjectId(state.projectId);
		createMainWindow();
	} else createLaunchWindow();
	app.on("activate", () => {
		const hasMain = mainWindow && !mainWindow.isDestroyed();
		const hasLaunch = launchWindow && !launchWindow.isDestroyed();
		if (!hasMain && !hasLaunch) readLaunchState().then((s) => {
			if (s.completed) {
				if (s.projectId) setActiveProjectId(s.projectId);
				createMainWindow();
			} else createLaunchWindow();
		});
	});
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
//#endregion
export {};
