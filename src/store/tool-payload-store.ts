import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { AcpToolCallState } from "../../contracts/acp.ts";
import {
  hydrateToolCalls,
  mergeToolCallPayload,
  payloadFromSessionUpdate,
  type ToolCallPayload,
} from "../lib/tool-call-payload";

const payloadsByThread = new Map<string, Map<string, ToolCallPayload>>();

function threadMap(threadId: string): Map<string, ToolCallPayload> {
  const existing = payloadsByThread.get(threadId);
  if (existing) return existing;
  const created = new Map<string, ToolCallPayload>();
  payloadsByThread.set(threadId, created);
  return created;
}

export function rememberToolPayloadFromUpdate(threadId: string, update: SessionUpdate): void {
  const extracted = payloadFromSessionUpdate(update);
  if (!extracted) return;
  const payloads = threadMap(threadId);
  payloads.set(
    extracted.toolCallId,
    mergeToolCallPayload(payloads.get(extracted.toolCallId), extracted.payload),
  );
}

export function rememberHydratedToolCalls(
  threadId: string,
  toolCalls: Record<string, AcpToolCallState>,
): void {
  const payloads = threadMap(threadId);
  for (const [id, toolCall] of Object.entries(toolCalls)) {
    if (toolCall.content === undefined && toolCall.rawOutput === undefined) continue;
    payloads.set(
      id,
      mergeToolCallPayload(payloads.get(id), {
        content: toolCall.content,
        rawInput: toolCall.rawInput,
        rawOutput: toolCall.rawOutput,
      }),
    );
  }
}

export function syncToolPayloadIds(threadId: string, ids: Iterable<string>): void {
  const payloads = payloadsByThread.get(threadId);
  if (!payloads) return;
  const keep = new Set(ids);
  for (const id of payloads.keys()) {
    if (!keep.has(id)) payloads.delete(id);
  }
}

export function forgetThreadToolPayloads(threadId: string): void {
  payloadsByThread.delete(threadId);
}

export function hydrateStoredToolCalls(
  threadId: string,
  toolCalls: Record<string, AcpToolCallState>,
): Record<string, AcpToolCallState> {
  const payloads = payloadsByThread.get(threadId);
  if (!payloads || payloads.size === 0) return toolCalls;
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

export function resetToolPayloadStore(): void {
  payloadsByThread.clear();
}
