import type { Project, ProjectFileTreeSnapshot } from "../../contracts/projects.ts";
import type { GitBranch, Worktree, WorktreeSetupProgress } from "../../contracts/worktrees.ts";
import type { OpenTabsState, Thread, ThreadPage } from "../../contracts/threads.ts";
import type {
  AcpAgentDescriptor,
  AcpBridgeEvent,
  AcpPromptInput,
  AcpReplacePromptInput,
  AcpSessionState,
  AgentCapabilities,
  AgentProbeResult,
  AvailableCommand,
  McpServerInput,
  McpServerRecord,
  SessionConfigOption,
  SubagentConfig,
  SubagentRunSnapshot,
} from "../../contracts/acp.ts";
import type {
  LauncherDownloadProgress,
  LauncherUpdateDiagnostics,
  LauncherUpdateState,
} from "../../contracts/launcher-updates.ts";

export interface CreateProjectInput {
  name: string;
  path: string;
  icon: string;
}

declare global {
  interface Window {
    omni: {
      launch: {
        complete: (projectId: string) => Promise<void>;
        show: (stage?: "list" | "add" | "onboarding") => Promise<void>;
        onAuthComplete: (
          callback: (user: { name: string | null; email: string | null }) => void,
        ) => () => void;
        getUser: () => Promise<{ name: string | null; email: string | null } | null>;
      };
      shell: {
        openExternal: (url: string) => Promise<void>;
      };
      launcherUpdate: {
        check: () => Promise<LauncherUpdateState>;
        getState: () => Promise<LauncherUpdateState>;
        isDismissedForSession: () => Promise<boolean>;
        download: () => Promise<LauncherUpdateState>;
        cancelDownload: () => Promise<LauncherUpdateState>;
        dismissForSession: () => Promise<LauncherUpdateState>;
        installAndQuit: () => Promise<{ success: boolean; error?: string }>;
        retryDownload: () => Promise<LauncherUpdateState>;
        openDownloadFolder: () => Promise<void>;
        downloadInBrowser: () => Promise<void>;
        clearDownloadedUpdate: () => Promise<LauncherUpdateState>;
        getDiagnostics: () => Promise<LauncherUpdateDiagnostics>;
        copyDiagnostics: () => Promise<void>;
        onStateChanged: (callback: (state: LauncherUpdateState) => void) => () => void;
        onProgress: (callback: (progress: LauncherDownloadProgress) => void) => () => void;
        onOpenDetails: (callback: () => void) => () => void;
        onDismissedForSession: (callback: () => void) => () => void;
      };
      projects: {
        list: () => Promise<Project[]>;
        create: (input: CreateProjectInput) => Promise<Project>;
        getActive: () => Promise<Project | null>;
        listFiles: () => Promise<string[]>;
        getFileTree: () => Promise<ProjectFileTreeSnapshot>;
        setActive: (projectId: string) => Promise<void>;
        onActiveChanged: (callback: (projectId: string) => void) => () => void;
      };
      worktrees: {
        list: (projectId: string) => Promise<Worktree[]>;
        create: (input: { projectId: string; name: string }) => Promise<Worktree>;
        switch: (input: { projectId: string; path: string }) => Promise<Thread>;
        getSelections: () => Promise<Record<string, string>>;
        onSetupProgress: (callback: (progress: WorktreeSetupProgress) => void) => () => void;
        listBranches: (input: { projectId: string }) => Promise<GitBranch[]>;
        switchBranch: (input: {
          projectId: string;
          path: string;
          branch: string;
        }) => Promise<{ thread: Thread; worktree: Worktree }>;
      };
      onboarding: {
        verifyGit: () => Promise<boolean>;
        startSetup: () => Promise<void>;
        onProgress: (
          callback: (payload: {
            step: string;
            status: "pending" | "running" | "complete" | "failed";
            progress?: number;
            error?: string;
            gitInstalled?: boolean;
            nodeMatch?: boolean;
            bunMatch?: boolean;
          }) => void,
        ) => () => void;
      };
      threads: {
        list: () => Promise<Thread[]>;
        listByIds: (ids: string[]) => Promise<Thread[]>;
        listProject: (input: {
          projectId: string;
          limit?: number;
          offset?: number;
        }) => Promise<ThreadPage>;
        create: (
          projectId: string,
          title: string | null,
          afterThreadId?: string | null,
          agentId?: string | null,
          worktreePath?: string | null,
        ) => Promise<Thread>;
        rename: (id: string, title: string) => Promise<Thread>;
        delete: (id: string) => Promise<void>;
      };
      tabs: {
        listOpen: () => Promise<OpenTabsState>;
        open: (threadId: string) => Promise<OpenTabsState>;
        close: (threadId: string) => Promise<OpenTabsState>;
        setActive: (threadId: string | null) => Promise<OpenTabsState>;
        getActive: () => Promise<string | null>;
        onChanged: (callback: (state: OpenTabsState) => void) => () => void;
      };
      agent: {
        getState: () => Promise<AcpSessionState>;
        getCommands: () => Promise<AvailableCommand[]>;
        getConfigOptions: () => Promise<SessionConfigOption[]>;
        getCapabilities: () => Promise<AgentCapabilities | null>;
        getStats: () => Promise<{
          used: number;
          size: number;
          cost?: { amount: number; currency: string };
        } | null>;
        getRunningThreads: () => Promise<string[]>;
        sendPrompt: (input: AcpPromptInput) => Promise<void>;
        replacePrompt: (input: AcpReplacePromptInput) => Promise<void>;
        abort: () => Promise<void>;
        switchThread: (threadId: string) => Promise<void>;
        createThread: (
          projectId: string,
          title: string | null,
          afterThreadId?: string | null,
          agentId?: string | null,
          worktreePath?: string | null,
        ) => Promise<Thread>;
        getSelectedAgentIds: () => Promise<string[]>;
        setSelectedAgentIds: (agentIds: string[]) => Promise<void>;
        setConfigOption: (
          configId: string,
          value: string | boolean,
        ) => Promise<SessionConfigOption[]>;
        respondToPermission: (response: {
          sessionId: string;
          optionId?: string;
          cancelled?: boolean;
        }) => Promise<void>;
        listAgents: () => Promise<AcpAgentDescriptor[]>;
        probeAgent: (agentId: string) => Promise<AgentProbeResult>;
        switchAgent: (agentId: string) => Promise<void>;
        getPreferredAgentId: () => Promise<string>;
        setPreferredAgentId: (agentId: string) => Promise<void>;
        closeThreadSession: (threadId: string) => Promise<void>;
        setEditorText: (text: string) => Promise<void>;
        getEditorText: () => Promise<string>;
        pasteToEditor: (text: string) => Promise<void>;
        reportEditorText: (text: string) => void;
        onEvent: (callback: (payload: AcpBridgeEvent) => void) => () => void;
      };
      subagents: {
        getConfig: () => Promise<SubagentConfig>;
        setConfig: (partial: Partial<SubagentConfig>) => Promise<SubagentConfig>;
        listRuns: () => Promise<SubagentRunSnapshot[]>;
      };
      mcp: {
        list: () => Promise<McpServerRecord[]>;
        create: (input: McpServerInput) => Promise<McpServerRecord>;
        update: (id: string, input: Partial<McpServerInput>) => Promise<McpServerRecord | null>;
        delete: (id: string) => Promise<void>;
      };
      dialog: {
        pickDirectory: () => Promise<string | null>;
      };
      terminal: {
        create: (sessionId: string, cwd?: string, cols?: number, rows?: number) => Promise<void>;
        write: (sessionId: string, data: string) => Promise<void>;
        resize: (sessionId: string, cols: number, rows: number) => Promise<void>;
        kill: (sessionId: string) => Promise<void>;
        onData: (callback: (payload: { sessionId: string; data: string }) => void) => () => void;
        onExit: (
          callback: (payload: { sessionId: string; exitCode: number; signal?: number }) => void,
        ) => () => void;
      };
      analytics: {
        captureException: (input: {
          name: string;
          message: string;
          stack?: string;
        }) => Promise<void>;
      };
      theme: {
        getCurrent: () => Promise<string>;
        changed: (theme: string) => void;
        onChanged: (callback: (theme: string) => void) => () => void;
      };
    };
  }
}
