import { contextBridge, ipcRenderer } from "electron";
//#region electron/preload.ts
contextBridge.exposeInMainWorld("omni", {
	launch: {
		complete: (projectId) => ipcRenderer.invoke("launch:complete", projectId),
		show: (stage) => ipcRenderer.invoke("launch:show", stage)
	},
	projects: {
		list: () => ipcRenderer.invoke("projects:list"),
		create: (input) => ipcRenderer.invoke("projects:create", input),
		getActive: () => ipcRenderer.invoke("projects:getActive"),
		setActive: (projectId) => ipcRenderer.invoke("projects:setActive", projectId)
	},
	threads: {
		list: () => ipcRenderer.invoke("threads:list"),
		create: (projectId, title) => ipcRenderer.invoke("threads:create", projectId, title),
		delete: (id) => ipcRenderer.invoke("threads:delete", id)
	},
	messages: {
		list: (threadId) => ipcRenderer.invoke("messages:list", threadId),
		create: (input) => ipcRenderer.invoke("messages:create", input)
	},
	dialog: { pickDirectory: () => ipcRenderer.invoke("dialog:pickDirectory") },
	terminal: {
		create: (sessionId, cwd) => ipcRenderer.invoke("terminal:create", sessionId, cwd),
		write: (sessionId, data) => ipcRenderer.send("terminal:write", {
			sessionId,
			data
		}),
		resize: (sessionId, cols, rows) => ipcRenderer.send("terminal:resize", {
			sessionId,
			cols,
			rows
		}),
		kill: (sessionId) => ipcRenderer.invoke("terminal:kill", sessionId),
		onData: (callback) => {
			const listener = (_event, payload) => callback(payload);
			ipcRenderer.on("terminal:data", listener);
			return () => {
				ipcRenderer.removeListener("terminal:data", listener);
			};
		},
		onExit: (callback) => {
			const listener = (_event, payload) => callback(payload);
			ipcRenderer.on("terminal:exit", listener);
			return () => {
				ipcRenderer.removeListener("terminal:exit", listener);
			};
		}
	}
});
//#endregion
export {};
