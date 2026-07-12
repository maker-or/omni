/**
 * Projection from the ACP entry timeline to derived chat messages for views.
 *
 * Caching contract: a derived message keeps referential identity as long as
 * its underlying entries and referenced tool-call states are identical. The
 * reducer only replaces the tail text entry while streaming and replaces a
 * tool-call state object on update, so settled messages come back as the same
 * object every projection — memoized components (React Compiler) skip
 * re-rendering settled history on every streamed chunk.
 */

import type {
  AcpChatMessage,
  AcpEntry,
  AcpMessagePart,
  AcpToolCallState,
} from "../../contracts/acp.ts";

type ToolCallMap = Record<string, AcpToolCallState>;

/** Derived synthetic tool-result message consumed by AssistantTraceDeck. */
export interface AcpToolResultMessage {
  id: string;
  role: "toolResult";
  toolCallId: string;
  isError: boolean;
  content: string;
  terminalIds: string[];
}

function toolCallArgs(tc: AcpToolCallState): Record<string, unknown> {
  if (tc.rawInput && typeof tc.rawInput === "object" && !Array.isArray(tc.rawInput)) {
    return tc.rawInput as Record<string, unknown>;
  }
  return tc.rawInput !== undefined ? { input: tc.rawInput } : {};
}

/** Tool part per entry, cached against the referenced tool state object. */
const toolPartCache = new WeakMap<
  AcpEntry,
  { dep: AcpToolCallState | undefined; part: AcpMessagePart }
>();

function toolCallPart(
  entry: Extract<AcpEntry, { type: "tool_call" }>,
  tc: AcpToolCallState | undefined,
): AcpMessagePart {
  const cached = toolPartCache.get(entry);
  if (cached && cached.dep === tc) return cached.part;
  const part: AcpMessagePart = tc
    ? {
        type: "toolCall",
        id: tc.toolCallId,
        name: tc.title || tc.kind || "Tool",
        kind: tc.kind,
        arguments: toolCallArgs(tc),
        args: toolCallArgs(tc),
        status: tc.status,
        content: tc.content,
        rawOutput: tc.rawOutput,
      }
    : {
        type: "toolCall",
        id: entry.toolCallId,
        name: "Tool",
        arguments: {},
        args: {},
        status: "pending",
      };
  toolPartCache.set(entry, { dep: tc, part });
  return part;
}

const userMessageCache = new WeakMap<AcpEntry, AcpChatMessage>();

/** Assistant-run cache keyed by the run's first entry. */
const runCache = new WeakMap<AcpEntry, { deps: readonly unknown[]; msg: AcpChatMessage }>();

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

function projectAssistantRun(
  run: AcpEntry[],
  toolCalls: ToolCallMap,
  streaming: boolean,
): AcpChatMessage {
  const first = run[0]!;
  const deps: unknown[] = [streaming];
  for (const entry of run) {
    deps.push(entry);
    if (entry.type === "tool_call") deps.push(toolCalls[entry.toolCallId]);
  }
  const cached = runCache.get(first);
  if (cached && sameDeps(cached.deps, deps)) return cached.msg;

  const content: AcpMessagePart[] = [];
  const textSegments: string[] = [];
  const thoughtSegments: string[] = [];
  const toolCallIds: string[] = [];
  for (const entry of run) {
    if (entry.type === "agent_text") {
      if (entry.text) {
        content.push({ type: "text", text: entry.text });
        textSegments.push(entry.text);
      }
    } else if (entry.type === "agent_thought") {
      if (entry.text) {
        content.push({ type: "thinking", thinking: entry.text });
        thoughtSegments.push(entry.text);
      }
    } else if (entry.type === "tool_call") {
      content.push(toolCallPart(entry, toolCalls[entry.toolCallId]));
      toolCallIds.push(entry.toolCallId);
    }
  }
  const msg: AcpChatMessage = {
    id: first.id,
    role: "assistant",
    text: textSegments.join("\n\n"),
    thought: thoughtSegments.join("\n\n"),
    content,
    toolCallIds,
    streaming,
  };
  runCache.set(first, { deps, msg });
  return msg;
}

// Outer-walk cache: `entries` is append-only within a session (the reducer
// only ever concatenates onto it or replaces its tail entry in place — see
// appendTextEntry/ensureToolCallEntry in acp-session-reducer.ts), so once a
// message (a user_text entry, or an assistant run) is superseded by a later
// one, the entries backing it are referentially frozen forever. We remember
// the entries array from the last call, the index where its final message
// started, and the already-projected messages for everything before that
// final message. A later call can reuse that settled prefix outright and
// only re-walk from the boundary onward, turning the per-call cost from
// O(total entries) into O(size of the still-open run) regardless of total
// session history. If the array isn't a recognizable extension of the
// cached one (e.g. a session-state reset swapped in a new slice), we fall
// back to a full rescan from index 0.
let lastEntries: AcpEntry[] | undefined;
let lastBoundary = 0;
let lastPrefixMessages: AcpChatMessage[] = [];

/**
 * Project the timeline into chat messages: each `user_text` entry is a user
 * message; each maximal run of assistant entries (text/thought/tool) between
 * user messages is one assistant message with parts in timeline order. Only
 * the final run can be streaming.
 */
export function projectChatMessages(
  entries: AcpEntry[],
  toolCalls: ToolCallMap,
  isStreaming: boolean,
): AcpChatMessage[] {
  let i = 0;
  const messages: AcpChatMessage[] = [];
  if (
    lastEntries &&
    entries.length >= lastBoundary &&
    (lastBoundary === 0 || entries[lastBoundary - 1] === lastEntries[lastBoundary - 1])
  ) {
    // Everything before the previous final message is unchanged; reuse it
    // and only re-derive from where that final message started.
    i = lastBoundary;
    messages.push(...lastPrefixMessages);
  }
  let lastMessageStart = i;
  while (i < entries.length) {
    lastMessageStart = i;
    const entry = entries[i]!;
    if (entry.type === "user_text") {
      let msg = userMessageCache.get(entry);
      if (!msg) {
        msg = {
          id: entry.id,
          role: "user",
          text: entry.text,
          thought: "",
          content: entry.text ? [{ type: "text", text: entry.text }] : [],
          toolCallIds: [],
          streaming: false,
        };
        userMessageCache.set(entry, msg);
      }
      messages.push(msg);
      i += 1;
      continue;
    }
    const start = i;
    while (i < entries.length && entries[i]!.type !== "user_text") i += 1;
    const run = entries.slice(start, i);
    const streaming = isStreaming && i >= entries.length;
    messages.push(projectAssistantRun(run, toolCalls, streaming));
  }
  lastEntries = entries;
  lastBoundary = lastMessageStart;
  lastPrefixMessages = messages.slice(0, -1);
  return messages;
}

const toolResultCache = new WeakMap<AcpToolCallState, AcpToolResultMessage>();

/** Synthetic toolResult messages so AssistantTraceDeck can resolve completed tools. */
export function projectToolResultMessages(toolCalls: ToolCallMap): AcpToolResultMessage[] {
  const results: AcpToolResultMessage[] = [];
  for (const tc of Object.values(toolCalls)) {
    if (tc.status !== "completed" && tc.status !== "failed") continue;
    const cached = toolResultCache.get(tc);
    if (cached) {
      results.push(cached);
      continue;
    }
    const textParts: string[] = [];
    const terminalIds: string[] = [];
    for (const block of tc.content ?? []) {
      const typed = block as {
        type?: string;
        content?: { type?: string; text?: string };
        terminalId?: string;
        text?: string;
      };
      if (typed.type === "terminal" && typed.terminalId) {
        terminalIds.push(typed.terminalId);
        textParts.push(`[terminal:${typed.terminalId}]`);
      } else if (typed.type === "content" && typed.content?.type === "text") {
        textParts.push(typed.content.text ?? "");
      } else if (typed.type === "diff") {
        textParts.push("[diff]");
      } else if (typeof typed.text === "string") {
        textParts.push(typed.text);
      }
    }
    if (tc.rawOutput != null && textParts.length === 0) {
      textParts.push(
        typeof tc.rawOutput === "string" ? tc.rawOutput : JSON.stringify(tc.rawOutput),
      );
    }
    const result: AcpToolResultMessage = {
      id: `tool-result-${tc.toolCallId}`,
      role: "toolResult",
      toolCallId: tc.toolCallId,
      isError: tc.status === "failed",
      content: textParts.join("\n") || (tc.status === "failed" ? "Tool failed" : "OK"),
      terminalIds,
    };
    toolResultCache.set(tc, result);
    results.push(result);
  }
  return results;
}
