import { create } from "zustand";
import { parseDiffFromFile } from "@pierre/diffs";
import type { AcpToolCallState } from "../../contracts/acp.ts";

export interface DiffFileEntry {
  path: string;
  oldText: string;
  newText: string;
  updatedAt: number;
}

export interface DiffSummaryFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface DiffTurnSummary {
  /** First ACP tool-call id from the turn; not a new ACP turn id. */
  key: string;
  files: DiffSummaryFile[];
  additions: number;
  deletions: number;
}

export interface DiffThreadState {
  files: Record<string, DiffFileEntry>;
  order: string[];
  activePath: string | null;
  unseenCount: number;
  summaries: Record<string, DiffTurnSummary>;
  /** Content fingerprints only; retaining full tool-call payloads duplicated the agent store. */
  lastSeenToolCallVersions: Record<string, string>;
}

export interface DiffIngestionMetrics {
  toolCallCount: number;
  serializedUtf16Bytes: number;
  extractedFileCount: number;
  changedFileCount: number;
  durationMs: number;
  fileCount: number;
}

interface DiffState {
  /** Active thread projection kept for existing DiffView consumers. */
  threadId: string | null;
  files: Record<string, DiffFileEntry>;
  order: string[];
  activePath: string | null;
  isOpen: boolean;
  unseenCount: number;
  summaries: Record<string, DiffTurnSummary>;
  /** Durable-in-memory diff state for every thread seen by the renderer. */
  threads: Record<string, DiffThreadState>;
  ingestToolCalls: (
    threadId: string | null,
    toolCalls: Record<string, AcpToolCallState>,
    isActive?: boolean,
  ) => DiffIngestionMetrics | null;
  recordTurnSummary: (
    threadId: string | null,
    key: string,
    toolCalls: Record<string, AcpToolCallState>,
  ) => DiffTurnSummary | null;
  activateThread: (threadId: string | null) => void;
  setActivePath: (path: string) => void;
  open: () => void;
  close: () => void;
  clear: () => void;
  markSeen: () => void;
}

const emptyThreadState = (): DiffThreadState => ({
  files: {},
  order: [],
  activePath: null,
  unseenCount: 0,
  summaries: {},
  lastSeenToolCallVersions: {},
});

const MAX_RETAINED_THREADS = 100;

function extractDiffs(
  value: unknown,
  output: Array<{ path: string; oldText: string; newText: string }>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) extractDiffs(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;

  const block = value as Record<string, unknown>;
  const type = typeof block.type === "string" ? block.type.toLowerCase() : "";
  const path = [block.path, block.filePath, block.file, block.filename].find(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  const newText = [block.newText, block.new_text, block.newContent, block.new_content].find(
    (entry): entry is string => typeof entry === "string",
  );
  const oldText = [block.oldText, block.old_text, block.oldContent, block.old_content].find(
    (entry): entry is string => typeof entry === "string",
  );
  const looksLikeDiff =
    type.includes("diff") ||
    type.includes("edit") ||
    ("newText" in block && "path" in block) ||
    "new_text" in block;

  if (looksLikeDiff && path && newText !== undefined) {
    output.push({ path, oldText: oldText ?? "", newText });
  }

  for (const key of ["content", "diff", "changes", "fileEdit", "file_edit", "output"]) {
    if (key in block) extractDiffs(block[key], output);
  }
}

/**
 * Build the compact card data from final tool-call contents. This is called
 * once when a turn settles, never for every streaming update.
 */
export function summarizeToolCalls(
  key: string,
  toolCalls: Record<string, AcpToolCallState>,
): DiffTurnSummary | null {
  const files = new Map<string, { oldText: string; newText: string }>();
  for (const toolCall of Object.values(toolCalls)) {
    const diffs: Array<{ path: string; oldText: string; newText: string }> = [];
    extractDiffs(toolCall.content, diffs);
    for (const diff of diffs) {
      const previous = files.get(diff.path);
      files.set(diff.path, {
        oldText: previous?.oldText ?? diff.oldText,
        newText: diff.newText,
      });
    }
  }

  const summaryFiles: DiffSummaryFile[] = [];
  for (const [path, file] of files) {
    if (file.oldText === file.newText) continue;
    try {
      const parsed = parseDiffFromFile(
        { name: path, contents: file.oldText },
        { name: path, contents: file.newText },
      );
      summaryFiles.push({
        path,
        additions: parsed.hunks.reduce((total, hunk) => total + hunk.additionLines, 0),
        deletions: parsed.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0),
      });
    } catch {
      // A malformed or identical provider payload should not prevent the
      // completed assistant message from rendering.
    }
  }

  if (summaryFiles.length === 0) return null;
  return {
    key,
    files: summaryFiles,
    additions: summaryFiles.reduce((total, file) => total + file.additions, 0),
    deletions: summaryFiles.reduce((total, file) => total + file.deletions, 0),
  };
}

function ingestThread(
  previous: DiffThreadState,
  toolCalls: Record<string, AcpToolCallState>,
): {
  next: DiffThreadState;
  added: number;
  changed: boolean;
  changedFileCount: number;
  serializedUtf16Bytes: number;
} {
  const files = { ...previous.files };
  const order = [...previous.order];
  let added = 0;
  let changed = false;
  let changedFileCount = 0;
  let lastAddedPath: string | null = null;
  let serializedUtf16Bytes = 0;
  const nextVersions: Record<string, string> = {};

  for (const [id, toolCall] of Object.entries(toolCalls)) {
    const versioned = toolCallVersion(toolCall);
    const version = versioned.version;
    serializedUtf16Bytes += versioned.serializedUtf16Bytes;
    nextVersions[id] = version;
    if (version === previous.lastSeenToolCallVersions[id]) continue;

    // In-flight edits are useful partial evidence. The file entry is updated
    // as chunks arrive, while the stable tool-call identity prevents unrelated
    // tool calls from being re-parsed on every renderer update.
    const diffs: Array<{ path: string; oldText: string; newText: string }> = [];
    extractDiffs(toolCall.content, diffs);
    for (const diff of diffs) {
      const existing = files[diff.path];
      if (!existing) {
        order.push(diff.path);
        added += 1;
        lastAddedPath = diff.path;
      }
      if (existing?.oldText === diff.oldText && existing.newText === diff.newText) {
        continue;
      }
      files[diff.path] = {
        path: diff.path,
        oldText: diff.oldText,
        newText: diff.newText,
        updatedAt: Date.now(),
      };
      changed = true;
      changedFileCount += 1;
    }
  }

  const activePath =
    lastAddedPath ??
    (previous.activePath && files[previous.activePath]
      ? previous.activePath
      : (order.at(-1) ?? null));
  return {
    next: {
      files,
      order,
      activePath,
      unseenCount: previous.unseenCount + added,
      summaries: previous.summaries,
      lastSeenToolCallVersions: nextVersions,
    },
    added,
    changed,
    changedFileCount,
    serializedUtf16Bytes,
  };
}

function toolCallVersion(toolCall: AcpToolCallState): {
  version: string;
  serializedUtf16Bytes: number;
} {
  // Hash the serialized shape instead of retaining the entire payload in the
  // diff store. This still notices same-length streaming edits while keeping
  // one compact string per tool call.
  const serialized = JSON.stringify({
    title: toolCall.title,
    kind: toolCall.kind,
    status: toolCall.status,
    content: toolCall.content,
    locations: toolCall.locations,
    rawInput: toolCall.rawInput,
    rawOutput: toolCall.rawOutput,
  });
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return {
    version: `${serialized.length}:${hash >>> 0}`,
    serializedUtf16Bytes: serialized.length * 2,
  };
}

export const useDiffStore = create<DiffState>((set, get) => ({
  threadId: null,
  files: {},
  order: [],
  activePath: null,
  isOpen: false,
  unseenCount: 0,
  summaries: {},
  threads: {},

  ingestToolCalls: (threadId, toolCalls, isActive = true) => {
    if (!threadId) return null;
    const startedAt = globalThis.performance?.now?.() ?? Date.now();
    const state = get();
    const previous =
      state.threads[threadId] ??
      (state.threadId === threadId
        ? {
            files: state.files,
            order: state.order,
            activePath: state.activePath,
            unseenCount: 0,
            summaries: state.summaries,
            lastSeenToolCallVersions: {},
          }
        : emptyThreadState());
    const result = ingestThread(previous, toolCalls);
    const threads = { ...state.threads, [threadId]: result.next };
    if (state.threadId && !threads[state.threadId]) {
      threads[state.threadId] = {
        files: state.files,
        order: state.order,
        activePath: state.activePath,
        unseenCount: 0,
        summaries: state.summaries,
        lastSeenToolCallVersions: {},
      };
    }
    while (Object.keys(threads).length > MAX_RETAINED_THREADS) {
      const evict = Object.keys(threads).find((id) => id !== threadId && id !== state.threadId);
      if (!evict) break;
      delete threads[evict];
    }

    if (!isActive) {
      set({ threads, unseenCount: state.unseenCount + result.added });
      return {
        toolCallCount: Object.keys(toolCalls).length,
        serializedUtf16Bytes: result.serializedUtf16Bytes,
        extractedFileCount: result.added,
        changedFileCount: result.changedFileCount,
        durationMs: (globalThis.performance?.now?.() ?? Date.now()) - startedAt,
        fileCount: result.next.order.length,
      };
    }

    set({
      threadId,
      threads,
      files: result.next.files,
      order: result.next.order,
      activePath: result.next.activePath,
      summaries: result.next.summaries,
      isOpen: state.isOpen,
      unseenCount: state.unseenCount + result.added,
    });
    return {
      toolCallCount: Object.keys(toolCalls).length,
      serializedUtf16Bytes: result.serializedUtf16Bytes,
      extractedFileCount: result.added,
      changedFileCount: result.changedFileCount,
      durationMs: (globalThis.performance?.now?.() ?? Date.now()) - startedAt,
      fileCount: result.next.order.length,
    };
  },

  recordTurnSummary: (threadId, key, toolCalls) => {
    if (!threadId || !key) return null;
    const state = get();
    const summary = summarizeToolCalls(key, toolCalls);
    if (!summary) return null;
    const previous =
      state.threads[threadId] ??
      (state.threadId === threadId
        ? {
            files: state.files,
            order: state.order,
            activePath: state.activePath,
            unseenCount: state.unseenCount,
            summaries: state.summaries,
            lastSeenToolCallVersions: {},
          }
        : emptyThreadState());
    const summaries = { ...previous.summaries, [key]: summary };
    const nextThread = { ...previous, summaries };
    const threads = { ...state.threads, [threadId]: nextThread };
    if (state.threadId === threadId || state.threadId == null) {
      set({
        threadId,
        threads,
        files: previous.files,
        order: previous.order,
        activePath: previous.activePath,
        summaries,
      });
    } else {
      set({ threads });
    }
    return summary;
  },

  activateThread: (threadId) => {
    if (!threadId) return;
    const state = get();
    const thread = state.threads[threadId] ?? emptyThreadState();
    set({
      threadId,
      files: thread.files,
      order: thread.order,
      activePath: thread.activePath,
      summaries: thread.summaries,
      unseenCount: thread.unseenCount,
    });
  },

  setActivePath: (path) => set({ activePath: path }),
  open: () => set({ isOpen: true, unseenCount: 0 }),
  close: () => set({ isOpen: false }),
  clear: () =>
    set({
      threadId: null,
      files: {},
      order: [],
      activePath: null,
      isOpen: false,
      unseenCount: 0,
      summaries: {},
      threads: {},
    }),
  markSeen: () => set({ unseenCount: 0 }),
}));
