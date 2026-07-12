"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { AcpAgentDescriptor, SubagentRunSnapshot } from "../../contracts/acp.ts";

const STATUS_DOT: Record<SubagentRunSnapshot["status"], string> = {
  queued: "bg-muted-foreground",
  running: "bg-blue-500 animate-pulse",
  finished: "bg-emerald-500",
  failed: "bg-red-500",
  cancelled: "bg-amber-500",
};

const SETTLED_SHOWN = 3;

interface SubagentActivityProps {
  runs: SubagentRunSnapshot[];
  agents: AcpAgentDescriptor[];
  className?: string;
}

/**
 * Compact chip strip of subagent runs, fed by "subagent-runs" bridge events
 * (useAgentStore().subagentRuns). Active runs always show; settled runs are
 * trimmed to the most recent few so the strip never grows unbounded.
 */
export function SubagentActivity({ runs, agents, className }: SubagentActivityProps) {
  const visible = useMemo(() => {
    const active = runs.filter((run) => run.status === "queued" || run.status === "running");
    const settled = runs
      .filter((run) => run.status !== "queued" && run.status !== "running")
      .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
      .slice(0, SETTLED_SHOWN);
    return [...active, ...settled];
  }, [runs]);

  if (visible.length === 0) return null;

  const agentName = (agentId: string) =>
    agents.find((agent) => agent.id === agentId)?.displayName ?? agentId;

  return (
    <div
      data-pipper-id="subagent-activity"
      aria-label="Subagent activity"
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Subagents</span>
      {visible.map((run) => (
        <span
          key={run.runId}
          data-status={run.status}
          title={[`${agentName(run.agentId)} — ${run.status}`, run.task, run.resultPreview]
            .filter(Boolean)
            .join("\n\n")}
          className="inline-flex max-w-64 items-center gap-1.5 rounded-full border border-border/70 bg-surface-2 px-2 py-0.5 text-[11px] text-foreground"
        >
          <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[run.status])} />
          <span className="shrink-0 font-medium">{agentName(run.agentId)}</span>
          <span className="truncate text-muted-foreground">{run.task}</span>
        </span>
      ))}
    </div>
  );
}
