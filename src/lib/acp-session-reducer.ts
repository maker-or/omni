/**
 * Pure reducer for ACP session/update notifications.
 * Testable without Electron or a live agent process.
 *
 * State is an ordered entry timeline (`AcpEntry[]`) mirroring ACP's flat
 * stream of updates, plus a `toolCalls` record for by-id tool state. Text
 * chunks accumulate into the tail entry; tool calls append entries and are
 * updated in place via the record, so settled entries keep referential
 * identity while a turn streams (memoized views skip re-rendering them).
 */

import type {
  AvailableCommand,
  PlanEntry,
  SessionConfigOption,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
import type {
  AcpEntry,
  AcpRateLimitInfo,
  AcpToolCallState,
  AcpUsageState,
} from "../../contracts/acp.ts";

export interface AcpSessionSlice {
  entries: AcpEntry[];
  toolCalls: Record<string, AcpToolCallState>;
  plan: PlanEntry[] | null;
  usage: AcpUsageState | null;
  configOptions: SessionConfigOption[];
  commands: AvailableCommand[];
  currentModeId: string | null;
  isStreaming: boolean;
  /** Title from session_info_update; null means no change. */
  title: string | null;
  titleChanged: boolean;
}

export function createEmptySessionSlice(patch: Partial<AcpSessionSlice> = {}): AcpSessionSlice {
  return {
    entries: [],
    toolCalls: {},
    plan: null,
    usage: null,
    configOptions: [],
    commands: [],
    currentModeId: null,
    isStreaming: false,
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

let entryCounter = 0;

function nextEntryId(): string {
  entryCounter += 1;
  return `entry-${entryCounter}`;
}

type TextEntryType = "user_text" | "agent_text" | "agent_thought";

/**
 * Accumulate a content chunk into the timeline.
 *
 * ACP's `messageId` on chunks is optional. Agent text/thought chunks without
 * one continue the tail entry of the same type (a turn streams as one
 * message); an intervening tool call breaks continuation, starting a new
 * segment so interleaving order is preserved. A changed `messageId` starts a
 * new message per spec. User chunks only merge on an explicit matching
 * `messageId` — replayed history commonly arrives as one id-less chunk per
 * historical message, which must stay separate bubbles.
 */
function appendTextEntry(
  entries: AcpEntry[],
  type: TextEntryType,
  update: SessionUpdate,
): AcpEntry[] {
  const messageId = (update as { messageId?: string | null }).messageId ?? null;
  const chunk = contentText((update as { content?: { type?: string; text?: string } }).content);
  const last = entries[entries.length - 1];
  const continuesLast =
    last?.type === type &&
    (type === "user_text"
      ? messageId != null && last.messageId === messageId
      : messageId == null || last.messageId == null || last.messageId === messageId);

  if (continuesLast) {
    if (!chunk) return entries;
    const copy = entries.slice();
    const tail = last as Extract<AcpEntry, { type: TextEntryType }>;
    copy[copy.length - 1] = {
      ...tail,
      text: tail.text + chunk,
      messageId: tail.messageId ?? messageId,
    };
    return copy;
  }
  if (!chunk) return entries;
  return [...entries, { type, id: nextEntryId(), messageId, text: chunk }];
}

function mergeToolCall(
  existing: AcpToolCallState | undefined,
  update: Partial<AcpToolCallState> & { toolCallId: string },
): AcpToolCallState {
  const merged: AcpToolCallState = {
    toolCallId: update.toolCallId,
    title: update.title ?? existing?.title ?? "Tool",
    kind: update.kind ?? existing?.kind,
    status: update.status ?? existing?.status ?? "pending",
    content: update.content ?? existing?.content,
    locations: update.locations ?? existing?.locations,
    rawInput: update.rawInput !== undefined ? update.rawInput : existing?.rawInput,
    rawOutput: update.rawOutput !== undefined ? update.rawOutput : existing?.rawOutput,
  };
  if (
    existing &&
    merged.title === existing.title &&
    merged.kind === existing.kind &&
    merged.status === existing.status &&
    merged.content === existing.content &&
    merged.locations === existing.locations &&
    merged.rawInput === existing.rawInput &&
    merged.rawOutput === existing.rawOutput
  ) {
    return existing;
  }
  return merged;
}

/** Append a tool_call entry unless this toolCallId already has one. */
function ensureToolCallEntry(state: AcpSessionSlice, toolCallId: string): AcpEntry[] {
  if (state.toolCalls[toolCallId]) return state.entries;
  return [...state.entries, { type: "tool_call", id: nextEntryId(), toolCallId }];
}

/**
 * Apply a single session/update to session slice state.
 */
export function applySessionUpdate(state: AcpSessionSlice, update: SessionUpdate): AcpSessionSlice {
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      return {
        ...state,
        entries: appendTextEntry(state.entries, "agent_text", update),
        isStreaming: true,
        titleChanged: false,
      };
    }
    case "agent_thought_chunk": {
      return {
        ...state,
        entries: appendTextEntry(state.entries, "agent_thought", update),
        isStreaming: true,
        titleChanged: false,
      };
    }
    case "user_message_chunk": {
      // Some agents (e.g. Grok) echo the user's prompt back as a user_message_chunk
      // mid-turn. We already render an optimistic local user entry on send (see
      // appendLocalUserMessage), so the echo would append a duplicate row. When the
      // trailing entry is that optimistic message, swallow the echo — keeping the
      // optimistic entry's identity intact. On resume/history replay there is no
      // optimistic entry, so those user messages still append normally.
      const last = state.entries[state.entries.length - 1];
      if (last?.type === "user_text" && last.id.startsWith("local-user-")) {
        return { ...state, titleChanged: false };
      }
      return {
        ...state,
        entries: appendTextEntry(state.entries, "user_text", update),
        titleChanged: false,
      };
    }
    case "tool_call": {
      const toolCallId = update.toolCallId;
      const entries = ensureToolCallEntry(state, toolCallId);
      return {
        ...state,
        entries,
        toolCalls: {
          ...state.toolCalls,
          [toolCallId]: mergeToolCall(state.toolCalls[toolCallId], {
            toolCallId,
            title: update.title,
            kind: update.kind,
            status: update.status,
            content: update.content,
            locations: update.locations as AcpToolCallState["locations"],
            rawInput: update.rawInput,
            rawOutput: update.rawOutput,
          }),
        },
        isStreaming: true,
        titleChanged: false,
      };
    }
    case "tool_call_update": {
      const toolCallId = update.toolCallId;
      const existing = state.toolCalls[toolCallId];
      // An update for an unknown id (e.g. agent skipped the initial tool_call)
      // still gets a timeline entry so it renders instead of being orphaned.
      const entries = ensureToolCallEntry(state, toolCallId);
      return {
        ...state,
        entries,
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
        plan: (update as { entries?: PlanEntry[] }).entries ?? state.plan,
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
      // Vendor-specific subscription rate limit, when present. The Claude ACP
      // adapter attaches its `rate_limit_info` here on a `usage_update`. Absent
      // on ordinary token-usage updates, so preserve the last known value rather
      // than clearing it every turn; other agents never set it (stays null).
      const rateLimitMeta = (update as { _meta?: Record<string, unknown> })._meta?.[
        "_claude/rateLimit"
      ] as Partial<AcpRateLimitInfo> | undefined;
      // Claude reports utilization as a 0–1 fraction; normalize to a canonical
      // 0–100 percent here so downstream consumers never have to guess the scale.
      const rawUtilization = rateLimitMeta?.utilization;
      const utilization =
        typeof rawUtilization === "number" && !Number.isNaN(rawUtilization)
          ? rawUtilization * 100
          : undefined;
      const rateLimit: AcpUsageState["rateLimit"] = rateLimitMeta
        ? {
            status: rateLimitMeta.status ?? "allowed",
            rateLimitType: rateLimitMeta.rateLimitType,
            utilization,
            resetsAt: rateLimitMeta.resetsAt,
          }
        : (state.usage?.rateLimit ?? null);
      return {
        ...state,
        usage: {
          used: (update as { used?: number }).used ?? used,
          size,
          cost: cost ?? state.usage?.cost,
          rateLimit,
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

/** Mark turn complete. Streaming presentation derives from `isStreaming`. */
export function applyTurnStop(state: AcpSessionSlice): AcpSessionSlice {
  return {
    ...state,
    isStreaming: false,
    titleChanged: false,
  };
}

/** Append a local user message optimistically before the agent echoes it. */
export function appendLocalUserMessage(
  state: AcpSessionSlice,
  text: string,
  id?: string,
): AcpSessionSlice {
  const entryId = id ?? `local-user-${Date.now()}`;
  return {
    ...state,
    entries: [...state.entries, { type: "user_text", id: entryId, messageId: null, text }],
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
export function resetEntryIdCounter(): void {
  entryCounter = 0;
}
