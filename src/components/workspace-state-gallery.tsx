import { useState, type CSSProperties } from "react";
import { ArrowUpRight } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { SplitButton } from "@/components/workspace-split-button";
import {
  WorkspaceStateAction,
  WorkspaceStateBadge,
  WorkspaceStateSurface,
  workspaceStateStyle,
} from "@/components/workspace-state";
import { WORKSPACE_STATES, WORKSPACE_STATE_META, type HeaderTone } from "@/lib/workspace-tone";
import { ShapeProvider } from "@/lib/shape-context";

const ROLES = [
  ["Accent", "--workspace-state-accent"],
  ["Surface", "--workspace-state-surface"],
  ["On surface", "--workspace-state-on-surface"],
  ["Action", "--workspace-state-action"],
  ["On action", "--workspace-state-on-action"],
  ["Glow", "--workspace-state-glow"],
  ["Glow base", "--workspace-state-glow-background"],
  ["Badge", "--workspace-state-badge"],
  ["On badge", "--workspace-state-on-badge"],
] as const;

function StateSample({ tone }: { tone: HeaderTone }) {
  const meta = WORKSPACE_STATE_META[tone];
  const [active, setActive] = useState(true);
  const [tab, setTab] = useState("check");
  const [lastAction, setLastAction] = useState<string | null>(null);
  const preview = () => setLastAction(meta.action);
  return (
    <article
      data-state-sample={tone}
      className="border-t border-border p-4"
      style={workspaceStateStyle(tone)}
    >
      <div className="mb-3 flex items-center gap-2">
        <span
          aria-hidden
          className="size-2 rounded-full"
          style={{ backgroundColor: "var(--workspace-state-accent)" }}
        />
        <h3 className="text-[13px] font-semibold">{meta.label}</h3>
        <span className="ml-auto text-[10px] text-muted-foreground">{tone}</span>
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">{meta.description}</p>
      <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-3">
        <WorkspaceStateSurface
          tone={tone}
          active={active}
          offset={active ? 0 : 2}
          className="rounded-2xl"
        >
          <button
            type="button"
            aria-pressed={active}
            aria-label={`${meta.label} workspace selection`}
            onClick={() => setActive((value) => !value)}
            className="flex h-full min-h-28 w-full flex-col rounded-[inherit] p-3 text-left text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="font-medium">Workspace</span>
            <span className="mt-auto text-[10px] text-muted-foreground">
              {active ? "Selected" : "Unselected"}
            </span>
          </button>
        </WorkspaceStateSurface>
        <div className="min-w-0">
          <WorkspaceStateSurface tone={tone} variant="header" className="rounded-xl px-3 pt-3 pb-5">
            <div className="flex items-center justify-between gap-2">
              <WorkspaceStateBadge
                tone={tone}
                className="size-7 text-[15px]"
                aria-label={`${meta.label} badge`}
              >
                @
              </WorkspaceStateBadge>
              <WorkspaceStateAction
                tone={tone}
                appearance="tag"
                className="overflow-hidden rounded-full gap-0 px-0"
                onClick={() => setLastAction("Status badge")}
              >
                <span className="px-2.5">{tone === "neutral" ? "No PR" : "#32"}</span>
                {tone !== "neutral" && (
                  <span
                    className="flex h-full items-center px-1.5"
                    style={{ backgroundColor: "var(--workspace-state-tag-arrow-fill)" }}
                  >
                    <ArrowUpRight size={13} />
                  </span>
                )}
              </WorkspaceStateAction>
            </div>
            <div
              className="mt-3 flex gap-3"
              role="tablist"
              aria-label={`${meta.label} preview tabs`}
            >
              {["check", "changes"].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => setTab(value)}
                  className={`text-[11px] capitalize outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === value ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                >
                  {value}
                </button>
              ))}
            </div>
          </WorkspaceStateSurface>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {tone === "neutral" || tone === "action" || tone === "stale" ? (
              <SplitButton
                tone={tone}
                label={meta.action}
                onPrimary={preview}
                items={[
                  {
                    label: "Preview another action",
                    icon: <span aria-hidden>↗</span>,
                    onSelect: () => setLastAction("Menu action"),
                  },
                ]}
              />
            ) : (
              <WorkspaceStateAction tone={tone} onClick={preview}>
                {meta.action}
              </WorkspaceStateAction>
            )}
            <WorkspaceStateAction
              tone={tone}
              appearance="secondary"
              onClick={() => setLastAction("Secondary action")}
            >
              Continue
            </WorkspaceStateAction>
            <WorkspaceStateAction tone={tone} disabled>
              Disabled
            </WorkspaceStateAction>
          </div>
        </div>
      </div>
      <p className="mt-3 min-h-4 text-[10px] text-muted-foreground" role="status">
        {lastAction
          ? `Preview only: ${lastAction}`
          : "Click the workspace to compare selection. Hover or focus any control."}
      </p>
      <div className="mt-3 grid grid-cols-4 gap-2" aria-label={`${meta.label} color tokens`}>
        {ROLES.map(([label, token]) => (
          <div key={token}>
            <div
              data-token={token}
              className="h-6 rounded-md border border-border"
              style={
                label === "Glow"
                  ? {
                      backgroundColor: "var(--workspace-state-glow-background)",
                      boxShadow: "var(--workspace-state-glow)",
                    }
                  : ({ backgroundColor: `var(${token})` } as CSSProperties)
              }
            />
            <div className="mt-1 text-[9px] leading-3 text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
    </article>
  );
}

export function WorkspaceStateGallery() {
  const [view, setView] = useState<"both" | "light" | "dark">("both");
  const [shape, setShape] = useState<"pill" | "rounded">("pill");
  const themes = view === "both" ? (["light", "dark"] as const) : [view];
  return (
    <div className="space-y-5" data-pipper-id="workspace-state-gallery">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1" role="group" aria-label="Preview theme">
          {(["both", "light", "dark"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={view === value ? "secondary" : "ghost"}
              aria-pressed={view === value}
              onClick={() => setView(value)}
            >
              {value === "both" ? "Both themes" : value === "light" ? "Light" : "Dark"}
            </Button>
          ))}
        </div>
        <div className="flex gap-1" role="group" aria-label="Preview shape">
          {(["pill", "rounded"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={shape === value ? "secondary" : "ghost"}
              aria-pressed={shape === value}
              onClick={() => setShape(value)}
            >
              {value === "pill" ? "Pill" : "Rounded"}
            </Button>
          ))}
        </div>
      </div>
      <p className="text-[12px] leading-5 text-muted-foreground">
        The same components and Git states in both themes. These samples preview colors and
        interactions.
      </p>
      <ShapeProvider key={shape} defaultShape={shape}>
        <div className={view === "both" ? "grid gap-4 md:grid-cols-2" : "mx-auto max-w-lg"}>
          {themes.map((theme) => (
            <section
              key={theme}
              data-workspace-theme={theme}
              aria-label={`${theme === "light" ? "Light" : "Dark"} theme state samples`}
              className="rounded-2xl border border-border bg-surface-1 text-foreground"
            >
              <div className="px-4 py-4">
                <h2 className="text-[15px] font-semibold">
                  {theme === "light" ? "Light" : "Dark"}
                </h2>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {theme === "light"
                    ? "Graphite, amber, jade, iris, and sky"
                    : "Original color pairs"}
                </p>
              </div>
              {WORKSPACE_STATES.map((tone) => (
                <StateSample key={tone} tone={tone} />
              ))}
            </section>
          ))}
        </div>
      </ShapeProvider>
    </div>
  );
}
