import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionStats, SlashCommandInfo } from "@earendil-works/pi-coding-agent";

export interface AgentModelSummary {
  provider: string;
  modelId: string;
  name: string;
  baseUrl?: string;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
}

export interface AgentQueueState {
  steering: string[];
  followUp: string[];
}

export interface AgentUiSelectRequest {
  id: string;
  kind: "select";
  title: string;
  message?: string;
  options: string[];
  timeoutMs?: number;
}

export interface AgentUiConfirmRequest {
  id: string;
  kind: "confirm";
  title: string;
  message: string;
  timeoutMs?: number;
}

export interface AgentUiInputRequest {
  id: string;
  kind: "input";
  title: string;
  placeholder?: string;
  prefill?: string;
  timeoutMs?: number;
}

export type AgentUiRequest = AgentUiSelectRequest | AgentUiConfirmRequest | AgentUiInputRequest;

export interface AgentRuntimeSnapshot {
  projectId: string | null;
  threadId: string | null;
  sessionFile: string | null;
  sessionId: string | null;
  sessionName: string | null;
  cwd: string | null;
  model: AgentModelSummary | null;
  thinkingLevel: string | null;
  isStreaming: boolean;
  isCompacting: boolean;
  isRetrying: boolean;
  autoCompactionEnabled: boolean;
  autoRetryEnabled: boolean;
  messages: AgentMessage[];
  streamingMessage: AgentMessage | null;
  queue: AgentQueueState;
  commands: SlashCommandInfo[];
  models: AgentModelSummary[];
  stats: SessionStats | null;
  status: Record<string, string | undefined>;
  workingMessage: string | null;
  workingVisible: boolean;
  hiddenThinkingLabel: string | null;
  title: string | null;
  editorText: string;
}

export interface AgentUiResponse {
  requestId: string;
  value: string | boolean | undefined;
}

export type AgentBridgeEvent =
  | {
      type: "snapshot";
      snapshot: AgentRuntimeSnapshot;
    }
  | {
      type: "event";
      event: import("@earendil-works/pi-coding-agent").AgentSessionEvent;
    }
  | {
      type: "ui-request";
      request: AgentUiRequest;
    }
  | {
      type: "ui-response";
      requestId: string;
      value: string | boolean | undefined;
    }
  | {
      type: "status";
      key: string;
      text?: string;
    }
  | {
      type: "working-message";
      message?: string;
    }
  | {
      type: "working-visible";
      visible: boolean;
    }
  | {
      type: "title";
      title?: string;
    }
  | {
      type: "editor-text";
      text: string;
    }
  | {
      type: "notification";
      message: string;
      level: "info" | "warning" | "error";
    };

export interface AgentPromptInput {
  threadId?: string | null;
  message: string;
  streamingBehavior?: "steer" | "followUp";
  images?: Array<{ type: "image"; data: string; mimeType: string }>;
}
