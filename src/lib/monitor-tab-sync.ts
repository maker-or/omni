import { useEffect, useRef } from "react";
import { useAgentStore } from "@/store/agent-store";
import { useWorkspaceViewStore } from "@/store/workspace-view-store";

const MISMATCH_THRESHOLD_MS = 1500;

export function useMonitorTabSync(enabled: boolean): void {
  const requestedThreadId = useWorkspaceViewStore((state) => state.requestedThreadId);
  const snapshotThreadId = useAgentStore(
    (state) => state.snapshot?.threadId ?? state.state?.threadId ?? null,
  );
  const agentId = useAgentStore((state) => state.snapshot?.agentId ?? state.state?.agentId ?? null);
  const mismatchStartedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !window.omni.monitor) return;

    const shown = requestedThreadId;
    const real = snapshotThreadId;
    if (!shown || !real || shown === real) {
      mismatchStartedAt.current = null;
      return;
    }

    if (mismatchStartedAt.current == null) {
      mismatchStartedAt.current = Date.now();
    }

    const reportIfStale = () => {
      if (mismatchStartedAt.current == null) return;
      const durationMs = Date.now() - mismatchStartedAt.current;
      if (durationMs < MISMATCH_THRESHOLD_MS) return;

      void window.omni.monitor.reportTabMismatch({
        shownThreadId: shown,
        realThreadId: real,
        durationMs,
        agentId,
      });
      mismatchStartedAt.current = null;
    };

    reportIfStale();
    const timer = window.setTimeout(reportIfStale, MISMATCH_THRESHOLD_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, requestedThreadId, snapshotThreadId, agentId]);
}
