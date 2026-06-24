"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { formatTokenCount } from "@/lib/format-tokens";
import { Tooltip } from "@/components/ui/tooltip";
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
  if (percent === null) return "text-muted-foreground/50";
  if (percent > 90) return "text-destructive";
  if (percent > 70) return "text-amber-500 dark:text-amber-400";
  return "text-foreground/70";
}

function buildTooltipContent({
  contextUsage,
  modelName,
  autoCompactionEnabled,
  sessionTokens,
  sessionCost,
}: Omit<ContextWindowRingProps, "size" | "className">): ReactNode {
  const { tokens, contextWindow, percent } = contextUsage ?? {};
  const hasWindow = typeof contextWindow === "number" && contextWindow > 0;
  const isUnknown = percent === null || tokens === null;

  const lines: string[] = [];

  if (hasWindow) {
    if (isUnknown) {
      lines.push(`Context: unknown / ${formatTokenCount(contextWindow)}`);
      lines.push("Usage updates after the next model response.");
    } else {
      lines.push(
        `Context: ${formatTokenCount(tokens)} / ${formatTokenCount(contextWindow)} (${percent.toFixed(1)}%)`,
      );
    }
  }

  if (modelName) lines.push(`Model: ${modelName}`);
  if (autoCompactionEnabled) lines.push("Auto-compaction: on");

  const sessionParts: string[] = [];
  if (typeof sessionTokens === "number" && sessionTokens > 0) {
    sessionParts.push(`${formatTokenCount(sessionTokens)} session tokens`);
  }
  if (typeof sessionCost === "number" && sessionCost > 0) {
    sessionParts.push(`$${sessionCost.toFixed(4)}`);
  }
  if (sessionParts.length > 0) lines.push(sessionParts.join(" · "));

  if (lines.length === 0) return "Context window";

  return (
    <span className="flex flex-col gap-0.5">
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
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
    <Tooltip
      content={buildTooltipContent({
        contextUsage: resolvedUsage,
        modelName,
        autoCompactionEnabled,
        sessionTokens,
        sessionCost,
      })}
      side="top"
    >
      <span className="inline-flex cursor-default items-center gap-1.5 rounded-full">
        {ring}
        <span className={cn("tabular-nums text-[12px]", fillColor)}>{label}</span>
      </span>
    </Tooltip>
  );
}
