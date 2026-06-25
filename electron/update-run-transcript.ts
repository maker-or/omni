import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentBridgeEvent } from "../contracts/agent.ts";
import { getUpdatesPath } from "./workspace-manager.ts";

const MAX_STRING_CHARS = 16_000;
const MAX_SERIALIZED_CHARS = 64_000;

export function getRunTranscriptPath(runId: string): string {
  return join(getUpdatesPath(), "logs", `${runId}.transcript.jsonl`);
}

export type TranscriptEntry =
  | { kind: "prompt"; text: string }
  | { kind: "bridge"; payload: unknown }
  | { kind: "session_messages"; label: string; messages: unknown[] }
  | { kind: "note"; message: string };

export function truncateForTranscript(value: unknown, depth = 0): unknown {
  if (depth > 10) return "[max-depth]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length <= MAX_STRING_CHARS) return value;
    return `${value.slice(0, MAX_STRING_CHARS)}…[truncated ${value.length - MAX_STRING_CHARS} chars]`;
  }
  if (Array.isArray(value)) {
    return value.map((item) => truncateForTranscript(item, depth + 1));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      next[key] = truncateForTranscript(child, depth + 1);
    }
    return next;
  }
  return String(value);
}

export function appendUpdateRunTranscript(runId: string, entry: TranscriptEntry): void {
  const path = getRunTranscriptPath(runId);
  mkdirSync(dirname(path), { recursive: true });
  const payload = truncateForTranscript(entry) as TranscriptEntry;
  let line = JSON.stringify({ at: new Date().toISOString(), ...payload });
  if (line.length > MAX_SERIALIZED_CHARS) {
    line = `${line.slice(0, MAX_SERIALIZED_CHARS)}…[truncated json]`;
  }
  appendFileSync(path, `${line}\n`, "utf8");
}

export function serializeBridgeEvent(payload: AgentBridgeEvent): unknown {
  if (payload.type === "snapshot") {
    return {
      type: "snapshot",
      sessionId: payload.snapshot.sessionId,
      isStreaming: payload.snapshot.isStreaming,
      model: payload.snapshot.model,
      messages: payload.snapshot.messages,
      streamingMessage: payload.snapshot.streamingMessage,
      stats: payload.snapshot.stats,
      status: payload.snapshot.status,
      workingMessage: payload.snapshot.workingMessage,
    };
  }
  return payload;
}

export function textFromMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      if (typeof record.content === "string") return record.content;
      return "";
    })
    .join("")
    .trim();
}

export function extractAssistantSummaryFromMessages(messages: unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") continue;
    const record = message as Record<string, unknown>;
    if (record.role !== "assistant") continue;
    const text = textFromMessageContent(record.content);
    if (text) return text;
  }
  return "";
}

export function extractAssistantSummaryFromAgentEnd(event: unknown): string {
  if (!event || typeof event !== "object") return "";
  const messages = (event as Record<string, unknown>).messages;
  if (!Array.isArray(messages)) return "";
  return extractAssistantSummaryFromMessages(messages);
}
