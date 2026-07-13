"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  CircleNotch,
  SquareIcon,
  CheckSquareIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useAgentRegistryStore } from "@/store/agent-registry-store";
import { Elevated } from "@/lib/elevated";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { AcpAgentDescriptor, AgentProbeResult } from "../../contracts/acp.ts";

/**
 * Agent registry browser — multi-select which agents Pipper should offer.
 * The list scrolls internally (via ScrollArea) so the card stays a fixed
 * height regardless of how many agents the registry grows to.
 *
 * On Continue, every selected agent is probed with a real ACP handshake in
 * the background (not just a static PATH check) and any agent that needs an
 * install or sign-in step gets a card here — skippable per-agent or all at
 * once, never a hard gate.
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
    probeResults,
    skippedAgentIds,
    load,
    toggleAgent,
    probeAgents,
    skipAgentSetup,
    skipAllSetup,
    resetSetupWalkthrough,
  } = useAgentRegistryStore();

  const [phase, setPhase] = useState<"select" | "walkthrough">("select");

  useEffect(() => {
    void load();
  }, [load]);

  const canContinue =
    selectedAgentIds.length > 0 && connectionState !== "connecting" && connectionState !== "error";

  const pendingAgentIds = useMemo(
    () =>
      selectedAgentIds.filter((id) => {
        if (skippedAgentIds.includes(id)) return false;
        const status = probeResults[id]?.status;
        return status !== "ready" && status !== undefined;
      }),
    [selectedAgentIds, skippedAgentIds, probeResults],
  );
  const allSettled = selectedAgentIds.every((id) => probeResults[id] !== undefined);
  const canFinish = allSettled && pendingAgentIds.length === 0;

  if (phase === "walkthrough") {
    const cards = selectedAgentIds
      .filter((id) => !skippedAgentIds.includes(id))
      .map((id) => {
        const descriptor = agents.find((a) => a.id === id);
        const result = probeResults[id];
        if (!descriptor || !result || result.status === "ready") return null;
        return (
          <AgentSetupCard
            key={id}
            descriptor={descriptor}
            result={result}
            onSkip={() => skipAgentSetup(id)}
            onRecheck={() => void probeAgents([id])}
          />
        );
      });

    return (
      <Elevated
        offset={1}
        data-pipper-id="agent-setup-walkthrough"
        className={cn("rounded-xl border border-border p-5", className)}
      >
        <div className="mb-1 text-sm font-medium text-foreground">Finishing setup</div>
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
          Checking your selected agents. Anything that needs installing or signing in shows up below
          — skip any of them and set it up later.
        </p>

        <ScrollArea className="max-h-[380px]" viewportClassName="max-h-[380px] pr-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {cards}
            {canFinish && (
              <div
                className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-[12px] text-emerald-600 dark:text-emerald-400"
                data-pipper-id="agent-setup-all-clear"
              >
                All set — your agents are ready to use.
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-pipper-id="agent-setup-skip-all"
            className="h-9 text-xs text-muted-foreground"
            onClick={async () => {
              // Keep skippedAgentIds/setupSkipped so the agent panel can
              // still see which agents were never confirmed working.
              skipAllSetup();
              setPhase("select");
              await onContinue?.();
            }}
          >
            Skip setup for now
          </Button>
          <Button
            type="button"
            size="sm"
            data-pipper-id="agent-setup-finish"
            disabled={!canFinish}
            onClick={async () => {
              resetSetupWalkthrough();
              setPhase("select");
              await onContinue?.();
            }}
          >
            Continue to Pipper
          </Button>
        </div>
      </Elevated>
    );
  }

  const visibleAgents = agents.filter((agent) => {
    if (agent.installKind !== "mock") return true;
    const anyReady = agents.some((a) => a.available && a.installKind !== "mock");
    return !anyReady;
  });

  const selectedAgentNames = agents
    .filter((a) => selectedAgentIds.includes(a.id))
    .map((a) => a.displayName);

  return (
    <Elevated
      offset={1}
      data-pipper-id="agent-selector"
      className={cn("flex flex-col gap-4 rounded-xl border border-border p-5", className)}
    >
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Install and sign in to each agent outside Pipper, then select the ones you want here.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-pipper-id="agent-selector-refresh"
          className="h-8 shrink-0 text-xs"
          onClick={() => void load()}
        >
          Refresh
        </Button>
      </div>

      <ScrollArea className="max-h-[420px]" viewportClassName="max-h-[420px] pr-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visibleAgents.map((agent) => (
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
            <div className="col-span-full px-2 py-6 text-center text-sm text-muted-foreground">
              No ACP agents in the registry.
            </div>
          )}
        </div>
      </ScrollArea>

      {authRequiredMessage && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-600 dark:text-amber-400">
          {authRequiredMessage}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-500">
          {error}
        </div>
      )}

      {showContinue && (
        <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm text-muted-foreground" data-pipper-id="agent-selector-summary">
            {selectedAgentIds.length > 0 ? (
              <>
                <span className="font-medium text-foreground">
                  {selectedAgentIds.length} selected
                </span>
                <span className="text-muted-foreground"> · </span>
                <span className="truncate">{selectedAgentNames.join(", ")}</span>
              </>
            ) : (
              "Select at least one agent to continue"
            )}
          </div>
          <Button
            type="button"
            size="default"
            data-pipper-id="agent-selector-continue"
            className="shrink-0 sm:min-w-[140px]"
            disabled={!canContinue}
            onClick={async () => {
              // Selection is shared by launch/main renderers through SQLite.
              // Do not leave onboarding until this write finishes.
              const ids = useAgentRegistryStore.getState().selectedAgentIds;
              await useAgentRegistryStore.getState().setSelectedAgents(ids);
              resetSetupWalkthrough();
              setPhase("walkthrough");
              // Runs in the background — the walkthrough renders probing
              // spinners immediately rather than blocking this click.
              void probeAgents(ids);
            }}
          >
            Continue{selectedAgentIds.length > 0 ? ` (${selectedAgentIds.length})` : ""}
          </Button>
        </div>
      )}
    </Elevated>
  );
}

function AgentSetupCard({
  descriptor,
  result,
  onSkip,
  onRecheck,
}: {
  descriptor: AcpAgentDescriptor;
  result: AgentProbeResult;
  onSkip: () => void;
  onRecheck: () => void;
}) {
  const statusLabel =
    result.status === "probing"
      ? "Checking…"
      : result.status === "needs-install"
        ? "Install needed"
        : result.status === "needs-auth"
          ? "Sign-in needed"
          : "Couldn't connect";

  return (
    <div
      className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5"
      data-pipper-id={`agent-setup-card-${descriptor.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
          {result.status === "probing" ? (
            <CircleNotch size={14} className="animate-spin text-muted-foreground" />
          ) : result.status === "error" ? (
            <XCircleIcon size={14} weight="fill" className="text-red-500" />
          ) : (
            <WarningCircleIcon size={14} weight="fill" className="text-amber-500" />
          )}
          {descriptor.displayName}
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
          {statusLabel}
        </span>
      </div>

      {result.message ? (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{result.message}</p>
      ) : null}

      <div className="mt-2 flex items-center gap-3">
        {descriptor.docsUrl ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            data-pipper-id={`agent-setup-docs-${descriptor.id}`}
            onClick={() => void window.omni?.shell?.openExternal?.(descriptor.docsUrl!)}
          >
            Docs <ArrowSquareOutIcon size={11} />
          </button>
        ) : null}
        {result.status !== "probing" && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            data-pipper-id={`agent-setup-recheck-${descriptor.id}`}
            onClick={onRecheck}
          >
            <ArrowsClockwiseIcon size={11} /> Check again
          </button>
        )}
        <button
          type="button"
          className="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
          data-pipper-id={`agent-setup-skip-${descriptor.id}`}
          onClick={onSkip}
        >
          Skip
        </button>
      </div>
    </div>
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
  const metaText = !agent.available ? agent.installHint : agent.statusMessage;
  const statusLabel = selected ? "Selected" : agent.available ? "Ready" : "Setup";

  return (
    <div
      className={cn(
        "flex h-full flex-col gap-2 rounded-xl border p-4 transition-colors",
        selected
          ? "border-accent bg-accent/80 text-foreground"
          : "border-border/50 bg-surface-1/40 text-muted-foreground",
        unavailable && !selected && "opacity-80",
      )}
    >
      <button
        type="button"
        data-pipper-id={`agent-option-${agent.id}`}
        className={cn(
          "flex w-full flex-1 flex-col gap-2 text-left",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg",
          !selected && "hover:opacity-90",
          unavailable && "cursor-not-allowed",
        )}
        onClick={() => void onToggle()}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="shrink-0 text-muted-foreground/70">
            {selected ? (
              <CheckSquareIcon size={20} weight="fill" className="text-primary" />
            ) : (
              <SquareIcon size={20} />
            )}
          </span>

        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            {agent.displayName}
            {agent.available ? (
              <CheckCircleIcon className="shrink-0 text-emerald-500" size={14} weight="fill" />
            ) : (
              <WarningCircleIcon className="shrink-0 text-amber-500" size={14} weight="fill" />
            )}
          </span>
          {agent.description ? (
            <span className="text-xs leading-relaxed text-muted-foreground">{agent.description}</span>
          ) : null}
          {metaText ? (
            <span className="text-xs leading-snug text-muted-foreground/90">{metaText}</span>
          ) : null}
        </div>
      </button>

      {agent.docsUrl ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
          data-pipper-id={`agent-docs-${agent.id}`}
          onClick={() => void window.omni?.shell?.openExternal?.(agent.docsUrl!)}
        >
          Docs <ArrowSquareOutIcon size={12} />
        </button>
      ) : null}
    </div>
  );
}
