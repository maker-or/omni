import { useEffect, useRef } from "react";
import { useAgentStore } from "@/store/agent-store";
import { useDiffStore } from "@/store/diff-store";
import { recordDiffIngestion } from "@/lib/monitor-runtime-observer";
import { resolveToolCalls } from "@/lib/resolve-tool-calls";

/**
 * Headless diff coordinator. Diff payloads are intentionally ignored while a
 * turn is streaming. We summarize newly-created tool calls once after the
 * turn settles, and only materialize the full latest diff when the user has
 * explicitly opened the diff panel.
 */
export function DiffIngestor() {
  const activeThreadId = useAgentStore((state) => state.state?.threadId ?? null);
  const isStreaming = useAgentStore((state) => state.state?.isStreaming ?? false);
  const activeEntries = useAgentStore((state) => state.slice.entries);
  const activeToolCalls = useAgentStore((state) => state.slice.toolCalls);
  const runningThreadIds = useAgentStore((state) => state.runningThreadIds);
  const threadToolCalls = useAgentStore((state) => state.threadToolCalls);
  const ingestToolCalls = useDiffStore((state) => state.ingestToolCalls);
  const recordTurnSummary = useDiffStore((state) => state.recordTurnSummary);
  const activateThread = useDiffStore((state) => state.activateThread);
  const isOpen = useDiffStore((state) => state.isOpen);
  const clear = useDiffStore((state) => state.clear);
  const baselineToolCallIds = useRef<Record<string, Set<string>>>({});
  const hydratedThreadIds = useRef<Set<string>>(new Set());
  const previousActiveThreadId = useRef<string | null>(null);
  const previousRunningThreadIds = useRef<Set<string>>(new Set());
  const wasStreaming = useRef(false);
  const previousOpen = useRef(false);

  useEffect(() => {
    if (!activeThreadId) {
      baselineToolCallIds.current = {};
      hydratedThreadIds.current = new Set();
      previousActiveThreadId.current = null;
      previousRunningThreadIds.current = new Set();
      wasStreaming.current = false;
      clear();
    }
  }, [activeThreadId, clear]);

  useEffect(() => {
    if (!activeThreadId) return;
    let cancelled = false;
    // The active slice is updated by the authoritative session-state/stop
    // path. The background watermark can lag behind that event by one bridge
    // tick, which previously caused us to summarize the previous turn.
    const typedToolCalls = activeToolCalls;
    const activeChanged = previousActiveThreadId.current !== activeThreadId;
    const running = new Set(runningThreadIds);

    void (async () => {
      const resolvedActive = await resolveToolCalls(activeThreadId, typedToolCalls);
      if (cancelled) return;

      if (activeChanged) {
        activateThread(activeThreadId);
        baselineToolCallIds.current[activeThreadId] = new Set(Object.keys(resolvedActive));
        previousActiveThreadId.current = activeThreadId;
        wasStreaming.current = isStreaming;

        if (!isStreaming && !hydratedThreadIds.current.has(activeThreadId)) {
          for (const run of assistantToolCallRuns(activeEntries, resolvedActive)) {
            recordTurnSummary(activeThreadId, run.key, run.toolCalls);
          }
          hydratedThreadIds.current.add(activeThreadId);
        }
      }

      for (const threadId of running) {
        if (baselineToolCallIds.current[threadId]) continue;
        baselineToolCallIds.current[threadId] = new Set(
          Object.keys(threadToolCalls[threadId] ?? {}),
        );
      }

      const completedThreadIds = [...previousRunningThreadIds.current].filter(
        (threadId) => !running.has(threadId),
      );
      for (const threadId of completedThreadIds) {
        const calls = await resolveToolCalls(threadId, threadToolCalls[threadId] ?? {});
        if (cancelled) return;
        const baseline = baselineToolCallIds.current[threadId] ?? new Set<string>();
        const turnToolCalls = Object.fromEntries(
          Object.entries(calls).filter(([id]) => !baseline.has(id)),
        );
        const firstToolCallId = Object.keys(turnToolCalls)[0];
        if (firstToolCallId) {
          recordTurnSummary(threadId, firstToolCallId, turnToolCalls);
        }
        delete baselineToolCallIds.current[threadId];
      }
      previousRunningThreadIds.current = running;

      if (isStreaming && !wasStreaming.current) {
        wasStreaming.current = true;
      }

      const justSettled = wasStreaming.current && !isStreaming;
      if (justSettled) {
        const currentTurnToolCalls = toolCallsAfterLastUserMessage(activeEntries, resolvedActive);
        if (Object.keys(currentTurnToolCalls).length > 0) {
          recordTurnSummary(
            activeThreadId,
            Object.keys(currentTurnToolCalls)[0]!,
            currentTurnToolCalls,
          );
        }
        wasStreaming.current = false;
      }

      // Full diff extraction is an explicit-view operation. A settled turn can
      // refresh an already-open panel once, but never on intermediate chunks.
      const shouldLoadLatest = isOpen && (!previousOpen.current || activeChanged || justSettled);
      if (shouldLoadLatest && !isStreaming) {
        const metrics = ingestToolCalls(activeThreadId, resolvedActive, true);
        if (metrics) {
          const threadCount = Object.keys(threadToolCalls).filter((id) => id !== "__none__").length;
          recordDiffIngestion({ ...metrics, threadCount, toolCallCount: metrics.toolCallCount });
          reportDiffIngestionAfterPaint({
            activeThreadId,
            ingestedThreadId: activeThreadId,
            activeThreadStreaming: false,
            isActiveThread: true,
            threadCount,
            toolCallCount: metrics.toolCallCount,
            ...metrics,
          });
        }
      }
      previousOpen.current = isOpen;
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeThreadId,
    activeEntries,
    activeToolCalls,
    ingestToolCalls,
    isOpen,
    isStreaming,
    recordTurnSummary,
    activateThread,
    runningThreadIds,
    threadToolCalls,
  ]);

  return null;
}

function toolCallsAfterLastUserMessage(
  entries: ReturnType<typeof useAgentStore.getState>["slice"]["entries"],
  toolCalls: ReturnType<typeof useAgentStore.getState>["slice"]["toolCalls"],
): Record<string, (typeof toolCalls)[string]> {
  let lastUserIndex = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.type === "user_text") {
      lastUserIndex = index;
      break;
    }
  }
  const ids = entries
    .slice(lastUserIndex + 1)
    .filter(
      (entry): entry is Extract<(typeof entries)[number], { type: "tool_call" }> =>
        entry.type === "tool_call",
    )
    .map((entry) => entry.toolCallId);
  return Object.fromEntries(ids.map((id) => [id, toolCalls[id]]).filter(([, call]) => call));
}

function assistantToolCallRuns(
  entries: ReturnType<typeof useAgentStore.getState>["slice"]["entries"],
  toolCalls: ReturnType<typeof useAgentStore.getState>["slice"]["toolCalls"],
): Array<{ key: string; toolCalls: Record<string, (typeof toolCalls)[string]> }> {
  const runs: Array<{ key: string; toolCalls: Record<string, (typeof toolCalls)[string]> }> = [];
  let ids: string[] = [];

  const flush = () => {
    const calls = Object.fromEntries(
      ids.map((id) => [id, toolCalls[id]]).filter(([, call]) => call),
    ) as Record<string, (typeof toolCalls)[string]>;
    const key = Object.keys(calls)[0];
    if (key) runs.push({ key, toolCalls: calls });
    ids = [];
  };

  for (const entry of entries) {
    if (entry.type === "user_text") {
      flush();
    } else if (entry.type === "tool_call") {
      ids.push(entry.toolCallId);
    }
  }
  flush();
  return runs;
}

function reportDiffIngestionAfterPaint(
  input: Parameters<typeof recordDiffIngestion>[0] & {
    activeThreadId: string;
    ingestedThreadId: string;
    activeThreadStreaming: boolean;
    isActiveThread: boolean;
  },
): void {
  const ingestionEndedAt = globalThis.performance?.now?.() ?? Date.now();
  requestAnimationFrame(() => {
    const nextFrameMs = (globalThis.performance?.now?.() ?? Date.now()) - ingestionEndedAt;
    requestAnimationFrame(() => {
      const postPaintMs = (globalThis.performance?.now?.() ?? Date.now()) - ingestionEndedAt;
      window.omni.monitor.reportDiffIngestion({
        timestamp: Date.now(),
        activeThreadId: input.activeThreadId,
        ingestedThreadId: input.ingestedThreadId,
        activeThreadStreaming: input.activeThreadStreaming,
        isActiveThread: input.isActiveThread,
        visibilityState: document.visibilityState,
        focused: document.hasFocus(),
        threadCount: input.threadCount,
        toolCallCount: input.toolCallCount,
        fileCount: input.fileCount,
        durationMs: input.durationMs,
        serializedUtf16Bytes: input.serializedUtf16Bytes,
        extractedFileCount: input.extractedFileCount,
        changedFileCount: input.changedFileCount,
        nextFrameMs,
        postPaintMs,
      });
    });
  });
}
