import { Check, Circle, CircleNotch } from "@phosphor-icons/react";
import type { UpdatePhase } from "../../contracts/updates.ts";

const STEPS: Array<{ phases: UpdatePhase[]; label: string }> = [
  { phases: ["preparing"], label: "Preserved your current version" },
  { phases: ["fetching-upstream"], label: "Downloaded upstream changes" },
  { phases: ["agent-running"], label: "Adapted update to your customizations" },
  { phases: ["installing-dependencies"], label: "Installed isolated dependencies" },
  { phases: ["validating", "ready-to-promote"], label: "Validated application" },
  { phases: ["promoting", "awaiting-health-check", "completed"], label: "Promoted safely" },
];

const ORDER: UpdatePhase[] = [
  "preparing",
  "fetching-upstream",
  "agent-running",
  "installing-dependencies",
  "validating",
  "ready-to-promote",
  "promoting",
  "awaiting-health-check",
  "completed",
];

export function UpdateProgressView({ phase }: { phase: UpdatePhase }) {
  const current = ORDER.indexOf(phase);
  return (
    <div className="space-y-2">
      {STEPS.map((step) => {
        const complete =
          phase === "completed" ||
          current > Math.max(...step.phases.map((item) => ORDER.indexOf(item)));
        const active = step.phases.includes(phase);
        return (
          <div key={step.label} className="flex items-center gap-2 text-sm">
            {complete ? (
              <Check className="size-4 text-green-500" />
            ) : active ? (
              <CircleNotch className="size-4 animate-spin text-blue-500" />
            ) : (
              <Circle className="size-4 text-muted-foreground/50" />
            )}
            <span className={complete || active ? "text-foreground" : "text-muted-foreground"}>
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
