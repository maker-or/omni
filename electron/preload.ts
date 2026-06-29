import { contextBridge, ipcRenderer } from "electron";
import type { Project } from "../contracts/projects.ts";
import type { OpenTabsState, Thread, ThreadPage } from "../contracts/threads.ts";
import type { Message } from "../contracts/messages.ts";
import type {
  AgentBridgeEvent,
  AgentModelSummary,
  AgentPromptInput,
  AgentReplacePromptInput,
  AgentRuntimeSnapshot,
  AgentUiResponse,
} from "../contracts/agent.ts";
import type { SessionStats, SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import type {
  InstallationMetadata,
  UpdateManifest,
  UpdateProgress,
  UpdateRunRecord,
  UpdateRunResult,
  UpdateState,
} from "../contracts/updates.ts";
import type {
  LauncherDownloadProgress,
  LauncherUpdateDiagnostics,
  LauncherUpdateState,
} from "../contracts/launcher-updates.ts";

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
    onWorkspaceReady: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("launch:workspaceReady", listener);
      return () => ipcRenderer.removeListener("launch:workspaceReady", listener);
    },
    onWorkspaceError: (callback: (message: string) => void) => {
      const listener = (_event: any, payload: { message: string }) => callback(payload.message);
      ipcRenderer.on("launch:workspaceError", listener);
      return () => ipcRenderer.removeListener("launch:workspaceError", listener);
    },
    onAuthComplete: (callback: (user: { name: string | null; email: string | null }) => void) => {
      const listener = (_event: any, user: { name: string | null; email: string | null }) =>
        callback(user);
      ipcRenderer.on("launch:authComplete", listener);
      return () => ipcRenderer.removeListener("launch:authComplete", listener);
    },
    isReady: (): Promise<boolean> => ipcRenderer.invoke("launch:isWorkspaceReady"),
    getUser: (): Promise<{ name: string | null; email: string | null } | null> =>
      ipcRenderer.invoke("launch:getUser"),
  },
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:openExternal", url),
  },
  update: {
    check: (): Promise<UpdateState> => ipcRenderer.invoke("update:check"),
    getState: (): Promise<UpdateState> => ipcRenderer.invoke("update:getState"),
    getManifest: (): Promise<UpdateManifest | null> => ipcRenderer.invoke("update:getManifest"),
    getInstallation: (): Promise<InstallationMetadata> =>
      ipcRenderer.invoke("update:getInstallation"),
    getRun: (runId: string): Promise<UpdateRunRecord | null> =>
      ipcRenderer.invoke("update:getRun", runId),
    getUpdaterSnapshot: (): Promise<AgentRuntimeSnapshot> =>
      ipcRenderer.invoke("update:getUpdaterSnapshot"),
    scheduleForQuit: (): Promise<UpdateState> => ipcRenderer.invoke("update:scheduleForQuit"),
    startNow: (): Promise<UpdateRunResult> => ipcRenderer.invoke("update:startNow"),
    retryFailedUpdate: (): Promise<UpdateState> => ipcRenderer.invoke("update:retryFailedUpdate"),
    dismiss: (): Promise<UpdateState> => ipcRenderer.invoke("update:dismiss"),
    cancel: (): Promise<UpdateRunResult> => ipcRenderer.invoke("update:cancel"),
    quitWithoutUpdating: (): Promise<void> => ipcRenderer.invoke("update:quitWithoutUpdating"),
    markActiveHealthy: (version: string): Promise<boolean> =>
      ipcRenderer.invoke("update:markActiveHealthy", version),
    onStateChanged: (callback: (state: UpdateState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state);
      ipcRenderer.on("update:stateChanged", listener);
      return () => ipcRenderer.removeListener("update:stateChanged", listener);
    },
    onProgress: (callback: (progress: UpdateProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: UpdateProgress) =>
        callback(progress);
      ipcRenderer.on("update:progress", listener);
      return () => ipcRenderer.removeListener("update:progress", listener);
    },
    onUpdaterEvent: (callback: (payload: AgentBridgeEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AgentBridgeEvent) =>
        callback(payload);
      ipcRenderer.on("updater:event", listener);
      return () => ipcRenderer.removeListener("updater:event", listener);
    },
  },
  launcherUpdate: {
    check: (): Promise<LauncherUpdateState> => ipcRenderer.invoke("launcher-update:check"),
    getState: (): Promise<LauncherUpdateState> => ipcRenderer.invoke("launcher-update:getState"),
    isDismissedForSession: (): Promise<boolean> =>
      ipcRenderer.invoke("launcher-update:isDismissedForSession"),
    download: (): Promise<LauncherUpdateState> => ipcRenderer.invoke("launcher-update:download"),
    cancelDownload: (): Promise<LauncherUpdateState> =>
      ipcRenderer.invoke("launcher-update:cancelDownload"),
    dismissForSession: (): Promise<LauncherUpdateState> =>
      ipcRenderer.invoke("launcher-update:dismissForSession"),
    installAndQuit: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("launcher-update:installAndQuit"),
    retryDownload: (): Promise<LauncherUpdateState> =>
      ipcRenderer.invoke("launcher-update:retryDownload"),
    openDownloadFolder: (): Promise<void> =>
      ipcRenderer.invoke("launcher-update:openDownloadFolder"),
    downloadInBrowser: (): Promise<void> => ipcRenderer.invoke("launcher-update:downloadInBrowser"),
    clearDownloadedUpdate: (): Promise<LauncherUpdateState> =>
      ipcRenderer.invoke("launcher-update:clearDownloadedUpdate"),
    getDiagnostics: (): Promise<LauncherUpdateDiagnostics> =>
      ipcRenderer.invoke("launcher-update:getDiagnostics"),
    copyDiagnostics: (): Promise<void> => ipcRenderer.invoke("launcher-update:copyDiagnostics"),
    onStateChanged: (callback: (state: LauncherUpdateState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: LauncherUpdateState) =>
        callback(state);
      ipcRenderer.on("launcher-update:stateChanged", listener);
      return () => ipcRenderer.removeListener("launcher-update:stateChanged", listener);
    },
    onProgress: (callback: (progress: LauncherDownloadProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: LauncherDownloadProgress) =>
        callback(progress);
      ipcRenderer.on("launcher-update:progress", listener);
      return () => ipcRenderer.removeListener("launcher-update:progress", listener);
    },
    onOpenDetails: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("launcher-update:openDetails", listener);
      return () => ipcRenderer.removeListener("launcher-update:openDetails", listener);
    },
    onDismissedForSession: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("launcher-update:dismissedForSession", listener);
      return () => ipcRenderer.removeListener("launcher-update:dismissedForSession", listener);
    },
  },
  projects: {
    list: (): Promise<Project[]> => ipcRenderer.invoke("projects:list"),
    create: (input: CreateProjectInput): Promise<Project> =>
      ipcRenderer.invoke("projects:create", input),
    getActive: (): Promise<Project | null> => ipcRenderer.invoke("projects:getActive"),
    listFiles: (): Promise<string[]> => ipcRenderer.invoke("projects:listFiles"),
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
    listByIds: (ids: string[]): Promise<Thread[]> => ipcRenderer.invoke("threads:listByIds", ids),
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
  tabs: {
    listOpen: (): Promise<OpenTabsState> => ipcRenderer.invoke("tabs:listOpen"),
    open: (threadId: string): Promise<OpenTabsState> => ipcRenderer.invoke("tabs:open", threadId),
    close: (threadId: string): Promise<OpenTabsState> => ipcRenderer.invoke("tabs:close", threadId),
    setActive: (threadId: string | null): Promise<OpenTabsState> =>
      ipcRenderer.invoke("tabs:setActive", threadId),
    getActive: (): Promise<string | null> => ipcRenderer.invoke("tabs:getActive"),
    onChanged: (callback: (state: OpenTabsState) => void) => {
      const listener = (_event: any, state: OpenTabsState) => callback(state);
      ipcRenderer.on("tabs:changed", listener);
      return () => {
        ipcRenderer.removeListener("tabs:changed", listener);
      };
    },
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
    replacePrompt: (input: AgentReplacePromptInput): Promise<void> =>
      ipcRenderer.invoke("agent:replacePrompt", input),
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
    sendPrompt: (input: {
      message: string;
      streamingBehavior?: "followUp" | "steer";
    }): Promise<void> =>
      ipcRenderer.invoke("editor:sendPrompt", input),
    abort: (): Promise<void> => ipcRenderer.invoke("editor:abort"),
    setModel: (model: { provider: string; modelId: string }): Promise<boolean> =>
      ipcRenderer.invoke("editor:setModel", model),
    dispose: (): Promise<void> => ipcRenderer.invoke("editor:dispose"),
    onEvent: (callback: (payload: import("../contracts/agent.ts").AgentBridgeEvent) => void) => {
      const listener = (_event: any, payload: import("../contracts/agent.ts").AgentBridgeEvent) =>
        callback(payload);
      ipcRenderer.on("editor:event", listener);
      return () => ipcRenderer.removeListener("editor:event", listener);
    },
  },
  analytics: {
    componentMutationRequested: (input: {
      componentId?: string | null;
      source?: "overlay" | "companion";
    }): Promise<void> => ipcRenderer.invoke("analytics:componentMutationRequested", input),
  },
  pipper: {
    enterEditMode: (): Promise<void> => ipcRenderer.invoke("pipper:enterEditMode"),
    exitEditMode: (): Promise<void> => ipcRenderer.invoke("pipper:exitEditMode"),
    setProcessing: (processingId: string | null): Promise<void> =>
      ipcRenderer.invoke("pipper:setProcessing", processingId),
    setOverlayVisible: (visible: boolean): Promise<void> =>
      ipcRenderer.invoke("pipper:setOverlayVisible", visible),
    addComment: (pipperId: string, text: string): Promise<void> =>
      ipcRenderer.invoke("pipper:addComment", pipperId, text),
    acceptChanges: (intent?: string): Promise<{ committed: boolean; filesChanged: string[] }> =>
      ipcRenderer.invoke("pipper:acceptChanges", intent),
    rejectChanges: (): Promise<void> => ipcRenderer.invoke("pipper:rejectChanges"),
    onStateChanged: (
      callback: (payload: {
        processingId?: string | null;
        editMode?: boolean;
        overlayVisible?: boolean;
      }) => void,
    ) => {
      const listener = (
        _event: any,
        payload: {
          processingId?: string | null;
          editMode?: boolean;
          overlayVisible?: boolean;
        },
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
    getCurrent: (): Promise<string> => ipcRenderer.invoke("theme:getCurrent"),
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
