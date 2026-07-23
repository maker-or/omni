"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowsClockwiseIcon, CheckCircleIcon, CircleNotch } from "@phosphor-icons/react";
import { useAgentRegistryStore } from "@/store/agent-registry-store";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardFooter,
  CardGroup,
  CardHeader,
  CardMedia,
  CardTitle,
} from "@/components/ui/card";
import { createProviderLogoIcon } from "@/components/provider-logos";
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
}: {
  className?: string;
  onSelected?: (agentIds: string[]) => void;
  showContinue?: boolean;
  onContinue?: () => void | Promise<void>;
}) {
  const {
    agents,
    selectedAgentIds,
    connectionState,
    authRequiredMessage,
    error,
    probeResults,
    load,
    toggleAgent,
    probeAgents,
    skipAllSetup,
    resetSetupWalkthrough,
  } = useAgentRegistryStore();

  const [phase, setPhase] = useState<"select" | "walkthrough">("select");

  useEffect(() => {
    void load();
  }, [load]);

  const canContinue =
    selectedAgentIds.length > 0 && connectionState !== "connecting" && connectionState !== "error";

  // Continue only when no agent is still probing, and at least one is ready.
  // Failures don't block; "Skip setup for now" covers the all-failed case.
  const canFinish = useMemo(() => {
    if (selectedAgentIds.length === 0) return false;
    const anyStillLoading = selectedAgentIds.some((id) => {
      const status = probeResults[id]?.status;
      return status === undefined || status === "probing";
    });
    if (anyStillLoading) return false;
    return selectedAgentIds.some((id) => probeResults[id]?.status === "ready");
  }, [selectedAgentIds, probeResults]);

  if (phase === "walkthrough") {
    // Keep every selected agent on screen for the whole walkthrough so the
    // user always sees progress: spinner → check (ready) or retry (failed).
    const setupCards = selectedAgentIds.flatMap((id) => {
      const descriptor = agents.find((a) => a.id === id);
      if (!descriptor) return [];
      const result = probeResults[id] ?? { agentId: id, status: "probing" as const };
      return [
        <AgentSetupCard
          key={id}
          descriptor={descriptor}
          result={result}
          onRetry={() => void probeAgents([id])}
        />,
      ];
    });

    return (
      <div className={cn("flex flex-col gap-4", className)}>
        <h3 className="text-sm text-muted-foreground">Finishing setup</h3>

        <ScrollArea className="max-h-[380px]" viewportClassName="max-h-[380px] pr-2">
          <CardGroup
            orientation="inline"
            columns={2}
            separated
            border="outlined"
            data-pipper-id="agent-setup-group"
          >
            {setupCards}
          </CardGroup>
        </ScrollArea>

        <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-4">
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
      </div>
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
    <div className={cn("flex flex-col gap-4", className)}>
      <h3 className="text-sm text-muted-foreground">Choose agents</h3>

      <ScrollArea className="max-h-[420px]" viewportClassName="max-h-[420px] pr-2">
        {visibleAgents.length > 0 ? (
          <CardGroup
            orientation="inline"
            columns={2}
            separated
            border="outlined"
            data-pipper-id="agent-selector-group"
          >
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
          </CardGroup>
        ) : (
          <div className="col-span-full px-2 py-6 text-center text-sm text-muted-foreground">
            No ACP agents in the registry.
          </div>
        )}
      </ScrollArea>

      {authRequiredMessage && (
        <p className="text-sm text-muted-foreground" role="status">
          {authRequiredMessage}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {showContinue && (
        <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div
            className="min-w-0 text-sm text-muted-foreground"
            data-pipper-id="agent-selector-summary"
          >
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
            size="md"
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
            Continue
          </Button>
        </div>
      )}
    </div>
  );
}

function agentLogoKey(agent: AcpAgentDescriptor): string {
  return agent.icon ?? agent.id ?? agent.name;
}

/**
 * Select card — Fluid Functionalism Card anatomy:
 * CardMedia (logo) + CardHeader/CardTitle + CardFooter with Switch
 * (Switch stands in for CardButton as the card action).
 */
function AgentOption({
  agent,
  selected,
  onToggle,
}: {
  agent: AcpAgentDescriptor;
  selected: boolean;
  onToggle: () => void;
}) {
  const BrandIcon = useMemo(
    () => createProviderLogoIcon(agentLogoKey(agent), agent.displayName),
    [agent.id, agent.icon, agent.name, agent.displayName],
  );

  return (
    <Card selected={selected} data-pipper-id={`agent-option-${agent.id}`}>
      {/* Inline anatomy: media leading, header center, footer trailing (Switch). */}
      <CardMedia icon={BrandIcon} />
      <CardHeader>
        <CardTitle>{agent.displayName}</CardTitle>
      </CardHeader>
      <CardFooter>
        <Switch
          label={selected ? `Disable ${agent.displayName}` : `Enable ${agent.displayName}`}
          checked={selected}
          onToggle={onToggle}
          // Hide only the text label (last child span). Do not target the
          // switch root — Base UI renders it as a span too.
          className="px-0 py-0 gap-0 [&>span:last-of-type]:sr-only"
          data-pipper-id={`agent-option-switch-${agent.id}`}
        />
      </CardFooter>
    </Card>
  );
}

/**
 * Setup card — stays visible for the whole walkthrough.
 * Inline: logo + name + trailing status (spinner | check | retry).
 */
function AgentSetupCard({
  descriptor,
  result,
  onRetry,
}: {
  descriptor: AcpAgentDescriptor;
  result: AgentProbeResult;
  onRetry: () => void;
}) {
  const BrandIcon = useMemo(
    () => createProviderLogoIcon(agentLogoKey(descriptor), descriptor.displayName),
    [descriptor.id, descriptor.icon, descriptor.name, descriptor.displayName],
  );

  const status =
    result.status === "probing" || result.status === undefined
      ? "probing"
      : result.status === "ready"
        ? "ready"
        : "retry";

  const retryLabel =
    result.status === "needs-auth"
      ? `Sign in required for ${descriptor.displayName}. Retry after authenticating`
      : `Retry ${descriptor.displayName}`;

  return (
    <Card selected={status === "ready"} data-pipper-id={`agent-setup-card-${descriptor.id}`}>
      <CardMedia icon={BrandIcon} />
      <CardHeader>
        <CardTitle>{descriptor.displayName}</CardTitle>
      </CardHeader>
      <CardFooter>
        {status === "probing" ? (
          <CircleNotch
            size={16}
            className="animate-spin text-muted-foreground"
            aria-label={`Checking ${descriptor.displayName}`}
          />
        ) : status === "ready" ? (
          <CheckCircleIcon
            size={18}
            weight="fill"
            className="text-foreground"
            aria-label={`${descriptor.displayName} is ready`}
            data-pipper-id={`agent-setup-ready-${descriptor.id}`}
          />
        ) : (
          <button
            type="button"
            onClick={onRetry}
            title={result.message ?? retryLabel}
            aria-label={retryLabel}
            data-pipper-id={`agent-setup-retry-${descriptor.id}`}
            className="inline-flex size-7 items-center justify-center text-muted-foreground hover:text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <ArrowsClockwiseIcon size={16} />
          </button>
        )}
      </CardFooter>
    </Card>
  );
}
