import { contextBridge, ipcRenderer } from "electron";
import type { Project } from "../contracts/projects.ts";
import type { Thread } from "../contracts/threads.ts";
import type { Message } from "../contracts/messages.ts";

export interface CreateProjectInput {
  name: string;
  path: string;
  icon: string;
}

const api = {
  launch: {
    complete: (projectId: string): Promise<void> =>
      ipcRenderer.invoke("launch:complete", projectId),
    show: (stage?: "list" | "add"): Promise<void> => ipcRenderer.invoke("launch:show", stage),
  },
  projects: {
    list: (): Promise<Project[]> => ipcRenderer.invoke("projects:list"),
    create: (input: CreateProjectInput): Promise<Project> =>
      ipcRenderer.invoke("projects:create", input),
    getActive: (): Promise<Project | null> => ipcRenderer.invoke("projects:getActive"),
    setActive: (projectId: string): Promise<void> =>
      ipcRenderer.invoke("projects:setActive", projectId),
  },
  threads: {
    list: (): Promise<Thread[]> => ipcRenderer.invoke("threads:list"),
    create: (projectId: string, title: string): Promise<Thread> =>
      ipcRenderer.invoke("threads:create", projectId, title),
    delete: (id: string): Promise<void> => ipcRenderer.invoke("threads:delete", id),
  },
  messages: {
    list: (threadId: string): Promise<Message[]> => ipcRenderer.invoke("messages:list", threadId),
    create: (input: { thread_id: string; role: string; content: string }): Promise<Message> =>
      ipcRenderer.invoke("messages:create", input),
  },
  dialog: {
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke("dialog:pickDirectory"),
  },
  terminal: {
    create: (sessionId: string, cwd?: string): Promise<void> =>
      ipcRenderer.invoke("terminal:create", sessionId, cwd),
    write: (sessionId: string, data: string): void =>
      ipcRenderer.send("terminal:write", { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number): void =>
      ipcRenderer.send("terminal:resize", { sessionId, cols, rows }),
    kill: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke("terminal:kill", sessionId),
    onData: (callback: (payload: { sessionId: string; data: string }) => void) => {
      const listener = (_event: any, payload: { sessionId: string; data: string }) =>
        callback(payload);
      ipcRenderer.on("terminal:data", listener);
      return () => {
        ipcRenderer.removeListener("terminal:data", listener);
      };
    },
    onExit: (callback: (payload: { sessionId: string; exitCode: number; signal?: number }) => void) => {
      const listener = (_event: any, payload: { sessionId: string; exitCode: number; signal?: number }) =>
        callback(payload);
      ipcRenderer.on("terminal:exit", listener);
      return () => {
        ipcRenderer.removeListener("terminal:exit", listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld("omni", api);

export type OmniApi = typeof api;

