/**
 * @deprecated Legacy pi-sdk agent contracts.
 * Re-export ACP types for residual imports during migration.
 */
export type {
  AcpBridgeEvent as AgentBridgeEvent,
  AcpPromptInput as AgentPromptInput,
  AcpReplacePromptInput as AgentReplacePromptInput,
  AcpSessionState as AgentRuntimeSnapshot,
  AcpChatMessage,
  AcpPermissionRequest,
  AcpPermissionResponse,
} from "./acp.ts";

export interface AgentPromptImage {
  type: "image";
  data: string;
  mimeType: string;
}

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
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

export interface AgentUiResponse {
  requestId: string;
  value: string | boolean | undefined;
}
