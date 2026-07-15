"use client";

import { useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import type { AcpAgentDescriptor, SubagentRunSnapshot } from "../../contracts/acp.ts";

const STATUS_DOT: Record<SubagentRunSnapshot["status"], string> = {
  queued: "bg-muted-foreground",
  running: "bg-blue-500",
  finished: "bg-emerald-500",
  failed: "bg-red-500",
  cancelled: "bg-amber-500",
};

const STATUS_LABEL: Record<SubagentRunSnapshot["status"], string> = {
  queued: "Queued",
  running: "Working",
  finished: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

const SETTLED_SHOWN = 3;

function isActive(status: SubagentRunSnapshot["status"]): boolean {
  return status === "queued" || status === "running";
}

interface SubagentActivityProps {
  runs: SubagentRunSnapshot[];
  agents: AcpAgentDescriptor[];
  /**
   * ACP session id of the currently viewed thread. Runs are scoped to the
   * thread whose orchestrator session spawned them, so switching threads no
   * longer leaks another thread's subagent activity into view.
   */
  activeSessionId?: string | null;
  className?: string;
}

/**
 * Floating panel of subagent runs for the active thread, styled like the slash
 * command menu and fed by "subagent-runs" bridge events
 * (useAgentStore().subagentRuns). Each run is one accordion item: the trigger
 * shows a status dot + agent name + task; expanding reveals the full task and
 * result preview. Active runs always show; settled runs are trimmed to the most
 * recent few so the panel never grows unbounded.
 */
export function SubagentActivity({
  runs,
  agents,
  activeSessionId,
  className,
}: SubagentActivityProps) {
  const prefersReducedMotion = useReducedMotion();

  const visible = useMemo(() => {
    // Scope to the thread that spawned these runs. Without a session id we
    // can't attribute runs to a thread, so show nothing rather than leak.
    const scoped = activeSessionId
      ? runs.filter((run) => run.parentSessionId === activeSessionId)
      : [];
    const active = scoped.filter((run) => isActive(run.status));
    const settled = scoped
      .filter((run) => !isActive(run.status))
      .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
      .slice(0, SETTLED_SHOWN);
    return [...active, ...settled];
  }, [runs, activeSessionId]);

  const agentName = (agentId: string) =>
    agents.find((agent) => agent.id === agentId)?.displayName ?? agentId;

  return (
    <AnimatePresence initial={false}>
      {visible.length > 0 && (
        <motion.div
          data-pipper-id="subagent-activity"
          aria-label="Subagent activity"
          initial={{
            opacity: 0,
            y: prefersReducedMotion ? 0 : 12,
            scale: prefersReducedMotion ? 1 : 0.98,
          }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={
            prefersReducedMotion
              ? { opacity: 0, transition: { duration: 0 } }
              : { opacity: 0, y: 8, scale: 0.99, transition: { duration: 0.15, ease: "easeIn" } }
          }
          transition={
            prefersReducedMotion ? { duration: 0 } : { type: "spring", duration: 0.3, bounce: 0 }
          }
          style={{ transformOrigin: "bottom center" }}
          className={cn(
            "overflow-hidden rounded-xl border border-border bg-surface-2 px-2 py-2 shadow-lg",
            className,
          )}
        >
          <div className="flex items-center justify-between px-1.5 pb-1.5">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Subagents
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {visible.length}
            </span>
          </div>

          <Accordion type="multiple" className="w-full">
            {visible.map((run) => {
              const working = isActive(run.status);
              const name = agentName(run.agentId);
              return (
                <AccordionItem key={run.runId} value={run.runId} data-status={run.status}>
                  <AccordionTrigger className="px-2 py-1.5">
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="relative flex size-1.5 shrink-0 items-center justify-center">
                        {run.status === "running" && (
                          <span className="absolute inline-flex size-1.5 animate-ping rounded-full bg-blue-500/60" />
                        )}
                        <span
                          className={cn(
                            "relative size-1.5 rounded-full",
                            STATUS_DOT[run.status],
                          )}
                        />
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-[13px] font-medium",
                          working ? "animate-text-shimmer" : "text-foreground",
                        )}
                      >
                        {name}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-[13px]",
                          working ? "animate-text-shimmer" : "text-muted-foreground",
                        )}
                      >
                        {run.task}
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[run.status])}
                        />
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {STATUS_LABEL[run.status]}
                        </span>
                      </div>
                      {run.task && (
                        <p className="whitespace-pre-wrap break-words text-foreground/90">
                          {run.task}
                        </p>
                      )}
                      {run.resultPreview && (
                        <p className="whitespace-pre-wrap break-words border-t border-border/60 pt-2 text-muted-foreground">
                          {run.resultPreview}
                        </p>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
