import { contextBridge, ipcRenderer } from "electron";
import type { Project, ProjectFileTreeSnapshot } from "../contracts/projects.ts";
import type { GitBranch, Worktree, WorktreeSetupProgress } from "../contracts/worktrees.ts";
import type { OpenTabsState, Thread, ThreadPage } from "../contracts/threads.ts";
import type {
  AcpBridgeEvent,
  AcpPromptInput,
  AcpReplacePromptInput,
  AcpSessionState,
  AcpToolCallState,
  AgentCapabilities,
  AvailableCommand,
  SessionConfigOption,
  AcpAgentDescriptor,
  AgentProbeResult,
  SubagentConfig,
  SubagentRunSnapshot,
} from "../contracts/acp.ts";
import type {
  LauncherDownloadProgress,
  LauncherUpdateDiagnostics,
  LauncherUpdateState,
} from "../contracts/launcher-updates.ts";
import type {
  MonitorConnectionEpisode,
  MonitorAcpUpdate,
  MonitorBridgeEvent,
  MonitorDiffIngestion,
  MonitorIncident,
  MonitorLiveSnapshot,
  MonitorRendererFreezeReport,
  MonitorRendererTelemetry,
  MonitorSampleTick,
  MonitorRecordedSession,
  MonitorSession,
  MonitorSwitchRecord,
  MonitorTabClickTiming,
  MonitorTabEvent,
  MonitorTabMismatchReport,
} from "../contracts/monitor.ts";
import type { MonitorService } from "./monitor/service.ts";
import type { SleeplessPreferences, SleeplessStatus } from "../contracts/sleepless.ts";
import type {
  ThreadBenchmarkMode,
  ThreadBenchmarkPrepared,
  ThreadBenchmarkRendererReady,
  ThreadBenchmarkReport,
  ThreadBenchmarkRun,
  ThreadBenchmarkStatus,
} from "../contracts/benchmark.ts";

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
    onAuthComplete: (callback: (user: { name: string | null; email: string | null }) => void) => {
      const listener = (_event: any, user: { name: string | null; email: string | null }) =>
        callback(user);
      ipcRenderer.on("launch:authComplete", listener);
      return () => ipcRenderer.removeListener("launch:authComplete", listener);
    },
    getUser: (): Promise<{ name: string | null; email: string | null } | null> =>
      ipcRenderer.invoke("launch:getUser"),
  },
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:openExternal", url),
  },
  sleepless: {
    getStatus: (): Promise<SleeplessStatus | null> => ipcRenderer.invoke("sleepless:getStatus"),
    setEnabled: (enabled: boolean): Promise<SleeplessStatus | null> =>
      ipcRenderer.invoke("sleepless:setEnabled", enabled),
    setPreferences: (
      preferences: Partial<
        Pick<SleeplessPreferences, "acOnly" | "batteryFloor" | "maxDurationMinutes">
      >,
    ): Promise<SleeplessStatus | null> =>
      ipcRenderer.invoke("sleepless:setPreferences", preferences),
    refresh: (): Promise<SleeplessStatus | null> => ipcRenderer.invoke("sleepless:refresh"),
    openSystemSettings: (): Promise<void> => ipcRenderer.invoke("sleepless:openSystemSettings"),
    onStatusChanged: (callback: (status: SleeplessStatus) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: SleeplessStatus) =>
        callback(status);
      ipcRenderer.on("sleepless:statusChanged", listener);
      return () => ipcRenderer.removeListener("sleepless:statusChanged", listener);
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
    listFiles: (projectId?: string, worktreePath?: string | null): Promise<string[]> =>
      ipcRenderer.invoke("projects:listFiles", projectId, worktreePath ?? null),
    getFileTree: (): Promise<ProjectFileTreeSnapshot> => ipcRenderer.invoke("projects:getFileTree"),
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
  worktrees: {
    list: (projectId: string): Promise<Worktree[]> =>
      ipcRenderer.invoke("worktrees:list", projectId),
    create: (input: { projectId: string; name: string }): Promise<Worktree> =>
      ipcRenderer.invoke("worktrees:create", input),
    switch: (input: { projectId: string; path: string }): Promise<Thread> =>
      ipcRenderer.invoke("worktrees:switch", input),
    getSelections: (): Promise<Record<string, string>> =>
      ipcRenderer.invoke("worktrees:getSelections"),
    onSetupProgress: (callback: (progress: WorktreeSetupProgress) => void) => {
      const listener = (_event: unknown, progress: WorktreeSetupProgress) => callback(progress);
      ipcRenderer.on("worktrees:setupProgress", listener);
      return () => {
        ipcRenderer.removeListener("worktrees:setupProgress", listener);
      };
    },
    listBranches: (input: { projectId: string }): Promise<GitBranch[]> =>
      ipcRenderer.invoke("worktrees:listBranches", input),
    switchBranch: (input: {
      projectId: string;
      path: string;
      branch: string;
    }): Promise<{ thread: Thread; worktree: Worktree }> =>
      ipcRenderer.invoke("worktrees:switchBranch", input),
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
    create: (
      projectId: string,
      title: string | null,
      afterThreadId?: string | null,
      agentId?: string | null,
      worktreePath?: string | null,
    ): Promise<Thread> =>
      ipcRenderer.invoke("threads:create", projectId, title, afterThreadId, agentId, worktreePath),
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
    onSelectByIndex: (callback: (index: number) => void) => {
      const listener = (_event: any, index: number) => {
        if (typeof index === "number") callback(index);
      };
      ipcRenderer.on("tabs:selectByIndex", listener);
      return () => {
        ipcRenderer.removeListener("tabs:selectByIndex", listener);
      };
    },
    onNewTab: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("tabs:newTab", listener);
      return () => {
        ipcRenderer.removeListener("tabs:newTab", listener);
      };
    },
  },
  agent: {
    getState: (): Promise<AcpSessionState> => ipcRenderer.invoke("agent:getState"),
    getCommands: (): Promise<AvailableCommand[]> => ipcRenderer.invoke("agent:getCommands"),
    getConfigOptions: (): Promise<SessionConfigOption[]> =>
      ipcRenderer.invoke("agent:getConfigOptions"),
    getCapabilities: (): Promise<AgentCapabilities | null> =>
      ipcRenderer.invoke("agent:getCapabilities"),
    getStats: (): Promise<{
      used: number;
      size: number;
      cost?: { amount: number; currency: string };
    } | null> => ipcRenderer.invoke("agent:getStats"),
    getRunningThreads: (): Promise<string[]> => ipcRenderer.invoke("agent:getRunningThreads"),
    getToolCalls: (threadId: string): Promise<Record<string, AcpToolCallState>> =>
      ipcRenderer.invoke("agent:getToolCalls", threadId),
    sendPrompt: (input: AcpPromptInput): Promise<void> =>
      ipcRenderer.invoke("agent:sendPrompt", input),
    replacePrompt: (input: AcpReplacePromptInput): Promise<void> =>
      ipcRenderer.invoke("agent:replacePrompt", input),
    abort: (): Promise<void> => ipcRenderer.invoke("agent:abort"),
    switchThread: (threadId: string): Promise<void> =>
      ipcRenderer.invoke("agent:switchThread", threadId),
    createThread: (
      projectId: string,
      title: string | null,
      afterThreadId?: string | null,
      agentId?: string | null,
      worktreePath?: string | null,
      initialModelId?: string | null,
    ): Promise<Thread> =>
      ipcRenderer.invoke(
        "agent:createThread",
        projectId,
        title,
        afterThreadId,
        agentId,
        worktreePath,
        initialModelId,
      ),
    getSelectedAgentIds: (): Promise<string[]> => ipcRenderer.invoke("agent:getSelectedAgentIds"),
    setSelectedAgentIds: (agentIds: string[]): Promise<void> =>
      ipcRenderer.invoke("agent:setSelectedAgentIds", agentIds),
    setConfigOption: (configId: string, value: string | boolean): Promise<SessionConfigOption[]> =>
      ipcRenderer.invoke("agent:setConfigOption", configId, value),
    respondToPermission: (response: {
      sessionId: string;
      optionId?: string;
      cancelled?: boolean;
    }): Promise<void> => ipcRenderer.invoke("agent:respondToPermission", response),
    listAgents: (): Promise<AcpAgentDescriptor[]> => ipcRenderer.invoke("agent:listAgents"),
    getModelCatalogs: (): Promise<
      Record<string, Array<{ modelId: string; name: string; provider?: string }>>
    > => ipcRenderer.invoke("agent:getModelCatalogs"),
    probeAgent: (agentId: string): Promise<AgentProbeResult> =>
      ipcRenderer.invoke("agent:probeAgent", agentId),
    switchAgent: (agentId: string): Promise<void> =>
      ipcRenderer.invoke("agent:switchAgent", agentId),
    getPreferredAgentId: (): Promise<string> => ipcRenderer.invoke("agent:getPreferredAgentId"),
    setPreferredAgentId: (agentId: string): Promise<void> =>
      ipcRenderer.invoke("agent:setPreferredAgentId", agentId),
    closeThreadSession: (threadId: string): Promise<void> =>
      ipcRenderer.invoke("agent:closeThreadSession", threadId),
    setEditorText: (text: string): Promise<void> => ipcRenderer.invoke("agent:setEditorText", text),
    getEditorText: (): Promise<string> => ipcRenderer.invoke("agent:getEditorText"),
    pasteToEditor: (text: string): Promise<void> => ipcRenderer.invoke("agent:pasteToEditor", text),
    reportEditorText: (text: string): void => {
      ipcRenderer.send("agent:reportEditorText", text);
    },
    onEvent: (callback: (payload: AcpBridgeEvent) => void) => {
      const listener = (_event: any, payload: AcpBridgeEvent) => callback(payload);
      ipcRenderer.on("agent:event", listener);
      return () => {
        ipcRenderer.removeListener("agent:event", listener);
      };
    },
  },
  subagents: {
    getConfig: (): Promise<SubagentConfig> => ipcRenderer.invoke("subagents:getConfig"),
    setConfig: (partial: Partial<SubagentConfig>): Promise<SubagentConfig> =>
      ipcRenderer.invoke("subagents:setConfig", partial),
    listRuns: (): Promise<SubagentRunSnapshot[]> => ipcRenderer.invoke("subagents:listRuns"),
  },
  mcp: {
    list: () => ipcRenderer.invoke("mcp:list"),
    create: (input: unknown) => ipcRenderer.invoke("mcp:create", input),
    update: (id: string, input: unknown) => ipcRenderer.invoke("mcp:update", id, input),
    delete: (id: string) => ipcRenderer.invoke("mcp:delete", id),
  },
  dialog: {
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke("dialog:pickDirectory"),
  },
  terminal: {
    create: (sessionId: string, cwd?: string, cols?: number, rows?: number): Promise<void> =>
      ipcRenderer.invoke("terminal:create", sessionId, cwd, cols, rows),
    write: (sessionId: string, data: string): Promise<void> =>
      ipcRenderer.invoke("terminal:write", { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke("terminal:resize", { sessionId, cols, rows }),
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
  analytics: {
    captureException: (input: { name: string; message: string; stack?: string }): Promise<void> =>
      ipcRenderer.invoke("analytics:captureException", input),
  },
  startup: {
    reportRendererMilestone: (label: string, rendererElapsedMs: number): void =>
      ipcRenderer.send("startup:renderer-milestone", { label, rendererElapsedMs }),
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
  monitor: {
    isEnabled: (): Promise<boolean> => ipcRenderer.invoke("monitor:isEnabled"),
    getLive: (): Promise<MonitorLiveSnapshot> => ipcRenderer.invoke("monitor:getLive"),
    getIncidents: (): Promise<MonitorIncident[]> => ipcRenderer.invoke("monitor:getIncidents"),
    getConnectionEpisodes: (): Promise<MonitorConnectionEpisode[]> =>
      ipcRenderer.invoke("monitor:getConnectionEpisodes"),
    getSessions: (): Promise<MonitorSession[]> => ipcRenderer.invoke("monitor:getSessions"),
    getRecordedSession: (sessionId: string): Promise<MonitorRecordedSession> =>
      ipcRenderer.invoke("monitor:getRecordedSession", sessionId),
    startRecording: (label?: string): Promise<MonitorSession> =>
      ipcRenderer.invoke("monitor:startRecording", label),
    stopRecording: (): Promise<MonitorSession | null> =>
      ipcRenderer.invoke("monitor:stopRecording"),
    reportRendererFreeze: (report: MonitorRendererFreezeReport): Promise<void> =>
      ipcRenderer.invoke("monitor:reportRendererFreeze", report),
    reportRendererTelemetry: (telemetry: MonitorRendererTelemetry): Promise<void> =>
      ipcRenderer.invoke("monitor:reportRendererTelemetry", telemetry),
    reportDiffIngestion: (ingestion: MonitorDiffIngestion): void =>
      ipcRenderer.send("monitor:reportDiffIngestion", ingestion),
    reportTabMismatch: (report: MonitorTabMismatchReport): Promise<void> =>
      ipcRenderer.invoke("monitor:reportTabMismatch", report),
    reportTabClickTiming: (timing: MonitorTabClickTiming): Promise<void> =>
      ipcRenderer.invoke("monitor:reportTabClickTiming", timing),
    getSwitches: (): Promise<MonitorSwitchRecord[]> => ipcRenderer.invoke("monitor:getSwitches"),
    getTabEvents: (): Promise<MonitorTabEvent[]> => ipcRenderer.invoke("monitor:getTabEvents"),
    getTabClickTimings: (): Promise<MonitorTabClickTiming[]> =>
      ipcRenderer.invoke("monitor:getTabClickTimings"),
    getSwitchTimeline: (): Promise<ReturnType<MonitorService["getSwitchTimeline"]>> =>
      ipcRenderer.invoke("monitor:getSwitchTimeline"),
    openWindow: (): Promise<void> => ipcRenderer.invoke("monitor:openWindow"),
    onLive: (callback: (snapshot: MonitorLiveSnapshot) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, snapshot: MonitorLiveSnapshot) =>
        callback(snapshot);
      ipcRenderer.on("monitor:live", listener);
      return () => ipcRenderer.removeListener("monitor:live", listener);
    },
    onTick: (callback: (tick: MonitorSampleTick) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, tick: MonitorSampleTick) =>
        callback(tick);
      ipcRenderer.on("monitor:tick", listener);
      return () => ipcRenderer.removeListener("monitor:tick", listener);
    },
    onIncident: (callback: (incident: MonitorIncident) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, incident: MonitorIncident) =>
        callback(incident);
      ipcRenderer.on("monitor:incident", listener);
      return () => ipcRenderer.removeListener("monitor:incident", listener);
    },
  },
  benchmark: {
    enabled: process.env.PIPPER_BENCHMARK_MODE === "1",
    switchTimeoutMs: Math.max(
      60_000,
      Number(process.env.PIPPER_ACP_SWITCH_TIMEOUT_MS) || 60_000,
    ),
    status: (): Promise<ThreadBenchmarkStatus> => ipcRenderer.invoke("benchmark:status"),
    prepare: (): Promise<ThreadBenchmarkPrepared> => ipcRenderer.invoke("benchmark:prepare"),
    start: (mode: ThreadBenchmarkMode): Promise<ThreadBenchmarkRun> =>
      ipcRenderer.invoke("benchmark:start", mode),
    finish: (): Promise<ThreadBenchmarkReport> => ipcRenderer.invoke("benchmark:finish"),
    cleanup: (): Promise<void> => ipcRenderer.invoke("benchmark:cleanup"),
    reportRendererReady: (input: ThreadBenchmarkRendererReady): void =>
      ipcRenderer.send("benchmark:rendererReady", input),
  },
};

contextBridge.exposeInMainWorld("omni", api);

export type OmniApi = typeof api;
