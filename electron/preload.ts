import { contextBridge, ipcRenderer } from "electron";
import type { Project } from "../contracts/projects.ts";
import type { Thread, ThreadPage } from "../contracts/threads.ts";
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

export type ThinkingLevel = "low" | "medium" | "high";

const api = {
  launch: {
    complete: (projectId: string): Promise<void> =>
      ipcRenderer.invoke("launch:complete", projectId),
    show: (stage?: "list" | "add" | "onboarding"): Promise<void> =>
      ipcRenderer.invoke("launch:show", stage),
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
  onboarding: {
    verifyGit: (): Promise<boolean> => ipcRenderer.invoke("onboarding:verifyGit"),
    startSetup: (): Promise<void> => ipcRenderer.invoke("onboarding:startSetup"),
    onProgress: (callback: (payload: any) => void) => {
      const listener = (_event: any, payload: any) => callback(payload);
      ipcRenderer.on("onboarding:progress", listener);
      return () => {
        ipcRenderer.removeListener("onboarding:progress", listener);
      };
    },
  },
  threads: {
    list: (): Promise<Thread[]> => ipcRenderer.invoke("threads:list"),
    listProject: (input: {
      projectId: string;
      limit?: number;
      offset?: number;
    }): Promise<ThreadPage> => ipcRenderer.invoke("threads:listProject", input),
    create: (projectId: string, title: string, afterThreadId?: string | null): Promise<Thread> =>
      ipcRenderer.invoke("threads:create", projectId, title, afterThreadId),
    rename: (id: string, title: string): Promise<Thread> =>
      ipcRenderer.invoke("threads:rename", id, title),
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
    createThread: (
      projectId: string,
      title: string,
      afterThreadId?: string | null,
    ): Promise<Thread> => ipcRenderer.invoke("agent:createThread", projectId, title, afterThreadId),
    cycleModel: (direction?: "forward" | "backward"): Promise<AgentModelSummary | null> =>
      ipcRenderer.invoke("agent:cycleModel", direction),
    setModel: (model: { provider: string; modelId: string }): Promise<boolean> =>
      ipcRenderer.invoke("agent:setModel", model),
    setThinkingLevel: (level: ThinkingLevel): Promise<void> =>
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
    reportEditorText: (text: string): void => {
      ipcRenderer.send("agent:reportEditorText", text);
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
  companion: {
    open: (): Promise<void> => ipcRenderer.invoke("companion:open"),
    minimize: (): void => ipcRenderer.send("companion:minimize"),
    close: (): void => ipcRenderer.send("companion:close"),
  },
  editor: {
    activate: (): Promise<void> => ipcRenderer.invoke("editor:activate"),
    getState: (): Promise<import("../contracts/agent.ts").AgentRuntimeSnapshot> =>
      ipcRenderer.invoke("editor:getState"),
    sendPrompt: (input: { message: string }): Promise<void> =>
      ipcRenderer.invoke("editor:sendPrompt", input),
    dispose: (): Promise<void> => ipcRenderer.invoke("editor:dispose"),
    onEvent: (callback: (payload: import("../contracts/agent.ts").AgentBridgeEvent) => void) => {
      const listener = (_event: any, payload: import("../contracts/agent.ts").AgentBridgeEvent) =>
        callback(payload);
      ipcRenderer.on("editor:event", listener);
      return () => ipcRenderer.removeListener("editor:event", listener);
    },
  },
  pipper: {
    enterEditMode: (): Promise<void> => ipcRenderer.invoke("pipper:enterEditMode"),
    exitEditMode: (): Promise<void> => ipcRenderer.invoke("pipper:exitEditMode"),
    setProcessing: (processingId: string | null): Promise<void> =>
      ipcRenderer.invoke("pipper:setProcessing", processingId),
    addComment: (pipperId: string, text: string): Promise<void> =>
      ipcRenderer.invoke("pipper:addComment", pipperId, text),
    acceptChanges: (): Promise<void> => ipcRenderer.invoke("pipper:acceptChanges"),
    rejectChanges: (): Promise<void> => ipcRenderer.invoke("pipper:rejectChanges"),
    onStateChanged: (
      callback: (payload: { processingId?: string | null; editMode?: boolean }) => void,
    ) => {
      const listener = (
        _event: any,
        payload: { processingId?: string | null; editMode?: boolean },
      ) => callback(payload);
      ipcRenderer.on("pipper:stateChanged", listener);
      return () => ipcRenderer.removeListener("pipper:stateChanged", listener);
    },
    onCommentAdded: (callback: (pipperId: string, text: string) => void) => {
      const listener = (_event: any, payload: { pipperId: string; text: string }) =>
        callback(payload.pipperId, payload.text);
      ipcRenderer.on("pipper:commentAdded", listener);
      return () => ipcRenderer.removeListener("pipper:commentAdded", listener);
    },
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
