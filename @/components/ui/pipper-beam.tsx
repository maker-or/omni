"use client";

import { type ReactNode } from "react";
import { usePipperStore } from "@/store/pipper-store";
import { cn } from "@/lib/utils";
import { BorderBeam } from "border-beam";

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
        <div className="pointer-events-none absolute inset-0 rounded-[inherit]">
          <BorderBeam size="pulse-inner" colorVariant="mono" className="w-full h-full">
            <div className="absolute inset-0 rounded-[inherit]" />
          </BorderBeam>
        </div>
      )}
    </div>
  );
}
