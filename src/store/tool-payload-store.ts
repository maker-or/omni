import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { AcpToolCallState } from "../../contracts/acp.ts";
import { estimateJsonBytes } from "../lib/session-retention";
import {
  hydrateToolCalls,
  mergeToolCallPayload,
  payloadFromSessionUpdate,
  type ToolCallPayload,
} from "../lib/tool-call-payload";

/**
 * Renderer copies of tool-call bodies (content/rawInput/rawOutput), keyed by
 * thread and tool-call id. Main keeps the authoritative bodies and serves
 * them through `agent.getToolCalls`, so everything here is a cache:
 *
 * - Retained bytes are bounded by a byte budget, evicting least recently used
 *   bodies first.
 * - Bodies of the displayed thread and of tool calls still in flight are
 *   pinned. In-flight bodies are assembled from partial streaming updates, so
 *   evicting one could leave a merged body missing fields.
 * - An evicted body reads as missing, which makes `resolveToolCalls` and the
 *   panel refetch it from main on demand. Later partial updates for an
 *   evicted id are dropped rather than stored as an incomplete body.
 */
export const DEFAULT_TOOL_PAYLOAD_BUDGET_BYTES = 16 * 1024 * 1024;

interface PayloadEntry {
  payload: ToolCallPayload;
  bytes: number;
  inFlight: boolean;
}

interface ThreadPayloads {
  entries: Map<string, PayloadEntry>;
  /** Ids evicted since they were last stored completely. */
  evicted: Set<string>;
}

const payloadsByThread = new Map<string, ThreadPayloads>();
/** Recency order over all threads; the first key is the least recently used. */
const recency = new Map<string, { threadId: string; toolCallId: string }>();
let retainedBytes = 0;
let budgetBytes = DEFAULT_TOOL_PAYLOAD_BUDGET_BYTES;
let pinnedThreadId: string | null = null;

const recencyKey = (threadId: string, toolCallId: string) => `${threadId}\u0000${toolCallId}`;

function threadPayloads(threadId: string): ThreadPayloads {
  const existing = payloadsByThread.get(threadId);
  if (existing) return existing;
  const created: ThreadPayloads = { entries: new Map(), evicted: new Set() };
  payloadsByThread.set(threadId, created);
  return created;
}

function isInFlight(status: AcpToolCallState["status"] | undefined): boolean {
  return status !== "completed" && status !== "failed";
}

function touch(threadId: string, toolCallId: string): void {
  const key = recencyKey(threadId, toolCallId);
  recency.delete(key);
  recency.set(key, { threadId, toolCallId });
}

function removeEntry(thread: ThreadPayloads, threadId: string, toolCallId: string): void {
  const entry = thread.entries.get(toolCallId);
  if (!entry) return;
  retainedBytes -= entry.bytes;
  thread.entries.delete(toolCallId);
  recency.delete(recencyKey(threadId, toolCallId));
}

function store(threadId: string, toolCallId: string, entry: Omit<PayloadEntry, "bytes">): void {
  const thread = threadPayloads(threadId);
  removeEntry(thread, threadId, toolCallId);
  const bytes = estimateJsonBytes(entry.payload);
  thread.entries.set(toolCallId, { ...entry, bytes });
  thread.evicted.delete(toolCallId);
  retainedBytes += bytes;
  touch(threadId, toolCallId);
  enforceBudget();
}

function enforceBudget(): void {
  if (retainedBytes <= budgetBytes) return;
  for (const [key, { threadId, toolCallId }] of recency) {
    if (retainedBytes <= budgetBytes) return;
    if (threadId === pinnedThreadId) continue;
    const thread = payloadsByThread.get(threadId);
    const entry = thread?.entries.get(toolCallId);
    if (!thread || !entry) {
      recency.delete(key);
      continue;
    }
    if (entry.inFlight) continue;
    removeEntry(thread, threadId, toolCallId);
    thread.evicted.add(toolCallId);
  }
}

export function rememberToolPayloadFromUpdate(threadId: string, update: SessionUpdate): void {
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") return;
  const extracted = payloadFromSessionUpdate(update);
  const thread = payloadsByThread.get(threadId);
  const existing = thread?.entries.get(update.toolCallId);
  if (!extracted) {
    // A status-only update can still settle an in-flight body, unpinning it.
    if (existing && update.status && existing.inFlight !== isInFlight(update.status)) {
      existing.inFlight = isInFlight(update.status);
      enforceBudget();
    }
    return;
  }
  // A partial update merged onto an evicted body would read as complete;
  // leave it missing so consumers refetch the whole body from main.
  if (thread?.evicted.has(extracted.toolCallId)) return;
  store(threadId, extracted.toolCallId, {
    payload: mergeToolCallPayload(existing?.payload, extracted.payload),
    inFlight: update.status ? isInFlight(update.status) : (existing?.inFlight ?? true),
  });
}

export function rememberHydratedToolCalls(
  threadId: string,
  toolCalls: Record<string, AcpToolCallState>,
): void {
  for (const [id, toolCall] of Object.entries(toolCalls)) {
    if (toolCall.content === undefined && toolCall.rawOutput === undefined) continue;
    const existing = payloadsByThread.get(threadId)?.entries.get(id);
    store(threadId, id, {
      payload: mergeToolCallPayload(existing?.payload, {
        content: toolCall.content,
        rawInput: toolCall.rawInput,
        rawOutput: toolCall.rawOutput,
      }),
      inFlight: isInFlight(toolCall.status),
    });
  }
}

/** Drop payloads whose tool call is no longer in the thread's tool-call map. */
export function syncToolPayloadIds(
  threadId: string,
  toolCalls: Record<string, AcpToolCallState>,
): void {
  const thread = payloadsByThread.get(threadId);
  if (!thread) return;
  for (const id of thread.entries.keys()) {
    if (!(id in toolCalls)) removeEntry(thread, threadId, id);
  }
  for (const id of thread.evicted) {
    if (!(id in toolCalls)) thread.evicted.delete(id);
  }
}

export function forgetThreadToolPayloads(threadId: string): void {
  const thread = payloadsByThread.get(threadId);
  if (!thread) return;
  for (const id of thread.entries.keys()) removeEntry(thread, threadId, id);
  payloadsByThread.delete(threadId);
}

/**
 * Pin the displayed thread's bodies. The previously displayed thread becomes
 * evictable, so switching away is what lets its bodies age out.
 */
export function setActiveToolPayloadThread(threadId: string | null): void {
  if (pinnedThreadId === threadId) return;
  pinnedThreadId = threadId;
  enforceBudget();
}

export function hydrateStoredToolCalls(
  threadId: string,
  toolCalls: Record<string, AcpToolCallState>,
): Record<string, AcpToolCallState> {
  const thread = payloadsByThread.get(threadId);
  if (!thread || thread.entries.size === 0) return toolCalls;
  const payloads = new Map<string, ToolCallPayload>();
  for (const id in toolCalls) {
    const entry = thread.entries.get(id);
    if (!entry) continue;
    payloads.set(id, entry.payload);
    touch(threadId, id);
  }
  if (payloads.size === 0) return toolCalls;
  return hydrateToolCalls(toolCalls, payloads);
}

export function toolCallsNeedHydration(toolCalls: Record<string, AcpToolCallState>): boolean {
  return Object.values(toolCalls).some(
    (toolCall) =>
      Boolean(toolCall.hasPayload || toolCall.hasDiff) &&
      toolCall.content === undefined &&
      toolCall.rawOutput === undefined,
  );
}

export function toolPayloadStoreStats(): {
  retainedBytes: number;
  budgetBytes: number;
  bodies: number;
  threads: number;
} {
  let bodies = 0;
  for (const thread of payloadsByThread.values()) bodies += thread.entries.size;
  return { retainedBytes, budgetBytes, bodies, threads: payloadsByThread.size };
}

/** Test and benchmark hook; production uses the default budget. */
export function setToolPayloadBudgetBytes(bytes: number): void {
  budgetBytes = bytes;
  enforceBudget();
}

export function resetToolPayloadStore(): void {
  payloadsByThread.clear();
  recency.clear();
  retainedBytes = 0;
  pinnedThreadId = null;
  budgetBytes = DEFAULT_TOOL_PAYLOAD_BUDGET_BYTES;
}
