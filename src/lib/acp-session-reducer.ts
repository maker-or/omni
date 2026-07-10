/**
 * Pure reducer for ACP session/update notifications.
 * Testable without Electron or a live agent process.
 */

import type {
  AvailableCommand,
  PlanEntry,
  SessionConfigOption,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
import type { AcpChatMessage, AcpToolCallState, AcpUsageState } from "../../contracts/acp.ts";

export interface AcpSessionSlice {
  messages: AcpChatMessage[];
  toolCalls: Record<string, AcpToolCallState>;
  plan: PlanEntry[] | null;
  usage: AcpUsageState | null;
  configOptions: SessionConfigOption[];
  commands: AvailableCommand[];
  currentModeId: string | null;
  isStreaming: boolean;
  activeMsgId: string | null;
  /** Title from session_info_update; null means no change. */
  title: string | null;
  titleChanged: boolean;
}

export function createEmptySessionSlice(patch: Partial<AcpSessionSlice> = {}): AcpSessionSlice {
  return {
    messages: [],
    toolCalls: {},
    plan: null,
    usage: null,
    configOptions: [],
    commands: [],
    currentModeId: null,
    isStreaming: false,
    activeMsgId: null,
    title: null,
    titleChanged: false,
    ...patch,
  };
}

function contentText(content: { type?: string; text?: string } | undefined): string {
  if (!content) return "";
  if (content.type === "text" && typeof content.text === "string") return content.text;
  return "";
}

function ensureMessage(
  messages: AcpChatMessage[],
  messageId: string,
  role: "user" | "assistant",
): { messages: AcpChatMessage[]; index: number } {
  const index = messages.findIndex((m) => m.id === messageId);
  if (index >= 0) return { messages, index };
  const next: AcpChatMessage = {
    id: messageId,
    role,
    text: "",
    thought: "",
    toolCallIds: [],
    streaming: role === "assistant",
  };
  return { messages: [...messages, next], index: messages.length };
}

function updateMessage(
  messages: AcpChatMessage[],
  index: number,
  patch: Partial<AcpChatMessage>,
): AcpChatMessage[] {
  const copy = messages.slice();
  copy[index] = { ...copy[index]!, ...patch };
  return copy;
}

let fallbackMessageCounter = 0;

function resolveMessageId(update: SessionUpdate, fallbackPrefix: string): string {
  const withId = update as { messageId?: string | null };
  if (typeof withId.messageId === "string" && withId.messageId.length > 0) {
    return withId.messageId;
  }
  fallbackMessageCounter += 1;
  return `${fallbackPrefix}-${fallbackMessageCounter}`;
}

function mergeToolCall(
  existing: AcpToolCallState | undefined,
  update: Partial<AcpToolCallState> & { toolCallId: string },
): AcpToolCallState {
  return {
    toolCallId: update.toolCallId,
    title: update.title ?? existing?.title ?? "Tool",
    kind: update.kind ?? existing?.kind,
    status: update.status ?? existing?.status,
    content: update.content ?? existing?.content,
    locations: update.locations ?? existing?.locations,
    rawInput: update.rawInput !== undefined ? update.rawInput : existing?.rawInput,
    rawOutput: update.rawOutput !== undefined ? update.rawOutput : existing?.rawOutput,
  };
}

/**
 * Apply a single session/update to session slice state.
 */
export function applySessionUpdate(state: AcpSessionSlice, update: SessionUpdate): AcpSessionSlice {
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const messageId = resolveMessageId(update, "assistant");
      const { messages, index } = ensureMessage(state.messages, messageId, "assistant");
      const chunk = contentText(update.content as { type?: string; text?: string });
      return {
        ...state,
        messages: updateMessage(messages, index, {
          text: messages[index]!.text + chunk,
          streaming: true,
        }),
        activeMsgId: messageId,
        isStreaming: true,
        titleChanged: false,
      };
    }
    case "agent_thought_chunk": {
      const messageId = resolveMessageId(update, "assistant");
      const { messages, index } = ensureMessage(state.messages, messageId, "assistant");
      const chunk = contentText(update.content as { type?: string; text?: string });
      return {
        ...state,
        messages: updateMessage(messages, index, {
          thought: messages[index]!.thought + chunk,
          streaming: true,
        }),
        activeMsgId: messageId,
        isStreaming: true,
        titleChanged: false,
      };
    }
    case "user_message_chunk": {
      const messageId = resolveMessageId(update, "user");
      const { messages, index } = ensureMessage(state.messages, messageId, "user");
      const chunk = contentText(update.content as { type?: string; text?: string });
      return {
        ...state,
        messages: updateMessage(messages, index, {
          text: messages[index]!.text + chunk,
          streaming: false,
        }),
        titleChanged: false,
      };
    }
    case "tool_call": {
      const toolCallId = update.toolCallId;
      const toolCalls = {
        ...state.toolCalls,
        [toolCallId]: mergeToolCall(state.toolCalls[toolCallId], {
          toolCallId,
          title: update.title,
          kind: update.kind,
          status: update.status ?? "pending",
          content: update.content,
          locations: update.locations as AcpToolCallState["locations"],
          rawInput: update.rawInput,
          rawOutput: update.rawOutput,
        }),
      };
      let messages = state.messages;
      const activeId = state.activeMsgId;
      if (activeId) {
        const idx = messages.findIndex((m) => m.id === activeId);
        if (idx >= 0 && !messages[idx]!.toolCallIds.includes(toolCallId)) {
          messages = updateMessage(messages, idx, {
            toolCallIds: [...messages[idx]!.toolCallIds, toolCallId],
          });
        }
      }
      return {
        ...state,
        toolCalls,
        messages,
        isStreaming: true,
        titleChanged: false,
      };
    }
    case "tool_call_update": {
      const toolCallId = update.toolCallId;
      const existing = state.toolCalls[toolCallId];
      return {
        ...state,
        toolCalls: {
          ...state.toolCalls,
          [toolCallId]: mergeToolCall(existing, {
            toolCallId,
            title: update.title ?? existing?.title,
            kind: update.kind ?? existing?.kind,
            status: update.status ?? existing?.status,
            content: update.content ?? existing?.content,
            locations: (update.locations as AcpToolCallState["locations"]) ?? existing?.locations,
            rawInput: update.rawInput !== undefined ? update.rawInput : existing?.rawInput,
            rawOutput: update.rawOutput !== undefined ? update.rawOutput : existing?.rawOutput,
          }),
        },
        titleChanged: false,
      };
    }
    case "plan": {
      return {
        ...state,
        plan: update.entries ?? [],
        titleChanged: false,
      };
    }
    case "plan_update": {
      // Full replace of entries when provided (ACP plan_update may be partial; treat as replace of entries).
      return {
        ...state,
        plan: update.entries ?? state.plan,
        titleChanged: false,
      };
    }
    case "plan_removed": {
      return { ...state, plan: null, titleChanged: false };
    }
    case "usage_update": {
      const used =
        typeof (update as { used?: number }).used === "number"
          ? (update as { used: number }).used
          : typeof (update as { size?: number }).size === "number"
            ? 0
            : (state.usage?.used ?? 0);
      const size =
        typeof (update as { size?: number }).size === "number"
          ? (update as { size: number }).size
          : (state.usage?.size ?? 0);
      const cost = (update as { cost?: AcpUsageState["cost"] }).cost;
      return {
        ...state,
        usage: {
          used: (update as { used?: number }).used ?? used,
          size,
          cost: cost ?? state.usage?.cost,
        },
        titleChanged: false,
      };
    }
    case "config_option_update": {
      return {
        ...state,
        configOptions: update.configOptions ?? [],
        titleChanged: false,
      };
    }
    case "available_commands_update": {
      return {
        ...state,
        commands: update.availableCommands ?? [],
        titleChanged: false,
      };
    }
    case "current_mode_update": {
      return {
        ...state,
        currentModeId: update.currentModeId ?? null,
        titleChanged: false,
      };
    }
    case "session_info_update": {
      const title =
        typeof (update as { title?: string | null }).title === "string"
          ? (update as { title: string }).title
          : null;
      return {
        ...state,
        title,
        titleChanged: title != null,
      };
    }
    default:
      return { ...state, titleChanged: false };
  }
}

/** Mark turn complete: stop streaming flags on messages. */
export function applyTurnStop(state: AcpSessionSlice): AcpSessionSlice {
  return {
    ...state,
    isStreaming: false,
    activeMsgId: null,
    messages: state.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
    titleChanged: false,
  };
}

/** Append a local user message optimistically before the agent echoes it. */
export function appendLocalUserMessage(
  state: AcpSessionSlice,
  text: string,
  id?: string,
): AcpSessionSlice {
  const messageId = id ?? `local-user-${Date.now()}`;
  return {
    ...state,
    messages: [
      ...state.messages,
      {
        id: messageId,
        role: "user",
        text,
        thought: "",
        toolCallIds: [],
        streaming: false,
      },
    ],
    isStreaming: true,
    titleChanged: false,
  };
}

/** Build ContentBlock[] for session/prompt from text + optional images/resources. */
export function assemblePromptBlocks(input: {
  message?: string;
  images?: Array<{ data: string; mimeType: string }>;
  resources?: Array<{
    uri: string;
    name?: string;
    mimeType?: string;
    text?: string;
  }>;
  prompt?: import("@agentclientprotocol/sdk").ContentBlock[];
  allowImage?: boolean;
  allowEmbeddedContext?: boolean;
}): import("@agentclientprotocol/sdk").ContentBlock[] {
  if (input.prompt && input.prompt.length > 0) {
    return input.prompt;
  }
  const blocks: import("@agentclientprotocol/sdk").ContentBlock[] = [];
  if (input.message && input.message.length > 0) {
    blocks.push({ type: "text", text: input.message });
  }
  if (input.allowImage !== false && input.images) {
    for (const image of input.images) {
      blocks.push({
        type: "image",
        data: image.data,
        mimeType: image.mimeType,
      });
    }
  }
  if (input.allowEmbeddedContext && input.resources) {
    for (const resource of input.resources) {
      if (resource.text != null) {
        blocks.push({
          type: "resource",
          resource: {
            uri: resource.uri,
            mimeType: resource.mimeType,
            text: resource.text,
          },
        });
      } else {
        blocks.push({
          type: "resource_link",
          uri: resource.uri,
          name: resource.name ?? resource.uri,
          mimeType: resource.mimeType,
        });
      }
    }
  } else if (input.resources) {
    for (const resource of input.resources) {
      blocks.push({
        type: "resource_link",
        uri: resource.uri,
        name: resource.name ?? resource.uri,
        mimeType: resource.mimeType,
      });
    }
  }
  return blocks;
}

/** Reset counter between tests. */
export function resetMessageIdCounter(): void {
  fallbackMessageCounter = 0;
}
