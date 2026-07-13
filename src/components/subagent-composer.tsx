"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/lib/icon-context";
import { surfaceClasses } from "@/lib/surface-classes";
import { SurfaceProvider } from "@/lib/surface-context";
import { useShape } from "@/lib/shape-context";
import { Button } from "@/components/ui/button";
import type { AcpAgentDescriptor, SubagentConfig } from "../../contracts/acp.ts";
import {
  composeOrchestrationPrompt,
  emptyOrchestrationDraft,
  newAssignment,
  validateOrchestrationDraft,
  type OrchestrationDraft,
} from "@/lib/subagent-orchestration";

export interface SubagentComposerSubmit {
  prompt: string;
  orchestratorAgentId: string;
  draft: OrchestrationDraft;
}

interface SubagentComposerProps {
  /** Installed agents (unavailable ones are filtered out here). */
  agents: AcpAgentDescriptor[];
  /** Preselected orchestrator — usually the active thread's agent. */
  defaultOrchestratorId: string | null;
  /** Seeds the goal, e.g. the remainder of "/subagent fix the login flow". */
  initialGoal?: string;
  onSubmit: (payload: SubagentComposerSubmit) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  className?: string;
}

/** Chip-row picker used for both the orchestrator and per-assignment agents. */
function AgentChips({
  agents,
  selectedId,
  onSelect,
  compact,
}: {
  agents: AcpAgentDescriptor[];
  selectedId: string;
  onSelect: (agentId: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {agents.map((agent) => (
        <Button
          key={agent.id}
          type="button"
          variant={selectedId === agent.id ? "secondary" : "ghost"}
          size="sm"
          active={selectedId === agent.id}
          className={cn(compact && "h-6 px-2 text-[11px]")}
          onClick={() => onSelect(agent.id)}
        >
          {agent.displayName}
        </Button>
      ))}
    </div>
  );
}

/**
 * The composer, morphed into orchestration mode by `/subagent`: pick an
 * orchestrator, describe a goal (auto) or assign per-agent tasks (manual),
 * and submit one orchestration prompt to the orchestrator's thread. The
 * orchestrator does the actual spawning through the client-hosted
 * `spawn_subagent` tool.
 */
export function SubagentComposer({
  agents,
  defaultOrchestratorId,
  initialGoal,
  onSubmit,
  onCancel,
  isSubmitting = false,
  className,
}: SubagentComposerProps) {
  const shape = useShape();
  const installed = useMemo(() => agents.filter((a) => a.available !== false), [agents]);
  const [orchestratorId, setOrchestratorId] = useState(
    () => installed.find((a) => a.id === defaultOrchestratorId)?.id ?? installed[0]?.id ?? "",
  );
  const [draft, setDraft] = useState<OrchestrationDraft>(() => ({
    ...emptyOrchestrationDraft(),
    goal: initialGoal?.trim() ?? "",
  }));
  const [config, setConfig] = useState<SubagentConfig | null>(null);

  useEffect(() => {
    let stale = false;
    void window.omni?.subagents
      ?.getConfig()
      .then((loaded) => {
        if (!stale) setConfig(loaded);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, []);

  // Agents the user allows as subagents (subagents.json); orchestrator can be anyone.
  const subagentChoices = useMemo(() => {
    if (!config || config.allowedAgents === "all") return installed;
    const allowed = new Set(config.allowedAgents);
    return installed.filter((a) => allowed.has(a.id));
  }, [config, installed]);

  const validationError = validateOrchestrationDraft(draft);
  const canSubmit = !validationError && Boolean(orchestratorId) && !isSubmitting;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      prompt: composeOrchestrationPrompt(draft, installed),
      orchestratorAgentId: orchestratorId,
      draft,
    });
  };

  const updateConfig = (partial: Partial<SubagentConfig>) => {
    if (!config) return;
    const next = { ...config, ...partial };
    setConfig(next);
    void window.omni?.subagents?.setConfig(partial).catch(() => {});
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };

  const setAssignment = (id: string, patch: Partial<{ agentId: string; task: string }>) => {
    setDraft((current) => ({
      ...current,
      assignments: current.assignments.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  };

  const textareaClasses =
    "w-full resize-none bg-transparent outline-none text-[13px] text-foreground placeholder:text-muted-foreground";

  return (
    <div
      data-pipper-id="subagent-composer"
      onKeyDown={handleKeyDown}
      className={cn("flex flex-col gap-3 p-3", surfaceClasses(2, 2), shape.container, className)}
    >
      <SurfaceProvider value={2}>
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-foreground">Orchestrate subagents</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close orchestration"
            onClick={onCancel}
          >
            <Icon name="x" className="size-3.5" strokeWidth={2} />
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Orchestrator
          </span>
          <AgentChips agents={installed} selectedId={orchestratorId} onSelect={setOrchestratorId} />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Subagents
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant={draft.mode === "auto" ? "secondary" : "ghost"}
              size="sm"
              active={draft.mode === "auto"}
              onClick={() => setDraft((current) => ({ ...current, mode: "auto" }))}
            >
              Auto
            </Button>
            <Button
              type="button"
              variant={draft.mode === "manual" ? "secondary" : "ghost"}
              size="sm"
              active={draft.mode === "manual"}
              onClick={() => setDraft((current) => ({ ...current, mode: "manual" }))}
            >
              Manual
            </Button>
            <span className="ml-1 text-[11px] text-muted-foreground">
              {draft.mode === "auto"
                ? "The orchestrator decides how many subagents to spawn."
                : "Assign each subagent its own task."}
            </span>
          </div>
        </div>

        {draft.mode === "manual" && (
          <div className="flex flex-col gap-2">
            {draft.assignments.map((assignment, index) => (
              <div
                key={assignment.id}
                data-pipper-id="subagent-assignment"
                className="flex flex-col gap-1 rounded-lg border border-border/70 p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <AgentChips
                    compact
                    agents={subagentChoices}
                    selectedId={assignment.agentId}
                    onSelect={(agentId) => setAssignment(assignment.id, { agentId })}
                  />
                  {draft.assignments.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove subagent ${index + 1}`}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          assignments: current.assignments.filter((a) => a.id !== assignment.id),
                        }))
                      }
                    >
                      <Icon name="x" className="size-3" strokeWidth={2} />
                    </Button>
                  )}
                </div>
                <textarea
                  value={assignment.task}
                  onChange={(event) => setAssignment(assignment.id, { task: event.target.value })}
                  placeholder={`Task for subagent ${index + 1}…`}
                  rows={2}
                  aria-label={`Subagent ${index + 1} task`}
                  className={cn(textareaClasses, "px-1 py-0.5")}
                />
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  assignments: [...current.assignments, newAssignment()],
                }))
              }
            >
              + Add subagent
            </Button>
          </div>
        )}

        <textarea
          autoFocus
          value={draft.goal}
          onChange={(event) => setDraft((current) => ({ ...current, goal: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && draft.mode === "auto") {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={
            draft.mode === "auto"
              ? "What should the orchestrator achieve? It will split the work across subagents."
              : "Overall goal for synthesis (optional)…"
          }
          rows={draft.mode === "auto" ? 3 : 2}
          aria-label={draft.mode === "auto" ? "Orchestration goal" : "Overall goal (optional)"}
          className={cn(textareaClasses, "px-2 py-1.5 rounded-lg border border-border/70")}
        />

        <div className="flex items-center justify-between gap-2">
          <div className="flex shrink-0 items-center gap-1.5">
            {config && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Max parallel subagents"
                  title="How many subagents may run at once"
                  onClick={() => updateConfig({ maxConcurrent: (config.maxConcurrent % 8) + 1 })}
                >
                  Parallel: {config.maxConcurrent}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Toggle auto-approve subagent permissions"
                  title="Auto-approve permission requests raised by subagent sessions"
                  onClick={() =>
                    updateConfig({ autoApprovePermissions: !config.autoApprovePermissions })
                  }
                >
                  Auto-approve: {config.autoApprovePermissions ? "on" : "off"}
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!canSubmit}
              onClick={submit}
            >
              {isSubmitting ? "Starting…" : "Start orchestration"}
            </Button>
          </div>
        </div>
      </SurfaceProvider>
    </div>
  );
}
