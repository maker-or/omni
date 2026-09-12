import { useState, type ReactNode } from "react";
import { ArrowUpRight, Check, Circle, CircleNotch, Minus, X } from "@phosphor-icons/react";
import { WorkspacePrComments } from "@/components/workspace-pr-comments";
import type {
  WorkspaceGitStatus,
  WorkspacePrCheck,
  WorkspacePrComment,
  WorkspacePrDeployment,
} from "../../contracts/git.ts";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { cn } from "@/lib/utils";

/** One "todo" row under Git status: what blocks the PR and the button that clears it. */
export interface PrStatusItem {
  key: string;
  label: string;
  /** Green check instead of the empty circle. */
  done?: boolean;
  action?: { label: string; onClick: () => void; disabled?: boolean };
}

function formatDuration(ms: number | null): string | null {
  if (ms == null) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function StateIcon({
  state,
}: {
  state: WorkspacePrCheck["state"] | WorkspacePrDeployment["state"];
}) {
  switch (state) {
    case "passing":
    case "success":
      return <Check size={13} weight="bold" className="text-emerald-500" />;
    case "failing":
    case "failure":
      return <X size={13} weight="bold" className="text-destructive" />;
    case "skipped":
    case "inactive":
      return <Minus size={13} weight="bold" className="text-muted-foreground/60" />;
    default:
      return <CircleNotch size={13} weight="bold" className="animate-spin text-amber-500" />;
  }
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1">
      <header className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        {action}
      </header>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

function LinkRow({
  icon,
  label,
  meta,
  url,
}: {
  icon: ReactNode;
  label: string;
  meta?: string | null;
  url: string | null;
}) {
  return (
    <li className="flex h-7 items-center gap-2 text-xs">
      <span className="flex w-4 shrink-0 justify-center">{icon}</span>
      <span className="min-w-0 truncate text-foreground" title={label}>
        {label}
      </span>
      {meta ? <span className="shrink-0 text-muted-foreground">{meta}</span> : null}
      <span className="flex-1" />
      {url ? (
        <button
          type="button"
          onClick={() => void window.omni.shell.openHttps(url).catch(() => {})}
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          title={url}
          aria-label={`Open ${label}`}
        >
          <ArrowUpRight size={13} />
        </button>
      ) : null}
    </li>
  );
}

const BODY_COLLAPSED_PX = 220;

export function WorkspacePrDetail({
  status,
  items,
  onAddComments,
}: {
  status: WorkspaceGitStatus;
  items: PrStatusItem[];
  /** Hand comments to the agent; absent when no workspace thread can take them. */
  onAddComments?: (comments: WorkspacePrComment[]) => void;
}) {
  const pr = status.pr;
  const [bodyExpanded, setBodyExpanded] = useState(false);
  if (!pr) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold leading-5 text-foreground">{pr.title}</h2>
        {pr.body.trim() ? (
          <div className="relative">
            <div
              className={cn("overflow-hidden text-xs text-muted-foreground")}
              style={bodyExpanded ? undefined : { maxHeight: BODY_COLLAPSED_PX }}
            >
              <MarkdownRenderer className="text-xs leading-5">{pr.body}</MarkdownRenderer>
            </div>
            {!bodyExpanded && pr.body.length > 400 ? (
              <button
                type="button"
                onClick={() => setBodyExpanded(true)}
                className="mt-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              >
                Show more
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {items.length > 0 ? (
        <Section title="Git status">
          {items.map((item) => (
            <li key={item.key} className="flex h-8 items-center gap-2 text-xs">
              <span className="flex w-4 shrink-0 justify-center">
                {item.done ? (
                  <Check size={13} weight="bold" className="text-emerald-500" />
                ) : (
                  <Circle size={13} className="text-muted-foreground/60" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">{item.label}</span>
              {item.action ? (
                <button
                  type="button"
                  disabled={item.action.disabled}
                  onClick={item.action.onClick}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  {item.action.label}
                </button>
              ) : null}
            </li>
          ))}
        </Section>
      ) : null}

      {pr.deployments.length > 0 ? (
        <Section title="Deployments">
          {pr.deployments.map((deployment, index) => (
            <LinkRow
              key={`${deployment.environment}-${index}`}
              icon={<StateIcon state={deployment.state} />}
              label={deployment.environment}
              url={deployment.url}
            />
          ))}
        </Section>
      ) : null}

      {status.checks.length > 0 ? (
        <Section title="Checks">
          {status.checks.map((check) => (
            <LinkRow
              key={check.name}
              icon={<StateIcon state={check.state} />}
              label={check.name}
              meta={formatDuration(check.durationMs)}
              url={check.url}
            />
          ))}
        </Section>
      ) : pr.state === "open" ? (
        <p className="text-xs text-muted-foreground">No checks reported yet.</p>
      ) : null}

      <WorkspacePrComments comments={pr.comments} onAddComments={onAddComments} />
    </div>
  );
}
