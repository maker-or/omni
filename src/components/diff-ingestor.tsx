import { useEffect, useRef } from "react";
import { useAgentStore } from "@/store/agent-store";
import { useDiffStore } from "@/store/diff-store";
import type { AcpToolCallState } from "../../contracts/acp.ts";
import { recordDiffIngestion } from "@/lib/monitor-runtime-observer";

/**
 * Headless: streams the active agent thread's ACP tool-call diffs into the
 * diff store. Isolated into its own component (rendered once, high in the
 * tree) so the `toolCalls` subscription — which changes on every streaming
 * update — re-renders only this null node, not the whole app shell. Lives
 * above the view router so diffs keep flowing even while a terminal tab is
 * focused.
 */
export function DiffIngestor() {
  const activeThreadId = useAgentStore((state) => state.state?.threadId ?? null);
  const threadToolCalls = useAgentStore((state) => state.threadToolCalls);
  const ingestToolCalls = useDiffStore((state) => state.ingestToolCalls);
  const clear = useDiffStore((state) => state.clear);
  const seenToolCalls = useRef<Record<string, Record<string, AcpToolCallState>>>({});
  const previousActiveThreadId = useRef<string | null>(null);

  useEffect(() => {
    if (!activeThreadId) {
      seenToolCalls.current = {};
      previousActiveThreadId.current = null;
      clear();
    }
  }, [activeThreadId, clear]);

  useEffect(() => {
    if (!activeThreadId) return;
    const activeChanged = previousActiveThreadId.current !== activeThreadId;
    const nextSeen: Record<string, Record<string, AcpToolCallState>> = {};
    for (const [threadId, toolCalls] of Object.entries(threadToolCalls)) {
      if (threadId === "__none__") continue;
      const typedToolCalls = toolCalls as Record<string, AcpToolCallState>;
      nextSeen[threadId] = typedToolCalls;
      if (
        seenToolCalls.current[threadId] === typedToolCalls &&
        !(activeChanged && threadId === activeThreadId)
      ) {
        continue;
      }
      const metrics = ingestToolCalls(threadId, typedToolCalls, threadId === activeThreadId);
      if (metrics) {
        recordDiffIngestion({
          ...metrics,
          threadCount: Object.keys(threadToolCalls).filter((id) => id !== "__none__").length,
          toolCallCount: Object.keys(typedToolCalls).length,
          fileCount: metrics.fileCount,
        });
        reportDiffIngestionAfterPaint({
          activeThreadId,
          ingestedThreadId: threadId,
          activeThreadStreaming: useAgentStore.getState().runningThreadIds.includes(activeThreadId),
          isActiveThread: threadId === activeThreadId,
          threadCount: Object.keys(threadToolCalls).filter((id) => id !== "__none__").length,
          toolCallCount: Object.keys(typedToolCalls).length,
          ...metrics,
        });
      }
    }
    seenToolCalls.current = nextSeen;
    previousActiveThreadId.current = activeThreadId;
  }, [activeThreadId, threadToolCalls, ingestToolCalls]);

  return null;
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
