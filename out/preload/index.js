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
	dialog: { pickDirectory: () => ipcRenderer.invoke("dialog:pickDirectory") }
});
//#endregion
export {};
