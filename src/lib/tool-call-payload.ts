import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { AcpToolCallState } from "../../contracts/acp.ts";

export const TOOL_OUTPUT_PREVIEW_CHARS = 256;

export interface ToolCallPayload {
  content?: AcpToolCallState["content"];
  rawInput?: unknown;
  rawOutput?: unknown;
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function compactUnknown(value: unknown, maxLength: number): string {
  if (typeof value === "string") return compactText(value, maxLength);
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    const preview = keys.slice(0, 6).join(", ");
    return keys.length > 6 ? `{${preview}, …}` : `{${preview}}`;
  }
  if (value == null) return "";
  return compactText(String(value), maxLength);
}

export function extractTerminalIds(content: unknown): string[] {
  const ids: string[] = [];
  visitContent(content, (block) => {
    if (block.type === "terminal" && typeof block.terminalId === "string") {
      ids.push(block.terminalId);
    }
  });
  return ids;
}

export function contentHasDiff(content: unknown): boolean {
  let found = false;
  visitContent(content, (block) => {
    if (found) return;
    const type = typeof block.type === "string" ? block.type.toLowerCase() : "";
    if (
      type.includes("diff") ||
      type.includes("edit") ||
      (typeof block.path === "string" && typeof block.newText === "string")
    ) {
      found = true;
    }
  });
  return found;
}

export function previewFromToolBodies(
  content: AcpToolCallState["content"] | undefined,
  rawOutput: unknown,
): string {
  let text = "";
  visitContent(content, (block) => {
    if (text) return;
    const nested = block.content;
    if (nested && typeof nested === "object" && typeof nested.text === "string" && nested.text) {
      text = nested.text;
      return;
    }
    if (typeof block.text === "string" && block.text) text = block.text;
  });
  if (text) return compactText(text, TOOL_OUTPUT_PREVIEW_CHARS);
  return compactUnknown(rawOutput, TOOL_OUTPUT_PREVIEW_CHARS);
}

function visitContent(value: unknown, visit: (block: Record<string, any>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) visitContent(item, visit);
    return;
  }
  if (!value || typeof value !== "object") return;
  visit(value as Record<string, any>);
  const record = value as Record<string, unknown>;
  if ("content" in record) visitContent(record.content, visit);
}

export function toLeanToolCall(state: AcpToolCallState): AcpToolCallState {
  const hasBody = state.content !== undefined || state.rawOutput !== undefined;
  if (!hasBody && state.outputPreview === undefined && state.hasPayload === undefined) {
    return state;
  }
  const preview = hasBody
    ? previewFromToolBodies(state.content, state.rawOutput)
    : (state.outputPreview ?? "");
  const terminalIds = hasBody ? extractTerminalIds(state.content) : (state.terminalIds ?? []);
  const lean: AcpToolCallState = {
    toolCallId: state.toolCallId,
    title: state.title,
    kind: state.kind,
    status: state.status,
    locations: state.locations,
    rawInput: state.rawInput,
  };
  if (preview) lean.outputPreview = preview;
  if (hasBody || state.hasPayload) lean.hasPayload = true;
  if (state.hasDiff || (hasBody && contentHasDiff(state.content))) lean.hasDiff = true;
  if (terminalIds.length > 0) lean.terminalIds = terminalIds;
  return lean;
}

export function leanToolCallsEqual(left: AcpToolCallState, right: AcpToolCallState): boolean {
  return (
    left.toolCallId === right.toolCallId &&
    left.title === right.title &&
    left.kind === right.kind &&
    left.status === right.status &&
    left.locations === right.locations &&
    left.rawInput === right.rawInput &&
    left.outputPreview === right.outputPreview &&
    left.hasPayload === right.hasPayload &&
    left.hasDiff === right.hasDiff &&
    sameIds(left.terminalIds, right.terminalIds)
  );
}

function sameIds(left: string[] | undefined, right: string[] | undefined): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}

export function payloadFromSessionUpdate(update: SessionUpdate): {
  toolCallId: string;
  payload: ToolCallPayload;
} | null {
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") {
    return null;
  }
  const toolCallId = update.toolCallId;
  if (!toolCallId) return null;
  const payload: ToolCallPayload = {};
  if (update.content !== undefined) payload.content = update.content as AcpToolCallState["content"];
  if (update.rawInput !== undefined) payload.rawInput = update.rawInput;
  if (update.rawOutput !== undefined) payload.rawOutput = update.rawOutput;
  if (
    payload.content === undefined &&
    payload.rawInput === undefined &&
    payload.rawOutput === undefined
  ) {
    return null;
  }
  return { toolCallId, payload };
}

export function mergeToolCallPayload(
  existing: ToolCallPayload | undefined,
  patch: ToolCallPayload,
): ToolCallPayload {
  return {
    content: patch.content !== undefined ? patch.content : existing?.content,
    rawInput: patch.rawInput !== undefined ? patch.rawInput : existing?.rawInput,
    rawOutput: patch.rawOutput !== undefined ? patch.rawOutput : existing?.rawOutput,
  };
}

export function hydrateToolCall(
  lean: AcpToolCallState,
  payload: ToolCallPayload | undefined,
): AcpToolCallState {
  if (!payload) return lean;
  return {
    ...lean,
    content: payload.content ?? lean.content,
    rawInput: payload.rawInput !== undefined ? payload.rawInput : lean.rawInput,
    rawOutput: payload.rawOutput !== undefined ? payload.rawOutput : lean.rawOutput,
  };
}

export function hydrateToolCalls(
  toolCalls: Record<string, AcpToolCallState>,
  payloads: ReadonlyMap<string, ToolCallPayload> | Record<string, ToolCallPayload>,
): Record<string, AcpToolCallState> {
  const get =
    payloads instanceof Map
      ? (id: string) => payloads.get(id)
      : (id: string) => (payloads as Record<string, ToolCallPayload>)[id];
  const next: Record<string, AcpToolCallState> = {};
  for (const [id, toolCall] of Object.entries(toolCalls)) {
    next[id] = hydrateToolCall(toolCall, get(id));
  }
  return next;
}
