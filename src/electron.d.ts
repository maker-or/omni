import type { Project } from "../../contracts/projects.ts";
import type { Thread } from "../../contracts/threads.ts";
import type { Message } from "../../contracts/messages.ts";
import type {
  AgentBridgeEvent,
  AgentModelSummary,
  AgentPromptInput,
  AgentRuntimeSnapshot,
  AgentUiResponse,
} from "../../contracts/agent.ts";
import type { SessionStats, SlashCommandInfo } from "@earendil-works/pi-coding-agent";

export interface CreateProjectInput {
  name: string;
  path: string;
  icon: string;
}

export {};

declare global {
  interface Window {
    omni: {
      launch: {
        complete: (projectId: string) => Promise<void>;
        show: (stage?: "list" | "add") => Promise<void>;
      };
      projects: {
        list: () => Promise<Project[]>;
        create: (input: CreateProjectInput) => Promise<Project>;
        getActive: () => Promise<Project | null>;
        setActive: (projectId: string) => Promise<void>;
        onActiveChanged: (callback: (projectId: string) => void) => () => void;
      };
      threads: {
        list: () => Promise<Thread[]>;
        create: (projectId: string, title: string) => Promise<Thread>;
        delete: (id: string) => Promise<void>;
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
        abort: () => Promise<void>;
        switchThread: (threadId: string) => Promise<void>;
        createThread: (projectId: string, title: string) => Promise<Thread>;
        cycleModel: (direction?: "forward" | "backward") => Promise<AgentModelSummary | null>;
        setModel: (model: { provider: string; modelId: string }) => Promise<boolean>;
        setThinkingLevel: (level: any) => Promise<void>;
        cycleThinkingLevel: () => Promise<string | null>;
        compact: (customInstructions?: string) => Promise<void>;
        respondToUiRequest: (response: AgentUiResponse) => Promise<void>;
        setEditorText: (text: string) => Promise<void>;
        getEditorText: () => Promise<string>;
        pasteToEditor: (text: string) => Promise<void>;
        reportEditorText: (text: string) => Promise<void>;
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
      flyout: {
        open: () => Promise<void>;
      };
      theme: {
        changed: (theme: string) => void;
        onChanged: (callback: (theme: string) => void) => () => void;
      };
    };
  }
}
