import type { Project } from "../../contracts/projects.ts";
import type { OpenTabsState, Thread, ThreadPage } from "../../contracts/threads.ts";
import type { Message } from "../../contracts/messages.ts";
import type {
  AgentBridgeEvent,
  AgentModelSummary,
  AgentPromptInput,
  AgentReplacePromptInput,
  AgentRuntimeSnapshot,
  AgentUiResponse,
} from "../../contracts/agent.ts";
import type { SessionStats, SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import type { UpdateProgress, UpdateRunResult, UpdateState } from "../../contracts/updates.ts";
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
  type ThinkingLevel = "low" | "medium" | "high";

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
        scheduleForQuit: () => Promise<UpdateState>;
        startNow: () => Promise<UpdateRunResult>;
        dismiss: () => Promise<UpdateState>;
        cancel: () => Promise<UpdateRunResult>;
        quitWithoutUpdating: () => Promise<void>;
        markActiveHealthy: (version: string) => Promise<boolean>;
        onStateChanged: (callback: (state: UpdateState) => void) => () => void;
        onProgress: (callback: (progress: UpdateProgress) => void) => () => void;
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
          title: string,
          afterThreadId?: string | null,
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
      messages: {
        list: (threadId: string) => Promise<Message[]>;
        create: (input: { thread_id: string; role: string; content: string }) => Promise<Message>;
      };
      agent: {
        getState: () => Promise<AgentRuntimeSnapshot>;
        getCommands: () => Promise<SlashCommandInfo[]>;
        getModels: () => Promise<AgentModelSummary[]>;
        getStats: () => Promise<SessionStats | null>;
        sendPrompt: (input: AgentPromptInput) => Promise<void>;
        replacePrompt: (input: AgentReplacePromptInput) => Promise<void>;
        abort: () => Promise<void>;
        switchThread: (threadId: string) => Promise<void>;
        createThread: (
          projectId: string,
          title: string,
          afterThreadId?: string | null,
        ) => Promise<Thread>;
        cycleModel: (direction?: "forward" | "backward") => Promise<AgentModelSummary | null>;
        setModel: (model: { provider: string; modelId: string }) => Promise<boolean>;
        setThinkingLevel: (level: ThinkingLevel) => Promise<void>;
        cycleThinkingLevel: () => Promise<string | null>;
        compact: (customInstructions?: string) => Promise<void>;
        respondToUiRequest: (response: AgentUiResponse) => Promise<void>;
        setEditorText: (text: string) => Promise<void>;
        getEditorText: () => Promise<string>;
        pasteToEditor: (text: string) => Promise<void>;
        reportEditorText: (text: string) => void;
        onEvent: (callback: (payload: AgentBridgeEvent) => void) => () => void;
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
        getState: () => Promise<AgentRuntimeSnapshot>;
        sendPrompt: (input: { message: string }) => Promise<void>;
        setModel: (model: { provider: string; modelId: string }) => Promise<boolean>;
        dispose: () => Promise<void>;
        onEvent: (callback: (payload: AgentBridgeEvent) => void) => () => void;
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
        addComment: (pipperId: string, text: string) => Promise<void>;
        acceptChanges: (intent?: string) => Promise<void>;
        rejectChanges: () => Promise<void>;
        onStateChanged: (
          callback: (payload: { processingId?: string | null; editMode?: boolean }) => void,
        ) => () => void;
        onCommentAdded: (callback: (pipperId: string, text: string) => void) => () => void;
      };
      theme: {
        changed: (theme: string) => void;
        onChanged: (callback: (theme: string) => void) => () => void;
      };
    };
  }
}
