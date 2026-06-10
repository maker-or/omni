import { contextBridge, ipcRenderer } from "electron";
import type { Project } from "../contracts/projects.ts";
import type { Thread } from "../contracts/threads.ts";
import type { Message } from "../contracts/messages.ts";
import type {
  AgentBridgeEvent,
  AgentModelSummary,
  AgentPromptInput,
  AgentRuntimeSnapshot,
  AgentUiResponse,
} from "../contracts/agent.ts";
import type { SessionStats, SlashCommandInfo } from "@earendil-works/pi-coding-agent";

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
    onActiveChanged: (callback: (projectId: string) => void) => {
      const listener = (_event: any, projectId: string) => callback(projectId);
      ipcRenderer.on("projects:activeChanged", listener);
      return () => {
        ipcRenderer.removeListener("projects:activeChanged", listener);
      };
    },
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
  agent: {
    getState: (): Promise<AgentRuntimeSnapshot> => ipcRenderer.invoke("agent:getState"),
    getCommands: (): Promise<SlashCommandInfo[]> => ipcRenderer.invoke("agent:getCommands"),
    getModels: (): Promise<AgentModelSummary[]> => ipcRenderer.invoke("agent:getModels"),
    getStats: (): Promise<SessionStats | null> => ipcRenderer.invoke("agent:getStats"),
    sendPrompt: (input: AgentPromptInput): Promise<void> =>
      ipcRenderer.invoke("agent:sendPrompt", input),
    abort: (): Promise<void> => ipcRenderer.invoke("agent:abort"),
    switchThread: (threadId: string): Promise<void> =>
      ipcRenderer.invoke("agent:switchThread", threadId),
    createThread: (projectId: string, title: string): Promise<Thread> =>
      ipcRenderer.invoke("agent:createThread", projectId, title),
    cycleModel: (direction?: "forward" | "backward"): Promise<AgentModelSummary | null> =>
      ipcRenderer.invoke("agent:cycleModel", direction),
    setModel: (model: { provider: string; modelId: string }): Promise<boolean> =>
      ipcRenderer.invoke("agent:setModel", model),
    setThinkingLevel: (level: any): Promise<void> =>
      ipcRenderer.invoke("agent:setThinkingLevel", level),
    cycleThinkingLevel: (): Promise<string | null> =>
      ipcRenderer.invoke("agent:cycleThinkingLevel"),
    compact: (customInstructions?: string): Promise<void> =>
      ipcRenderer.invoke("agent:compact", customInstructions),
    respondToUiRequest: (response: AgentUiResponse): Promise<void> =>
      ipcRenderer.invoke("agent:respondToUiRequest", response),
    setEditorText: (text: string): Promise<void> => ipcRenderer.invoke("agent:setEditorText", text),
    getEditorText: (): Promise<string> => ipcRenderer.invoke("agent:getEditorText"),
    pasteToEditor: (text: string): Promise<void> => ipcRenderer.invoke("agent:pasteToEditor", text),
    reportEditorText: (text: string): Promise<void> => {
      ipcRenderer.send("agent:reportEditorText", text);
      return Promise.resolve();
    },
    onEvent: (callback: (payload: AgentBridgeEvent) => void) => {
      const listener = (_event: any, payload: AgentBridgeEvent) => callback(payload);
      ipcRenderer.on("agent:event", listener);
      return () => {
        ipcRenderer.removeListener("agent:event", listener);
      };
    },
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
    kill: (sessionId: string): Promise<void> => ipcRenderer.invoke("terminal:kill", sessionId),
    onData: (callback: (payload: { sessionId: string; data: string }) => void) => {
      const listener = (_event: any, payload: { sessionId: string; data: string }) =>
        callback(payload);
      ipcRenderer.on("terminal:data", listener);
      return () => {
        ipcRenderer.removeListener("terminal:data", listener);
      };
    },
    onExit: (
      callback: (payload: { sessionId: string; exitCode: number; signal?: number }) => void,
    ) => {
      const listener = (
        _event: any,
        payload: { sessionId: string; exitCode: number; signal?: number },
      ) => callback(payload);
      ipcRenderer.on("terminal:exit", listener);
      return () => {
        ipcRenderer.removeListener("terminal:exit", listener);
      };
    },
  },
  flyout: {
    open: (): Promise<void> => ipcRenderer.invoke("flyout:open"),
  },
  theme: {
    changed: (theme: string): void => ipcRenderer.send("theme:changed", theme),
    onChanged: (callback: (theme: string) => void) => {
      const listener = (_event: any, theme: string) => callback(theme);
      ipcRenderer.on("theme:changed", listener);
      return () => {
        ipcRenderer.removeListener("theme:changed", listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld("omni", api);

export type OmniApi = typeof api;
