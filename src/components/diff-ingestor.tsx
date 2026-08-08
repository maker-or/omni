import { useEffect } from "react";
import { useAgentStore } from "@/store/agent-store";
import { useDiffStore } from "@/store/diff-store";

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

  useEffect(() => {
    for (const [threadId, toolCalls] of Object.entries(threadToolCalls)) {
      if (threadId === "__none__") continue;
      ingestToolCalls(threadId, toolCalls, threadId === activeThreadId);
    }
  }, [activeThreadId, threadToolCalls, ingestToolCalls]);

  return null;
}
