"use client";

import { type ReactNode } from "react";
import { usePipperStore } from "@/store/pipper-store";
import { cn } from "@/lib/utils";

interface PipperBeamProps {
  /** The data-pipper-id that this element carries. If falsy, children are rendered as-is. */
  pipperId?: string;
  children: ReactNode;
  className?: string;
}

/**
 * PipperBeam wraps a component in an animated border beam when the agent is
 * processing that element. If no pipperId is provided (or the component doesn't
 * have one yet) the children render untouched — zero overhead.
 */
export function PipperBeam({ pipperId, children, className }: PipperBeamProps) {
  const processingId = usePipperStore((s) => s.processingId);

  const isActive = !!pipperId && processingId === pipperId;

  if (!pipperId) return <>{children}</>;

  return (
    <div
      data-pipper-id={pipperId}
      className={cn("relative", className)}
      style={{ isolation: "isolate" }}
    >
      {children}
      {isActive && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] border-2 border-transparent pipper-beam-active"
          style={{
            backgroundImage:
              "linear-gradient(var(--background), var(--background)), conic-gradient(from var(--pipper-beam-angle, 0deg), transparent 0%, oklch(0.7 0.2 260) 20%, oklch(0.8 0.15 200) 40%, transparent 60%)",
            backgroundOrigin: "border-box",
            backgroundClip: "padding-box, border-box",
            animation: "pipper-beam-spin 1.5s linear infinite",
          }}
        />
      )}
    </div>
  );
}

export default PipperBeam;
