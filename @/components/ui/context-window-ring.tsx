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

export interface ContextUsageSnapshot {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

interface ContextWindowRingProps {
  contextUsage?: ContextUsageSnapshot;
  /** Used when stats.contextUsage is absent but the selected model has a window size. */
  contextWindowFallback?: number;
  modelName?: string;
  autoCompactionEnabled?: boolean;
  sessionTokens?: number;
  sessionCost?: number;
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
  fillColor: string;
}

function ContextUsagePanel({
  contextUsage,
  modelName,
  autoCompactionEnabled,
  sessionTokens,
  sessionCost,
  fillColor,
}: ContextUsagePanelProps) {
  const { tokens, contextWindow, percent } = contextUsage;
  const isUnknown = percent === null || tokens === null;
  const showSession =
    (typeof sessionTokens === "number" && sessionTokens > 0) ||
    (typeof sessionCost === "number" && sessionCost > 0);
  const showDetails = Boolean(modelName || autoCompactionEnabled);

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
              {autoCompactionEnabled && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Auto-compaction</dt>
                  <dd
                    className="text-foreground"
                    style={{ fontVariationSettings: fontWeights.medium }}
                  >
                    On
                  </dd>
                </div>
              )}
            </dl>
          </>
        )}

        {showSession && (
          <>
            <div className="border-t border-border/60" />
            <dl className="space-y-1.5">
              {typeof sessionTokens === "number" && sessionTokens > 0 && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Session tokens</dt>
                  <dd className="tabular-nums text-foreground">
                    {formatTokenCount(sessionTokens)}
                  </dd>
                </div>
              )}
              {typeof sessionCost === "number" && sessionCost > 0 && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Session cost</dt>
                  <dd className="tabular-nums text-foreground">${sessionCost.toFixed(4)}</dd>
                </div>
              )}
            </dl>
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
