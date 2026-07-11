"use client";

import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Compact 5×5 dot grid with the four corners removed, giving a rounded
 * silhouette. Dots shimmer on staggered, deterministic delays to read as a
 * lightweight "working" loader — mirrors the app's boot-screen aesthetic.
 */
const CELL_MASK: ReadonlyArray<ReadonlyArray<0 | 1>> = [
  [0, 1, 1, 1, 0],
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
  [0, 1, 1, 1, 0],
];

export interface PixelGridLoaderProps {
  /** Overall square size in px. Default 16. */
  size?: number;
  className?: string;
}

// Deterministic pseudo-random in [0, 1) so each cell's twinkle phase is stable
// across renders (no flicker) while still looking scattered.
function cellPhase(r: number, c: number): number {
  const h = Math.sin(r * 12.9898 + c * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

export function PixelGridLoader({ size = 16, className }: PixelGridLoaderProps) {
  const gap = Math.max(1, Math.round(size * 0.09));

  const dots = useMemo<ReactNode[]>(() => {
    const nodes: ReactNode[] = [];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        if (!CELL_MASK[r][c]) {
          // Placeholder keeps grid auto-flow aligned to the right columns.
          nodes.push(<span key={`${r}-${c}`} aria-hidden />);
          continue;
        }
        nodes.push(
          <span
            key={`${r}-${c}`}
            aria-hidden
            className="rounded-full motion-reduce:!animate-none motion-reduce:!opacity-70"
            style={{
              backgroundColor: "currentColor",
              opacity: 0.15,
              animation: "pixel-loader-pulse 1.1s ease-in-out infinite",
              animationDelay: `${cellPhase(r, c) * 1.1}s`,
            }}
          />,
        );
      }
    }
    return nodes;
  }, []);

  return (
    <span
      role="status"
      aria-label="Working"
      className={cn("inline-grid shrink-0 align-middle", className)}
      style={{
        width: size,
        height: size,
        gridTemplateColumns: "repeat(5, 1fr)",
        gridTemplateRows: "repeat(5, 1fr)",
        gap,
      }}
    >
      {dots}
    </span>
  );
}
