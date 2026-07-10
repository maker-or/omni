"use client";

import { useEffect } from "react";
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  CircleNotch,
  SquareIcon,
  CheckSquareIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useAgentRegistryStore } from "@/store/agent-registry-store";
import { Elevated } from "@/lib/elevated";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AcpAgentDescriptor } from "../../contracts/acp.ts";

/**
 * Agent registry browser — multi-select which agents Pipper should offer.
 * Supports Cursor (`agent acp`), Codex ACP, and Claude Agent ACP.
 */
export function AgentSelector({
  className,
  onSelected,
  showContinue,
  onContinue,
  compact = false,
}: {
  className?: string;
  onSelected?: (agentIds: string[]) => void;
  showContinue?: boolean;
  onContinue?: () => void | Promise<void>;
  compact?: boolean;
}) {
  const {
    agents,
    selectedAgentIds,
    connectionState,
    authRequiredMessage,
    error,
    load,
    toggleAgent,
  } = useAgentRegistryStore();

  useEffect(() => {
    void load();
  }, [load]);

  const canContinue =
    selectedAgentIds.length > 0 && connectionState !== "connecting" && connectionState !== "error";

  return (
    <Elevated
      offset={1}
      data-pipper-id="agent-selector"
      className={cn("rounded-xl border border-border p-3", className)}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-[12px] font-medium text-foreground">Coding agent(s)</div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-pipper-id="agent-selector-refresh"
          className="h-7 text-[11px]"
          onClick={() => void load()}
        >
          Refresh
        </Button>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        Pipper talks to ACP agents over stdio. Pick Cursor, Codex, or Claude — install and
        authenticate them outside Pipper, then connect. Select all agents you want to use.
      </p>

      <div className="flex flex-col gap-1.5">
        {agents
          .filter((agent) => {
            if (agent.installKind !== "mock") return true;
            const anyReady = agents.some((a) => a.available && a.installKind !== "mock");
            return !anyReady;
          })
          .map((agent) => (
            <AgentOption
              key={agent.id}
              agent={agent}
              selected={selectedAgentIds.includes(agent.id)}
              onToggle={async () => {
                await toggleAgent(agent.id);
                const next = useAgentRegistryStore.getState().selectedAgentIds;
                onSelected?.(next);
              }}
            />
          ))}
        {agents.length === 0 && (
          <div className="px-2 py-3 text-[12px] text-muted-foreground">
            No ACP agents in the registry.
          </div>
        )}
      </div>

      {selectedAgentIds.length > 0 && (
        <div className="mt-2 rounded-lg border border-border/60 bg-surface-1/50 px-2.5 py-2 text-[11px] text-muted-foreground">
          Selected: {selectedAgentIds.length} agent{selectedAgentIds.length > 1 ? "s" : ""}.{" "}
          {agents
            .filter((a) => selectedAgentIds.includes(a.id))
            .map((a) => a.displayName)
            .join(", ")}
        </div>
      )}

      {authRequiredMessage && (
        <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-2 text-[12px] text-amber-600 dark:text-amber-400">
          {authRequiredMessage}
        </div>
      )}
      {error && (
        <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-2 text-[12px] text-red-500">
          {error}
        </div>
      )}

      {showContinue && (
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            size="sm"
            data-pipper-id="agent-selector-continue"
            disabled={!canContinue}
            onClick={async () => {
              // Selection is shared by launch/main renderers through SQLite.
              // Do not leave onboarding until this write finishes.
              await useAgentRegistryStore
                .getState()
                .setSelectedAgents(useAgentRegistryStore.getState().selectedAgentIds);
              await onContinue?.();
            }}
          >
            Continue{selectedAgentIds.length > 0 ? ` (${selectedAgentIds.length})` : ""}
          </Button>
        </div>
      )}
    </Elevated>
  );
}

function AgentOption({
  agent,
  selected,
  onToggle,
}: {
  agent: AcpAgentDescriptor;
  selected: boolean;
  onToggle: () => void;
}) {
  const unavailable = agent.available === false;
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 transition-colors",
        selected
          ? "border-accent bg-accent text-foreground"
          : "border-border/50 bg-surface-1/40 text-muted-foreground",
        unavailable && "opacity-70",
      )}
    >
      <button
        type="button"
        data-pipper-id={`agent-option-${agent.id}`}
        disabled={false}
        className={cn(
          "flex w-full items-start justify-between gap-2 text-left text-[13px]",
          unavailable && "cursor-not-allowed",
        )}
        onClick={() => void onToggle()}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 text-muted-foreground/70">
            {selected ? (
              <CheckSquareIcon size={18} weight="fill" className="text-primary" />
            ) : (
              <SquareIcon size={18} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              {agent.displayName}
              {agent.available ? (
                <CheckCircleIcon className="text-emerald-500" size={14} weight="fill" />
              ) : (
                <WarningCircleIcon className="text-amber-500" size={14} weight="fill" />
              )}
            </span>
            {agent.description ? (
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                {agent.description}
              </span>
            ) : null}
          </span>
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
          {selected ? "Selected" : agent.available ? "Ready" : "Setup"}
        </span>
      </button>

      {!agent.available && agent.installHint ? (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{agent.installHint}</p>
      ) : null}
      {agent.available && agent.statusMessage ? (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          {agent.statusMessage}
        </p>
      ) : null}
      {agent.docsUrl ? (
        <button
          type="button"
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          data-pipper-id={`agent-docs-${agent.id}`}
          onClick={(e) => {
            e.stopPropagation();
            void window.omni?.shell?.openExternal?.(agent.docsUrl!);
          }}
        >
          Docs <ArrowSquareOutIcon size={11} />
        </button>
      ) : null}
    </div>
  );
}
