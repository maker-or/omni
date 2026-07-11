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
        className={cn("rounded-xl border border-border p-3", className)}
      >
        <div className="mb-1 text-[12px] font-medium text-foreground">Finishing setup</div>
        <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
          Checking your selected agents. Anything that needs installing or signing in shows up below
          — skip any of them and set it up later.
        </p>

        <ScrollArea className="max-h-[280px]" viewportClassName="max-h-[280px] pr-2">
          <div className="flex flex-col gap-1.5">
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

        <div className="mt-3 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-pipper-id="agent-setup-skip-all"
            className="h-8 text-[11px] text-muted-foreground"
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
        Pipper talks to ACP agents over stdio — install and authenticate each one outside Pipper,
        then connect. Select all agents you want to use.
      </p>

      <ScrollArea className="max-h-[300px]" viewportClassName="max-h-[300px] pr-2">
        <div className="flex flex-col gap-1.5">
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
            <div className="px-2 py-3 text-[12px] text-muted-foreground">
              No ACP agents in the registry.
            </div>
          )}
        </div>
      </ScrollArea>

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

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 transition-colors",
        selected
          ? "border-accent bg-accent text-foreground"
          : "border-border/50 bg-surface-1/40 text-muted-foreground",
        unavailable && "opacity-70",
      )}
    >
      <button
        type="button"
        data-pipper-id={`agent-option-${agent.id}`}
        className={cn(
          "flex w-full items-center gap-2 text-left text-[13px]",
          unavailable && "cursor-not-allowed",
        )}
        onClick={() => void onToggle()}
      >
        <span className="shrink-0 text-muted-foreground/70">
          {selected ? (
            <CheckSquareIcon size={18} weight="fill" className="text-primary" />
          ) : (
            <SquareIcon size={18} />
          )}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="shrink-0 font-medium text-foreground">{agent.displayName}</span>
          {agent.available ? (
            <CheckCircleIcon className="shrink-0 text-emerald-500" size={13} weight="fill" />
          ) : (
            <WarningCircleIcon className="shrink-0 text-amber-500" size={13} weight="fill" />
          )}
          {agent.description ? (
            <span className="truncate text-[11px] text-muted-foreground/80">
              {agent.description}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
          {selected ? "Selected" : agent.available ? "Ready" : "Setup"}
        </span>
      </button>

      {metaText || agent.docsUrl ? (
        <div className="mt-1 flex items-center gap-3 pl-[26px]">
          {metaText ? (
            <span className="min-w-0 flex-1 truncate text-[11px] leading-snug text-muted-foreground">
              {metaText}
            </span>
          ) : null}
          {agent.docsUrl ? (
            <button
              type="button"
              className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
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
      ) : null}
    </div>
  );
}
