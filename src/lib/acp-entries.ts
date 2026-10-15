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
        outputPreview: tc.outputPreview,
        hasPayload: tc.hasPayload,
        hasDiff: tc.hasDiff,
        terminalIds: tc.terminalIds,
        ...(tc.content ? { content: tc.content } : {}),
        ...(tc.rawOutput !== undefined ? { rawOutput: tc.rawOutput } : {}),
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

function projectUserMessage(entry: Extract<AcpEntry, { type: "user_text" }>): AcpChatMessage {
  let msg = userMessageCache.get(entry);
  if (!msg) {
    msg = {
      id: entry.id,
      role: "user",
      text: entry.text,
      thought: "",
      content: [
        ...(entry.text ? [{ type: "text" as const, text: entry.text }] : []),
        ...(entry.images ?? []).map((image) => ({ type: "image" as const, ...image })),
      ],
      toolCallIds: [],
      streaming: false,
    };
    userMessageCache.set(entry, msg);
  }
  return msg;
}

/**
 * Project the timeline into chat messages: each `user_text` entry is a user
 * message; each maximal run of assistant entries (text/thought/tool) between
 * user messages is one assistant message with parts in timeline order. Only
 * the final run can be streaming.
 *
 * This is the stateless reference walk (O(entries) per call). The panel uses
 * {@link createChatProjector}, which produces the same messages incrementally.
 */
export function projectChatMessages(
  entries: AcpEntry[],
  toolCalls: ToolCallMap,
  isStreaming: boolean,
): AcpChatMessage[] {
  const messages: AcpChatMessage[] = [];
  let i = 0;
  while (i < entries.length) {
    const entry = entries[i]!;
    if (entry.type === "user_text") {
      messages.push(projectUserMessage(entry));
      i += 1;
      continue;
    }
    const start = i;
    while (i < entries.length && entries[i]!.type !== "user_text") i += 1;
    const streaming = isStreaming && i >= entries.length;
    messages.push(projectAssistantRun(entries.slice(start, i), toolCalls, streaming));
  }
  return messages;
}

/** Ids whose tool state object differs between two tool-call maps. */
function changedToolIds(previous: ToolCallMap, next: ToolCallMap): string[] {
  const changed: string[] = [];
  for (const id in next) {
    if (previous[id] !== next[id]) changed.push(id);
  }
  for (const id in previous) {
    if (!(id in next)) changed.push(id);
  }
  return changed;
}

function pushToMap(map: Map<string, number[]>, key: string, value: number): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * The still-open final assistant run. Every entry of the run except the tail
 * is "folded" into immutable part/segment arrays; the tail is re-read on each
 * projection because the reducer replaces it as text streams.
 */
interface OpenRun {
  start: number;
  /** Entries [start, start + folded) are folded into the fields below. */
  folded: number;
  content: AcpMessagePart[];
  /** Joined visible text of the folded entries ("" when none). */
  text: string;
  hasText: boolean;
  thought: string;
  hasThought: boolean;
  toolCallIds: string[];
  /** toolCallId -> indices into `content` / `entries` for folded tool parts. */
  toolParts: Map<string, Array<{ part: number; entry: number }>>;
}

function openRun(start: number): OpenRun {
  return {
    start,
    folded: 0,
    content: [],
    text: "",
    hasText: false,
    thought: "",
    hasThought: false,
    toolCallIds: [],
    toolParts: new Map(),
  };
}

function joinSegment(joined: string, has: boolean, segment: string): string {
  return has ? `${joined}\n\n${segment}` : segment;
}

/** Fold entries [run.start + run.folded, end) into the run's immutable prefix. */
function foldRun(run: OpenRun, entries: AcpEntry[], end: number, toolCalls: ToolCallMap): void {
  let index = run.start + run.folded;
  if (index >= end) return;
  const content = run.content.slice();
  let toolCallIds = run.toolCallIds;
  for (; index < end; index++) {
    const entry = entries[index]!;
    if (entry.type === "agent_text") {
      if (!entry.text) continue;
      content.push({ type: "text", text: entry.text });
      run.text = joinSegment(run.text, run.hasText, entry.text);
      run.hasText = true;
    } else if (entry.type === "agent_thought") {
      if (!entry.text) continue;
      content.push({ type: "thinking", thinking: entry.text });
      run.thought = joinSegment(run.thought, run.hasThought, entry.text);
      run.hasThought = true;
    } else if (entry.type === "tool_call") {
      const list = run.toolParts.get(entry.toolCallId) ?? [];
      list.push({ part: content.length, entry: index });
      run.toolParts.set(entry.toolCallId, list);
      content.push(toolCallPart(entry, toolCalls[entry.toolCallId]));
      if (toolCallIds === run.toolCallIds) toolCallIds = toolCallIds.slice();
      toolCallIds.push(entry.toolCallId);
    }
  }
  run.content = content;
  run.toolCallIds = toolCallIds;
  run.folded = end - run.start;
}

/** Build the open run's message from its folded prefix plus the live tail entry. */
function projectOpenRun(
  run: OpenRun,
  entries: AcpEntry[],
  toolCalls: ToolCallMap,
  streaming: boolean,
): AcpChatMessage {
  const tail = entries[entries.length - 1]!;
  let content = run.content;
  let text = run.text;
  let thought = run.thought;
  let toolCallIds = run.toolCallIds;
  if (tail.type === "agent_text") {
    if (tail.text) {
      content = [...content, { type: "text", text: tail.text }];
      text = joinSegment(text, run.hasText, tail.text);
    }
  } else if (tail.type === "agent_thought") {
    if (tail.text) {
      content = [...content, { type: "thinking", thinking: tail.text }];
      thought = joinSegment(thought, run.hasThought, tail.text);
    }
  } else if (tail.type === "tool_call") {
    content = [...content, toolCallPart(tail, toolCalls[tail.toolCallId])];
    toolCallIds = [...toolCallIds, tail.toolCallId];
  }
  return {
    id: entries[run.start]!.id,
    role: "assistant",
    text,
    thought,
    // Never hand out the run's own arrays: folding replaces them, but a
    // consumer must not be able to observe a later fold through this message.
    content: content === run.content ? content.slice() : content,
    toolCallIds: toolCallIds === run.toolCallIds ? toolCallIds.slice() : toolCallIds,
    streaming,
  };
}

export interface ChatProjection {
  /**
   * Every message except a streaming assistant tail, in timeline order. Keeps
   * its identity while only the streaming tail (or nothing) changes.
   */
  settled: AcpChatMessage[];
  /** The final assistant message while the turn streams, else null. */
  streaming: AcpChatMessage | null;
}

interface ProjectorState {
  entries: AcpEntry[];
  toolCalls: ToolCallMap;
  isStreaming: boolean;
  /** Closed messages: everything before the final (open) message. */
  closed: AcpChatMessage[];
  /** Entry range of each closed assistant message (null for user messages). */
  closedRanges: Array<{ start: number; end: number } | null>;
  /** toolCallId -> indices into `closed` of assistant messages containing it. */
  closedToolOwners: Map<string, number[]>;
  /** Final message: a user entry index, or an open assistant run. */
  open: { kind: "user"; start: number } | { kind: "run"; run: OpenRun } | null;
  final: AcpChatMessage | null;
  /** Tail entry and its tool state the final message was built from. */
  finalTail: AcpEntry | undefined;
  finalTailTool: AcpToolCallState | undefined;
  result: ChatProjection;
}

/**
 * Whether `entries` is the previous timeline extended by the reducer: the
 * reducer only appends or replaces the tail entry with one of the same type.
 * Anything else (session-state replacement, front trimming) re-projects.
 */
function extendsTimeline(previous: AcpEntry[], entries: AcpEntry[]): boolean {
  const length = previous.length;
  if (entries.length < length) return false;
  if (length === 0) return true;
  if (entries[0] !== previous[0]) return false;
  if (length >= 2 && entries[length - 2] !== previous[length - 2]) return false;
  return entries[length - 1]!.type === previous[length - 1]!.type;
}

/**
 * Incremental equivalent of {@link projectChatMessages}. Per streamed text
 * chunk the work is proportional to the open run's folded part count (one
 * array copy) rather than to the whole history: closed messages are kept,
 * new entries are folded once, and tool-state changes are routed only to the
 * messages that contain the changed tool.
 */
export function createChatProjector(): (
  entries: AcpEntry[],
  toolCalls: ToolCallMap,
  isStreaming: boolean,
) => ChatProjection {
  let state: ProjectorState | null = null;

  function closeOpen(
    s: ProjectorState,
    entries: AcpEntry[],
    end: number,
    toolCalls: ToolCallMap,
  ): void {
    const open = s.open;
    if (!open) return;
    const index = s.closed.length;
    if (open.kind === "user") {
      s.closed.push(
        projectUserMessage(entries[open.start] as Extract<AcpEntry, { type: "user_text" }>),
      );
      s.closedRanges.push(null);
    } else {
      const start = open.run.start;
      s.closed.push(projectAssistantRun(entries.slice(start, end), toolCalls, false));
      s.closedRanges.push({ start, end });
      for (let i = start; i < end; i++) {
        const entry = entries[i]!;
        if (entry.type === "tool_call") pushToMap(s.closedToolOwners, entry.toolCallId, index);
      }
    }
    s.open = null;
  }

  return (entries, toolCalls, isStreaming) => {
    const previous = state;
    if (
      previous &&
      previous.entries === entries &&
      previous.toolCalls === toolCalls &&
      previous.isStreaming === isStreaming
    ) {
      return previous.result;
    }

    let s: ProjectorState;
    let scanFrom: number;
    let closed: AcpChatMessage[];
    if (previous && extendsTimeline(previous.entries, entries)) {
      s = previous;
      scanFrom = previous.entries.length;
      closed = previous.closed;
    } else {
      s = {
        entries,
        toolCalls,
        isStreaming,
        closed: [],
        closedRanges: [],
        closedToolOwners: new Map(),
        open: null,
        final: null,
        finalTail: undefined,
        finalTailTool: undefined,
        result: { settled: [], streaming: null },
      };
      scanFrom = 0;
      closed = s.closed;
    }
    // Closed messages are published by identity; copy on first write.
    let closedCopied = s !== previous;
    const writableClosed = () => {
      if (!closedCopied) {
        s.closed = s.closed.slice();
        closedCopied = true;
      }
      return s.closed;
    };

    // Route tool-state changes to the closed messages and folded parts that
    // contain them. Text chunks leave `toolCalls` untouched and skip this.
    let foldedToolChanged = false;
    if (s === previous && previous.toolCalls !== toolCalls) {
      for (const id of changedToolIds(previous.toolCalls, toolCalls)) {
        for (const index of s.closedToolOwners.get(id) ?? []) {
          const range = s.closedRanges[index]!;
          writableClosed()[index] = projectAssistantRun(
            entries.slice(range.start, range.end),
            toolCalls,
            false,
          );
        }
        if (s.open?.kind === "run") {
          const run = s.open.run;
          const parts = run.toolParts.get(id);
          if (parts) {
            run.content = run.content.slice();
            for (const { part, entry } of parts) {
              run.content[part] = toolCallPart(
                entries[entry] as Extract<AcpEntry, { type: "tool_call" }>,
                toolCalls[id],
              );
            }
            foldedToolChanged = true;
          }
        }
      }
    }

    // Walk only entries appended since the last projection.
    for (let i = scanFrom; i < entries.length; i++) {
      const entry = entries[i]!;
      if (entry.type === "user_text") {
        if (s.open) {
          writableClosed();
          closeOpen(s, entries, i, toolCalls);
        }
        s.open = { kind: "user", start: i };
      } else if (s.open?.kind !== "run") {
        if (s.open) {
          writableClosed();
          closeOpen(s, entries, i, toolCalls);
        }
        s.open = { kind: "run", run: openRun(i) };
      }
    }

    // Rebuild the final message only when something it depends on changed.
    const tail = entries[entries.length - 1];
    let final = s.final;
    const open = s.open;
    if (!open) {
      final = null;
    } else if (open.kind === "user") {
      final = projectUserMessage(entries[open.start] as Extract<AcpEntry, { type: "user_text" }>);
    } else {
      const run = open.run;
      const foldedBefore = run.folded;
      foldRun(run, entries, entries.length - 1, toolCalls);
      const tailTool = tail?.type === "tool_call" ? toolCalls[tail.toolCallId] : undefined;
      if (
        !final ||
        s !== previous ||
        foldedToolChanged ||
        run.folded !== foldedBefore ||
        tail !== s.finalTail ||
        tailTool !== s.finalTailTool ||
        isStreaming !== previous?.isStreaming
      ) {
        final = projectOpenRun(run, entries, toolCalls, isStreaming);
      }
      s.finalTailTool = tailTool;
    }
    s.finalTail = tail;

    const streamingFinal = final && final.role === "assistant" && final.streaming ? final : null;
    const settledFinal = final && !streamingFinal ? final : null;
    const previousSettledFinal = s.result.streaming ? null : s.final;
    let settled = s.result.settled;
    if (s !== previous || s.closed !== closed || settledFinal !== previousSettledFinal) {
      settled = settledFinal ? [...s.closed, settledFinal] : s.closed;
    }
    s.final = final;
    s.entries = entries;
    s.toolCalls = toolCalls;
    s.isStreaming = isStreaming;
    s.result =
      settled === s.result.settled && streamingFinal === s.result.streaming
        ? s.result
        : { settled, streaming: streamingFinal };
    state = s;
    return s.result;
  };
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
    const terminalIds = [...(tc.terminalIds ?? [])];
    for (const block of tc.content ?? []) {
      const typed = block as {
        type?: string;
        content?: { type?: string; text?: string };
        terminalId?: string;
        text?: string;
      };
      if (typed.type === "terminal" && typed.terminalId) {
        if (!terminalIds.includes(typed.terminalId)) terminalIds.push(typed.terminalId);
        textParts.push(`[terminal:${typed.terminalId}]`);
      } else if (typed.type === "content" && typed.content?.type === "text") {
        textParts.push(typed.content.text ?? "");
      } else if (typed.type === "diff") {
        textParts.push("[diff]");
      } else if (typeof typed.text === "string") {
        textParts.push(typed.text);
      }
    }
    if (textParts.length === 0 && typeof tc.rawOutput === "string") {
      textParts.push(tc.rawOutput);
    } else if (textParts.length === 0 && tc.outputPreview) {
      textParts.push(tc.outputPreview);
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
