import type { Project } from "../../contracts/projects.ts";
import type { OpenTabsState, Thread, ThreadPage } from "../../contracts/threads.ts";
import type {
  AcpAgentDescriptor,
  AcpBridgeEvent,
  AcpPromptInput,
  AcpReplacePromptInput,
  AcpSessionState,
  AgentCapabilities,
  AvailableCommand,
  McpServerInput,
  McpServerRecord,
  SessionConfigOption,
} from "../../contracts/acp.ts";
import type {
  InstallationMetadata,
  UpdateManifest,
  UpdateProgress,
  UpdateRunRecord,
  UpdateRunResult,
  UpdateState,
} from "../../contracts/updates.ts";
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
        onWorkspaceReady: (callback: () => void) => () => void;
        onWorkspaceError: (callback: (message: string) => void) => () => void;
        onAuthComplete: (
          callback: (user: { name: string | null; email: string | null }) => void,
        ) => () => void;
        isReady: () => Promise<boolean>;
        getUser: () => Promise<{ name: string | null; email: string | null } | null>;
      };
      shell: {
        openExternal: (url: string) => Promise<void>;
      };
      update: {
        check: () => Promise<UpdateState>;
        getState: () => Promise<UpdateState>;
        getManifest: () => Promise<UpdateManifest | null>;
        getInstallation: () => Promise<InstallationMetadata>;
        getRun: (runId: string) => Promise<UpdateRunRecord | null>;
        getUpdaterSnapshot: () => Promise<AcpSessionState>;
        scheduleForQuit: () => Promise<UpdateState>;
        startNow: () => Promise<UpdateRunResult>;
        retryFailedUpdate: () => Promise<UpdateState>;
        dismiss: () => Promise<UpdateState>;
        cancel: () => Promise<UpdateRunResult>;
        quitWithoutUpdating: () => Promise<void>;
        markActiveHealthy: (version: string) => Promise<boolean>;
        onStateChanged: (callback: (state: UpdateState) => void) => () => void;
        onProgress: (callback: (progress: UpdateProgress) => void) => () => void;
        onUpdaterEvent: (callback: (payload: AcpBridgeEvent) => void) => () => void;
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
        setActive: (projectId: string) => Promise<void>;
        onActiveChanged: (callback: (projectId: string) => void) => () => void;
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
        sendPrompt: (input: AcpPromptInput) => Promise<void>;
        replacePrompt: (input: AcpReplacePromptInput) => Promise<void>;
        abort: () => Promise<void>;
        switchThread: (threadId: string) => Promise<void>;
        createThread: (
          projectId: string,
          title: string | null,
          afterThreadId?: string | null,
          agentId?: string | null,
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
        create: (sessionId: string, cwd?: string) => Promise<void>;
        write: (sessionId: string, data: string) => void;
        resize: (sessionId: string, cols: number, rows: number) => void;
        kill: (sessionId: string) => Promise<void>;
        onData: (callback: (payload: { sessionId: string; data: string }) => void) => () => void;
        onExit: (
          callback: (payload: { sessionId: string; exitCode: number; signal?: number }) => void,
        ) => () => void;
      };
      companion: {
        open: () => Promise<void>;
        minimize: () => void;
        close: () => void;
      };
      editor: {
        activate: () => Promise<void>;
        getState: () => Promise<AcpSessionState>;
        sendPrompt: (input: {
          message: string;
          images?: Array<{ data: string; mimeType: string }>;
        }) => Promise<void>;
        abort: () => Promise<void>;
        setModel: (model: { provider?: string; modelId: string }) => Promise<boolean>;
        dispose: () => Promise<void>;
        onEvent: (callback: (payload: AcpBridgeEvent) => void) => () => void;
      };
      analytics: {
        componentMutationRequested: (input: {
          componentId?: string | null;
          source?: "overlay" | "companion";
        }) => Promise<void>;
      };
      pipper: {
        enterEditMode: () => Promise<void>;
        exitEditMode: () => Promise<void>;
        setProcessing: (processingId: string | null) => Promise<void>;
        setOverlayVisible: (visible: boolean) => Promise<void>;
        addComment: (pipperId: string, text: string) => Promise<void>;
        acceptChanges: (intent?: string) => Promise<{ committed: boolean; filesChanged: string[] }>;
        rejectChanges: () => Promise<void>;
        onStateChanged: (
          callback: (payload: {
            processingId?: string | null;
            editMode?: boolean;
            overlayVisible?: boolean;
          }) => void,
        ) => () => void;
        onCommentAdded: (callback: (pipperId: string, text: string) => void) => () => void;
      };
      theme: {
        getCurrent: () => Promise<string>;
        changed: (theme: string) => void;
        onChanged: (callback: (theme: string) => void) => () => void;
      };
    };
  }
}
