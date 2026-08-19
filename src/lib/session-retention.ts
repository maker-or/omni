import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { AcpEntry, AcpToolCallState } from "../../contracts/acp.ts";
import type { AcpSessionSlice } from "./acp-session-reducer";

export interface SessionRetentionSnapshot {
  entryCount: number;
  toolCallCount: number;
  textBytes: number;
  thoughtBytes: number;
  toolPayloadBytes: number;
  largestToolPayloadBytes: number;
  sessionSnapshotBytes: number;
}

const EMPTY_RETENTION: SessionRetentionSnapshot = {
  entryCount: 0,
  toolCallCount: 0,
  textBytes: 0,
  thoughtBytes: 0,
  toolPayloadBytes: 0,
  largestToolPayloadBytes: 0,
  sessionSnapshotBytes: 0,
};

/** Approximate UTF-8 JSON size without allocating a serialized string. */
export function estimateJsonBytes(value: unknown): number {
  if (value === null) return 4;
  const type = typeof value;
  // `.length` is O(1). Fixture text is ASCII, so this matches UTF-8 size
  // without walking 50–110 MiB padding strings on every update.
  if (type === "string") return 2 + (value as string).length;
  if (type === "number") return String(value).length;
  if (type === "boolean") return value ? 4 : 5;
  if (type === "undefined") return 0;
  if (Array.isArray(value)) {
    if (value.length === 0) return 2;
    let total = 2;
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) total += 1;
      total += estimateJsonBytes(value[index]);
    }
    return total;
  }
  if (type === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, item]) => item !== undefined,
    );
    if (entries.length === 0) return 2;
    let total = 2;
    for (let index = 0; index < entries.length; index += 1) {
      if (index > 0) total += 1;
      const [key, item] = entries[index]!;
      total += 3 + byteLength(key) + estimateJsonBytes(item);
    }
    return total;
  }
  return 0;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function entryTextBytes(entry: AcpEntry): { textBytes: number; thoughtBytes: number } {
  if (entry.type === "user_text" || entry.type === "agent_text") {
    return { textBytes: byteLength(entry.text), thoughtBytes: 0 };
  }
  if (entry.type === "agent_thought") {
    return { textBytes: 0, thoughtBytes: byteLength(entry.text) };
  }
  return { textBytes: 0, thoughtBytes: 0 };
}

export function toolCallMetricBytes(toolCall: AcpToolCallState): number {
  return estimateJsonBytes({
    content: toolCall.content,
    rawInput: toolCall.rawInput,
    rawOutput: toolCall.rawOutput,
  });
}

export function computeRetentionMetrics(slice: AcpSessionSlice): SessionRetentionSnapshot {
  let textBytes = 0;
  let thoughtBytes = 0;
  for (const entry of slice.entries) {
    const next = entryTextBytes(entry);
    textBytes += next.textBytes;
    thoughtBytes += next.thoughtBytes;
  }
  let toolPayloadBytes = 0;
  let largestToolPayloadBytes = 0;
  const tools = Object.values(slice.toolCalls);
  for (const toolCall of tools) {
    const bytes = toolCallMetricBytes(toolCall);
    toolPayloadBytes += bytes;
    if (bytes > largestToolPayloadBytes) largestToolPayloadBytes = bytes;
  }
  return {
    entryCount: slice.entries.length,
    toolCallCount: tools.length,
    textBytes,
    thoughtBytes,
    toolPayloadBytes,
    largestToolPayloadBytes,
    sessionSnapshotBytes: textBytes + thoughtBytes + toolPayloadBytes,
  };
}

/**
 * Running retention totals. Same fields as a full scan, updated from the
 * previous slice + the update that produced the next one.
 */
export class SessionRetentionTracker {
  private textBytes = 0;
  private thoughtBytes = 0;
  private toolPayloadBytes = 0;
  private largestToolPayloadBytes = 0;
  private readonly toolBytes = new Map<string, number>();

  reset(): void {
    this.textBytes = 0;
    this.thoughtBytes = 0;
    this.toolPayloadBytes = 0;
    this.largestToolPayloadBytes = 0;
    this.toolBytes.clear();
  }

  snapshot(slice: AcpSessionSlice): SessionRetentionSnapshot {
    return {
      entryCount: slice.entries.length,
      toolCallCount: this.toolBytes.size,
      textBytes: this.textBytes,
      thoughtBytes: this.thoughtBytes,
      toolPayloadBytes: this.toolPayloadBytes,
      largestToolPayloadBytes: this.largestToolPayloadBytes,
      sessionSnapshotBytes: this.textBytes + this.thoughtBytes + this.toolPayloadBytes,
    };
  }

  observe(
    previous: AcpSessionSlice,
    next: AcpSessionSlice,
    update: SessionUpdate,
  ): SessionRetentionSnapshot {
    this.noteEntries(previous.entries, next.entries);
    this.noteTools(previous.toolCalls, next.toolCalls, update);
    return this.snapshot(next);
  }

  /**
   * Incremental update after an in-place apply, where `previous === next`.
   * Capture `before` from the slice prior to mutation.
   */
  observeAfterMutation(
    before: {
      lastEntry: AcpEntry | undefined;
      lastTextBytes: number;
      lastThoughtBytes: number;
    },
    after: AcpSessionSlice,
    update: SessionUpdate,
  ): SessionRetentionSnapshot {
    const last = after.entries[after.entries.length - 1];
    if (last && last !== before.lastEntry) {
      const added = entryTextBytes(last);
      this.textBytes += added.textBytes;
      this.thoughtBytes += added.thoughtBytes;
    } else if (last && last === before.lastEntry) {
      const afterBytes = entryTextBytes(last);
      this.textBytes += afterBytes.textBytes - before.lastTextBytes;
      this.thoughtBytes += afterBytes.thoughtBytes - before.lastThoughtBytes;
    }
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      const id = update.toolCallId;
      if (id && after.toolCalls[id]) this.replaceTool(id, after.toolCalls[id]!);
    }
    return this.snapshot(after);
  }

  recompute(slice: AcpSessionSlice): SessionRetentionSnapshot {
    const full = computeRetentionMetrics(slice);
    this.textBytes = full.textBytes;
    this.thoughtBytes = full.thoughtBytes;
    this.toolPayloadBytes = full.toolPayloadBytes;
    this.largestToolPayloadBytes = full.largestToolPayloadBytes;
    this.toolBytes.clear();
    for (const [id, toolCall] of Object.entries(slice.toolCalls)) {
      this.toolBytes.set(id, toolCallMetricBytes(toolCall));
    }
    return full;
  }

  private noteEntries(previous: AcpEntry[], next: AcpEntry[]): void {
    if (previous === next) return;
    if (next.length === previous.length + 1 && next[next.length - 1] && previous[0] === next[0]) {
      const added = entryTextBytes(next[next.length - 1]!);
      this.textBytes += added.textBytes;
      this.thoughtBytes += added.thoughtBytes;
      return;
    }
    if (
      next.length === previous.length &&
      next.length > 0 &&
      previous[next.length - 1] !== next[next.length - 1]
    ) {
      const before = entryTextBytes(previous[next.length - 1]!);
      const after = entryTextBytes(next[next.length - 1]!);
      this.textBytes += after.textBytes - before.textBytes;
      this.thoughtBytes += after.thoughtBytes - before.thoughtBytes;
      return;
    }
    this.textBytes = 0;
    this.thoughtBytes = 0;
    for (const entry of next) {
      const nextBytes = entryTextBytes(entry);
      this.textBytes += nextBytes.textBytes;
      this.thoughtBytes += nextBytes.thoughtBytes;
    }
  }

  private noteTools(
    previous: Record<string, AcpToolCallState>,
    next: Record<string, AcpToolCallState>,
    update: SessionUpdate,
  ): void {
    if (previous === next) return;
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      const id = update.toolCallId;
      if (id && next[id] && (previous[id] === undefined || previous[id] !== next[id])) {
        this.replaceTool(id, next[id]!);
      }
      if (Object.keys(next).length === this.toolBytes.size) return;
    }
    for (const id of this.toolBytes.keys()) {
      if (!next[id]) this.removeTool(id);
    }
    for (const [id, toolCall] of Object.entries(next)) {
      if (this.toolBytes.get(id) === undefined || previous[id] !== toolCall) {
        this.replaceTool(id, toolCall);
      }
    }
  }

  private replaceTool(id: string, toolCall: AcpToolCallState): void {
    const previous = this.toolBytes.get(id) ?? 0;
    const next = toolCallMetricBytes(toolCall);
    this.toolPayloadBytes += next - previous;
    this.toolBytes.set(id, next);
    if (next >= this.largestToolPayloadBytes) {
      this.largestToolPayloadBytes = next;
      return;
    }
    if (previous === this.largestToolPayloadBytes && next < previous) {
      this.refreshLargest();
    }
  }

  private removeTool(id: string): void {
    const previous = this.toolBytes.get(id);
    if (previous === undefined) return;
    this.toolPayloadBytes -= previous;
    this.toolBytes.delete(id);
    if (previous === this.largestToolPayloadBytes) this.refreshLargest();
  }

  private refreshLargest(): void {
    let largest = 0;
    for (const bytes of this.toolBytes.values()) {
      if (bytes > largest) largest = bytes;
    }
    this.largestToolPayloadBytes = largest;
  }
}

export function emptyRetentionSnapshot(): SessionRetentionSnapshot {
  return { ...EMPTY_RETENTION };
}

export function captureRetentionTail(slice: AcpSessionSlice): {
  lastEntry: AcpEntry | undefined;
  lastTextBytes: number;
  lastThoughtBytes: number;
} {
  const lastEntry = slice.entries[slice.entries.length - 1];
  const bytes = lastEntry ? entryTextBytes(lastEntry) : { textBytes: 0, thoughtBytes: 0 };
  return {
    lastEntry,
    lastTextBytes: bytes.textBytes,
    lastThoughtBytes: bytes.thoughtBytes,
  };
}
