/**
 * Shared ACP / Pipper agent bridge types for main ↔ renderer IPC.
 * Protocol types come from @agentclientprotocol/sdk; this file holds
 * app-level envelopes and store shapes.
 */

import type {
  AgentCapabilities,
  AuthMethod,
  AvailableCommand,
  ContentBlock,
  PlanEntry,
  SessionConfigOption,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
  ToolKind,
  ToolCallStatus,
  ToolCallContent,
} from "@agentclientprotocol/sdk";

export type {
  AgentCapabilities,
  AuthMethod,
  AvailableCommand,
  ContentBlock,
  PlanEntry,
  SessionConfigOption,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
  ToolKind,
  ToolCallStatus,
  ToolCallContent,
};

/** How the agent is expected to be available on the machine. */
export type AcpAgentInstallKind = "binary" | "npx" | "mock";

/** Registry entry describing an ACP agent Pipper can spawn. */
export interface AcpAgentDescriptor {
  id: string;
  name: string;
  /** Display name shown in the UI. */
  displayName: string;
  version?: string;
  /** Spawn command (e.g. `agent`, `npx`, `codex-acp`). */
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** Optional icon key for tab indicators. */
  icon?: string;
  /** Short description for onboarding. */
  description?: string;
  /** Docs / install page URL. */
  docsUrl?: string;
  /** External auth instructions shown when authMethods is non-empty. */
  authHint?: string;
  /** Human install command shown when the agent is not detected. */
  installHint?: string;
  installKind?: AcpAgentInstallKind;
  /** Commands probed on PATH to decide if the agent is installed. */
  detectCommands?: string[];
  /** npm package for npx-backed agents. */
  npmPackage?: string;
  /** True when a matching binary was found (or npx can fetch the package). */
  available?: boolean;
  /** Resolved absolute path of the detected binary, when known. */
  resolvedCommand?: string | null;
  /** Reason the agent is unavailable / needs setup. */
  statusMessage?: string | null;
}

/**
 * Outcome of actually spawning an agent and attempting an ACP `initialize`
 * handshake, as opposed to `AcpAgentDescriptor.available` which only checks
 * whether a binary/npx fetch path exists.
 */
export type AgentProbeStatus = "probing" | "ready" | "needs-install" | "needs-auth" | "error";

export interface AgentProbeResult {
  agentId: string;
  status: AgentProbeStatus;
  /** Human-readable reason, shown alongside install/auth/error states. */
  message?: string | null;
  /** Auth methods the agent reported during `initialize`, when `status` is `needs-auth`. */
  authMethods?: AuthMethod[];
}

export interface AcpUsageState {
  used: number;
  size: number;
  cost?: { amount: number; currency: string };
}

export interface AcpToolCallState {
  toolCallId: string;
  title: string;
  kind?: ToolKind;
  status?: ToolCallStatus;
  content?: ToolCallContent[];
  locations?: Array<{ path: string; line?: number | null }>;
  rawInput?: unknown;
  rawOutput?: unknown;
}

/**
 * One item in a session's ordered timeline. Mirrors ACP's flat stream of
 * `session/update` notifications: text/thought segments and tool calls are
 * siblings, and render order is arrival order. Consecutive chunks of the same
 * kind accumulate into the tail entry; a tool call between text chunks starts
 * a new segment, so interleaving is preserved. Tool call details live in
 * `AcpSessionState.toolCalls` keyed by `toolCallId`; `tool_call_update`
 * touches only that record, never the entry list.
 */
export type AcpEntry =
  | { type: "user_text"; id: string; messageId: string | null; text: string }
  | { type: "agent_text"; id: string; messageId: string | null; text: string }
  | { type: "agent_thought"; id: string; messageId: string | null; text: string }
  | { type: "tool_call"; id: string; toolCallId: string };

/** Content part of a derived chat message; order matches the entry timeline. */
export type AcpMessagePart =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | {
      type: "toolCall";
      id: string;
      name: string;
      kind?: ToolKind;
      status?: ToolCallStatus;
      arguments: Record<string, unknown>;
      args: Record<string, unknown>;
      content?: ToolCallContent[];
      rawOutput?: unknown;
    };

/**
 * Chat message view derived from the entry timeline by the renderer
 * projection (`src/lib/acp-entries.ts`). Not sent over IPC.
 */
export interface AcpChatMessage {
  id: string;
  role: "user" | "assistant";
  /** Concatenated visible text segments (no thought/tool content). */
  text: string;
  /** Concatenated thought segments. */
  thought: string;
  /** Parts in timeline order (thinking / toolCall / text interleaved). */
  content: AcpMessagePart[];
  toolCallIds: string[];
  /** True while the assistant message is still streaming. */
  streaming: boolean;
}

export interface AcpPermissionRequest {
  sessionId: string;
  /** Thread that owns the session this permission belongs to, resolved in the
   *  main process from `sessionId`. Lets the renderer route the question to the
   *  right surface (inline composer vs. bottom-right dock). Null when the
   *  session isn't bound to a thread yet. */
  threadId?: string | null;
  toolCall: ToolCallUpdate | ToolCall;
  options: Array<{
    optionId: string;
    name: string;
    kind: "allow_once" | "allow_always" | "reject_once" | "reject_always" | string;
  }>;
}

export interface AcpPermissionResponse {
  sessionId: string;
  optionId?: string;
  /** When true, respond with cancelled outcome (e.g. after session/cancel). */
  cancelled?: boolean;
}

export interface AcpPromptInput {
  threadId?: string | null;
  /** Pre-assembled content blocks. If omitted, `message` + `images` are used. */
  prompt?: ContentBlock[];
  message?: string;
  images?: Array<{ data: string; mimeType: string }>;
  resources?: Array<{
    uri: string;
    name?: string;
    mimeType?: string;
    text?: string;
  }>;
}

export interface AcpReplacePromptInput {
  threadId: string;
  promptId: string;
  text: string;
  images?: Array<{ data: string; mimeType: string }>;
}

export interface AcpSessionState {
  projectId: string | null;
  threadId: string | null;
  agentId: string | null;
  agentSessionId: string | null;
  cwd: string | null;
  title: string | null;
  configOptions: SessionConfigOption[];
  commands: AvailableCommand[];
  /** Ordered session timeline; see {@link AcpEntry}. */
  entries: AcpEntry[];
  toolCalls: Record<string, AcpToolCallState>;
  plan: PlanEntry[] | null;
  usage: AcpUsageState | null;
  currentModeId: string | null;
  isStreaming: boolean;
  isCompacting: boolean;
  editorText: string;
  authRequiredMessage: string | null;
  switchingAgent: boolean;
}

export type AcpBridgeEvent =
  | { type: "session-state"; state: AcpSessionState }
  | { type: "session-update"; sessionId: string; threadId: string | null; update: SessionUpdate }
  | { type: "permission-request"; request: AcpPermissionRequest }
  | { type: "permission-resolved"; sessionId: string }
  | {
      type: "connection";
      agentId: string | null;
      agentCapabilities: AgentCapabilities | null;
      authMethods: AuthMethod[];
    }
  | { type: "notification"; message: string; level: "info" | "warning" | "error" }
  | { type: "title"; threadId: string; title: string }
  | { type: "terminal-output"; terminalId: string; output: string; append: boolean }
  | { type: "editor-text"; text: string }
  | { type: "stop"; sessionId: string; threadId: string | null; stopReason: string }
  /** Thread IDs whose agent is currently streaming, across all open threads. */
  | { type: "running-threads"; threadIds: string[] };

export interface McpServerRecord {
  id: string;
  name: string;
  transport_type: "http" | "sse" | "stdio";
  url: string | null;
  command: string | null;
  args: string | null;
  env: string | null;
  created_at: number;
  updated_at: number;
}

export interface McpServerInput {
  name: string;
  transport_type: "http" | "sse" | "stdio";
  url?: string | null;
  command?: string | null;
  args?: string[] | null;
  env?: Record<string, string> | null;
}
