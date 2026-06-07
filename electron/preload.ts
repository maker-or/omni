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
};

contextBridge.exposeInMainWorld("omni", api);

export type OmniApi = typeof api;
