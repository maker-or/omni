"use client";

import { useEffect, useState } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { formatTokenCount } from "@/lib/format-tokens";
import { Elevated } from "@/lib/elevated";
import { fontWeights } from "@/lib/font-weight";
import { shapeMap } from "@/lib/shape-context";
import { springs } from "@/lib/springs";
import type { AcpRateLimitInfo } from "../../../contracts/acp.ts";

export interface ContextUsageSnapshot {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

/** Human label for a rate-limit window; falls back to prettifying the raw id. */
function rateLimitLabel(type?: string): string {
  switch (type) {
    case "five_hour":
      return "5-hour limit";
    case "seven_day":
    case "seven_day_overage_included":
      return "Weekly limit";
    case "seven_day_opus":
      return "Weekly limit (Opus)";
    case "seven_day_sonnet":
      return "Weekly limit (Sonnet)";
    case "overage":
      return "Overage";
    default:
      return type
        ? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
        : "Rate limit";
  }
}

/** Percent of the window remaining (0–100), or null when utilization is absent. */
function rateLimitPercentLeft(utilization?: number): number | null {
  if (typeof utilization !== "number" || Number.isNaN(utilization)) return null;
  // `utilization` is already a canonical 0–100 percent (normalized at the reducer).
  return Math.min(100, Math.max(0, Math.round(100 - utilization)));
}

/** Relative "resets in …" text; null when no reset timestamp is provided. */
function formatRateLimitReset(resetsAt?: number): string | null {
  if (typeof resetsAt !== "number" || resetsAt <= 0) return null;
  // Accept seconds or milliseconds since epoch.
  const epochMs = resetsAt > 1e12 ? resetsAt : resetsAt * 1000;
  const deltaMs = epochMs - Date.now();
  if (deltaMs <= 0) return "resets soon";
  const totalMin = Math.round(deltaMs / 60_000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return `resets in ${days}d${restHours ? ` ${restHours}h` : ""}`;
  }
  if (hours > 0) return `resets in ${hours}h${mins ? ` ${mins}m` : ""}`;
  return `resets in ${mins}m`;
}

function rateLimitColor(status: AcpRateLimitInfo["status"], percentLeft: number | null): string {
  if (status === "rejected") return "text-destructive";
  if (status === "allowed_warning") return "text-amber-500 dark:text-amber-400";
  if (percentLeft !== null && percentLeft <= 10) return "text-amber-500 dark:text-amber-400";
  return "text-foreground/80";
}

interface ContextWindowRingProps {
  contextUsage?: ContextUsageSnapshot;
  /** Used when stats.contextUsage is absent but the selected model has a window size. */
  contextWindowFallback?: number;
  modelName?: string;
  autoCompactionEnabled?: boolean;
  sessionTokens?: number;
  sessionCost?: number;
  /** Subscription rate limit, when the agent reports one. Section is hidden otherwise. */
  rateLimit?: AcpRateLimitInfo | null;
  size?: number;
  className?: string;
}

const popoverShape = shapeMap.rounded;

function resolveContextUsage(
  contextUsage: ContextUsageSnapshot | undefined,
  contextWindowFallback?: number,
): ContextUsageSnapshot | undefined {
  if (contextUsage && contextUsage.contextWindow > 0) return contextUsage;
  if (typeof contextWindowFallback === "number" && contextWindowFallback > 0) {
    return { tokens: null, contextWindow: contextWindowFallback, percent: null };
  }
  return undefined;
}

function getFillColor(percent: number | null): string {
  if (percent === null) return "text-muted-foreground";
  if (percent > 90) return "text-destructive";
  if (percent > 70) return "text-amber-500 dark:text-amber-400";
  return "text-foreground/80";
}

interface ContextUsagePanelProps {
  contextUsage: ContextUsageSnapshot;
  modelName?: string;
  autoCompactionEnabled?: boolean;
  sessionTokens?: number;
  sessionCost?: number;
  rateLimit?: AcpRateLimitInfo | null;
  fillColor: string;
}

function ContextUsagePanel({
  contextUsage,
  modelName,
  autoCompactionEnabled,
  sessionTokens,
  sessionCost,
  rateLimit,
  fillColor,
}: ContextUsagePanelProps) {
  const { tokens, contextWindow, percent } = contextUsage;
  const isUnknown = percent === null || tokens === null;
  const showSession =
    (typeof sessionTokens === "number" && sessionTokens > 0) ||
    (typeof sessionCost === "number" && sessionCost > 0);
  const showDetails = Boolean(modelName || autoCompactionEnabled);
  const rateLimitPercentLeftValue = rateLimit
    ? rateLimitPercentLeft(rateLimit.utilization)
    : null;
  const rateLimitReset = rateLimit ? formatRateLimitReset(rateLimit.resetsAt) : null;
  const rateLimitTextColor = rateLimit
    ? rateLimitColor(rateLimit.status, rateLimitPercentLeftValue)
    : "";

  return (
    <Elevated
      offset={2}
      shadowLevel={3}
      data-pipper-id="context-usage-panel"
      className={cn("w-[232px] rounded-xl border border-border/80 px-3 py-2.5", popoverShape.bg)}
    >
      <div className="space-y-2.5 text-[12px] leading-snug">
        <div>
          <p
            className="text-muted-foreground"
            style={{ fontVariationSettings: fontWeights.medium }}
          >
            Context
          </p>
          {isUnknown ? (
            <>
              <p
                className="mt-1 tabular-nums text-foreground"
                style={{ fontVariationSettings: fontWeights.medium }}
              >
                Unknown{" "}
                <span className="text-muted-foreground">/ {formatTokenCount(contextWindow)}</span>
              </p>
              <p className="mt-1 text-muted-foreground/80">
                Updates after the next model response.
              </p>
            </>
          ) : (
            <>
              <p
                className="mt-1 tabular-nums text-foreground"
                style={{ fontVariationSettings: fontWeights.medium }}
              >
                {formatTokenCount(tokens)}{" "}
                <span className="text-muted-foreground">/ {formatTokenCount(contextWindow)}</span>
              </p>
              <p
                className={cn("mt-0.5 tabular-nums", fillColor)}
                style={{ fontVariationSettings: fontWeights.medium }}
              >
                {percent.toFixed(1)}% used
              </p>
            </>
          )}
        </div>

        {showDetails && (
          <>
            <div className="border-t border-border/60" />
            <dl className="space-y-1.5">
              {modelName && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 text-muted-foreground">Model</dt>
                  <dd
                    className="min-w-0 truncate text-right text-foreground"
                    style={{ fontVariationSettings: fontWeights.medium }}
                  >
                    {modelName}
                  </dd>
                </div>
              )}
              {/*{autoCompactionEnabled && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Auto-compaction</dt>
                  <dd
                    className="text-foreground"
                    style={{ fontVariationSettings: fontWeights.medium }}
                  >
                    On
                  </dd>
                </div>
              )}*/}
            </dl>
          </>
        )}

        {showSession && (
          <>

            <dl className="space-y-1.5">
              {typeof sessionCost === "number" && sessionCost > 0 && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Session cost</dt>
                  <dd className="tabular-nums text-foreground">${sessionCost.toFixed(4)}</dd>
                </div>
              )}
            </dl>
          </>
        )}

        {rateLimit && (
          <>
            <div className="border-t border-border/60" />
            <div>
              <p
                className="text-muted-foreground"
                style={{ fontVariationSettings: fontWeights.medium }}
              >
                {rateLimitLabel(rateLimit.rateLimitType)}
              </p>
              {rateLimitPercentLeftValue !== null ? (
                <p
                  className={cn("mt-1 tabular-nums", rateLimitTextColor)}
                  style={{ fontVariationSettings: fontWeights.medium }}
                >
                  {rateLimitPercentLeftValue}% left
                </p>
              ) : null}
              {rateLimitReset && (
                <p className="mt-1 text-muted-foreground/80">
                  {rateLimitReset.charAt(0).toUpperCase() + rateLimitReset.slice(1)}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </Elevated>
  );
}

export function ContextWindowRing({
  contextUsage,
  contextWindowFallback,
  modelName,
  autoCompactionEnabled,
  sessionTokens,
  sessionCost,
  rateLimit,
  size = 20,
  className,
}: ContextWindowRingProps) {
  const resolvedUsage = resolveContextUsage(contextUsage, contextWindowFallback);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  if (!resolvedUsage) return null;

  const strokeWidth = 2.25;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const percent = resolvedUsage.percent;
  const isUnknown = percent === null || resolvedUsage.tokens === null;
  const fillPercent = isUnknown ? 0 : Math.min(Math.max(percent, 0), 100);
  const dashOffset = circumference * (1 - fillPercent / 100);
  const fillColor = getFillColor(percent);
  const label = isUnknown ? "?" : `${fillPercent.toFixed(0)}%`;

  const ring = (
    <span
      data-pipper-id="context-window-ring"
      role="img"
      aria-label={
        isUnknown
          ? `Context window ${formatTokenCount(resolvedUsage.contextWindow)}, usage unknown`
          : `Context window ${fillPercent.toFixed(0)}% full`
      }
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted-foreground/35"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className={fillColor}
          strokeDasharray={circumference}
          initial={false}
          animate={{
            strokeDashoffset: isUnknown ? circumference * 0.75 : dashOffset,
            opacity: isUnknown ? 0.5 : 1,
          }}
          transition={springs.fast}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
    </span>
  );

  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root open={open} onOpenChange={setOpen}>
        <TooltipPrimitive.Trigger asChild>
          <button
            type="button"
            className="inline-flex cursor-default items-center gap-1.5 rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Context window usage"
          >
            {ring}
            <span className={cn("tabular-nums text-[12px]", fillColor)}>{label}</span>
          </button>
        </TooltipPrimitive.Trigger>
        {mounted && (
          <TooltipPrimitive.Portal>
            <TooltipPrimitive.Content
              side="top"
              sideOffset={8}
              forceMount
              className="z-[250] border-0 bg-transparent p-0 shadow-none outline-none"
            >
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: open ? 1 : 0, y: open ? 0 : 4 }}
                transition={open ? springs.moderate : { duration: 0.1 }}
                onAnimationComplete={() => {
                  if (!open) setMounted(false);
                }}
              >
                <ContextUsagePanel
                  contextUsage={resolvedUsage}
                  modelName={modelName}
                  autoCompactionEnabled={autoCompactionEnabled}
                  sessionTokens={sessionTokens}
                  sessionCost={sessionCost}
                  rateLimit={rateLimit}
                  fillColor={fillColor}
                />
              </motion.div>
            </TooltipPrimitive.Content>
          </TooltipPrimitive.Portal>
        )}
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
