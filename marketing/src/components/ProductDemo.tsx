"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Diamond,
  Ellipsis,
  FileCode,
  FolderPlus,
  GitBranch,
  Minus,
  PanelLeft,
  Play,
  Plus,
  Rabbit,
} from "lucide-react";
import { Tabs, TabsList, TabItem } from "@/components/ui/tabs";

/**
 * Static replica of the advanced shell (`src/components/advanced-shell.tsx`).
 * Everything below mirrors that layout and `src/lib/workspace-tone.ts` so the
 * hero reads as the real product without dragging in the Electron runtime.
 */

/** Git-state tone, copied from `workspace-tone.ts`. "action" = PR open with
 *  checks still running. */
const TONE_COLOR = "#B1620D";
const HERO_ORANGE = "#FFAA4F";
const HERO_ORANGE_INK = "#A65B0E";
const toneInsetShadow = `inset 0 0 22px 2px ${TONE_COLOR}, inset 0 0 48px 8px ${TONE_COLOR}`;
const toneWash = `linear-gradient(to bottom, ${TONE_COLOR}100 0%, ${TONE_COLOR}1f 85%, ${TONE_COLOR}00 100%)`;

/** A small, stable set of heights so the card grid reads as an organic
 *  masonry rather than a uniform table — same list the shell hashes against. */
const CARD_HEIGHTS = [128, 168, 144, 188, 132, 160, 116, 176];

function cardHeight(path: string, selected: boolean): number {
  let hash = 0;
  for (let i = 0; i < path.length; i++) hash = (hash * 31 + path.charCodeAt(i)) >>> 0;
  const base = CARD_HEIGHTS[hash % CARD_HEIGHTS.length];
  return selected ? base + 24 : base;
}

const PROJECTS = [
  { name: "pipper", active: true },
  { name: "Nucleus", active: false },
  { name: "cln", active: false },
];

const WORKSPACES = [
  { name: "Rewrite the marketing hero", path: "/pipper/workspaces/hero", running: true },
  { name: "Fix login redirect loop", path: "/pipper/workspaces/auth" },
  { name: "Terminal · dev server", path: "/pipper/workspaces/terminal" },
  { name: "antigravity-rewrite", path: "/pipper/workspaces/antigravity", selected: true },
  { name: "Agent settings", path: "/pipper/workspaces/settings" },
  { name: "Nightly release", path: "/pipper/workspaces/release" },
];

const HIDDEN_WORKSPACE_COUNT = 3;

const sessions = [
  { value: "tab-1", label: "surprise", icon: FileCode },
  { value: "tab-2", label: "click here", icon: Play },
];

/** Static preview of the draft ThreadComposer and its turn identity marker. */
function Composer() {
  return (
    <div className="flex items-center gap-3" data-pipper-id="product-demo-composer">
      <span className="block size-8 shrink-0" data-pipper-id="user-turn-identity">
        <svg
          viewBox="0 0 29 29"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="block size-full"
          aria-hidden="true"
        >
          <rect width="29" height="29" rx="14.5" fill={HERO_ORANGE} />
          <path
            d="M6.84425 15.494C6.84425 10.8139 9.98266 7.77648 14.5159 7.77648C18.783 7.77648 21.8572 10.4652 21.8572 14.6498C21.8572 17.3936 20.5358 19.3666 18.3976 19.3666C17.2597 19.3666 16.3971 18.8251 16.2319 17.8983H16.1402C15.7364 18.8343 14.9105 19.3666 13.846 19.3666C11.9556 19.3666 10.6617 17.7882 10.6617 15.4848C10.6617 13.2182 11.9556 11.6765 13.7818 11.6765C14.7912 11.6765 15.6446 12.1446 16.0209 12.9613H16.1126V12.5024C16.1126 11.9885 16.4155 11.6765 16.9018 11.6765C17.3974 11.6765 17.691 11.9885 17.691 12.5024V17.054C17.691 17.6781 18.0489 18.0359 18.7096 18.0359C19.7282 18.0359 20.4257 16.687 20.4257 14.7599C20.4257 11.0617 17.7736 9.05203 14.4976 9.05203C10.7443 9.05203 8.2758 11.7041 8.2758 15.5491C8.2758 19.5226 10.937 21.8167 14.883 21.8167C15.7823 21.8167 16.4155 21.6882 17.2414 21.4864C17.3882 21.4588 17.5075 21.4497 17.5993 21.4497C17.9755 21.4497 18.1866 21.6515 18.1866 21.9727C18.1866 22.2939 17.9939 22.5417 17.4433 22.7252C16.7642 22.9546 15.7456 23.1014 14.5985 23.1014C10.0928 23.1014 6.84425 20.2659 6.84425 15.494ZM14.1672 17.935C15.3143 17.935 16.0576 16.9898 16.0576 15.4848C16.0576 14.0166 15.3235 13.0806 14.1672 13.0806C13.0385 13.0806 12.3594 13.9799 12.3594 15.494C12.3594 17.0173 13.0293 17.935 14.1672 17.935Z"
            fill={HERO_ORANGE_INK}
          />
        </svg>
      </span>
      <input
        aria-label="Prompt"
        className="min-h-11 min-w-0 flex-1 bg-transparent px-2 py-2 text-[14px] leading-5 text-foreground outline-none placeholder:text-muted-foreground"
        placeholder="@ a model, then describe the task…"
      />
    </div>
  );
}

/** Horizontal, scrollable project switcher pinned above the workspace grid. */
function ProjectTabs() {
  return (
    <div
      role="tablist"
      aria-label="Projects"
      className="flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {PROJECTS.map((project) => (
        <button
          key={project.name}
          type="button"
          role="tab"
          aria-selected={project.active}
          data-active={project.active ? "true" : undefined}
          className={
            "relative shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[15px] leading-none outline-none transition-colors duration-80 " +
            (project.active
              ? "font-medium text-foreground"
              : "text-muted-foreground/60 hover:text-foreground")
          }
        >
          {project.name}
          {project.active && (
            <span
              aria-hidden="true"
              className="absolute inset-x-2.5 -bottom-0.5 h-0.5 rounded-full bg-foreground/70"
            />
          )}
        </button>
      ))}
    </div>
  );
}

/** A single workspace rendered as a card in the grid. */
function WorkspaceCard({
  name,
  path,
  selected,
}: {
  name: string;
  path: string;
  selected?: boolean;
}) {
  return (
    <div className="group/card relative mb-2 break-inside-avoid">
      <button
        type="button"
        data-active={selected ? "true" : undefined}
        aria-current={selected ? "page" : undefined}
        style={{
          minHeight: cardHeight(path, Boolean(selected)),
          boxShadow: selected ? toneInsetShadow : undefined,
        }}
        className={
          "relative flex w-full flex-col overflow-hidden rounded-2xl p-3 text-left outline-none " +
          "transition-[background-color,color,box-shadow] duration-80 " +
          (selected
            ? "bg-surface-1 text-foreground"
            : "bg-[#262626] text-neutral-400 hover:bg-[#303030] hover:text-neutral-100")
        }
      >
        <span className="line-clamp-3 pr-5 text-[13px] font-medium leading-snug">{name}</span>
        {name.startsWith("Rewrite") && (
          <span
            className="mt-auto flex items-center gap-1 pt-2"
            title="1 agent running here"
            aria-label="1 agent running here"
          >
            <span className="size-[13px] rounded-[3px]" style={{ backgroundColor: HERO_ORANGE }} />
          </span>
        )}
      </button>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-md text-current opacity-0 transition-opacity duration-80 group-hover/card:opacity-100"
      >
        <Ellipsis size={16} />
      </span>
    </div>
  );
}

const CHECKS: { label: string; state: "passing" | "skipped"; showLink?: boolean }[] = [
  { label: "react-doctor", state: "passing" },
  { label: "Macroscope - Correctness Check", state: "skipped" },
  { label: "CodeRabbit", state: "passing", showLink: false },
  { label: "GitGuardian Security Checks", state: "passing" },
  { label: "Greptile Review", state: "passing" },
  { label: "React Doctor", state: "passing" },
  { label: "Vercel", state: "passing" },
  { label: "Vercel Preview Comments", state: "passing" },
];

const REVIEW_COMMENTS = [
  { name: "coderabbitai", count: 3, inline: 2, avatar: "rabbit" as const },
  { name: "greptile-apps", count: 12, inline: 12, avatar: "greptile" as const },
  { name: "github-actions", count: 1, avatar: "github" as const },
  { name: "qodo-code-review", count: 1, avatar: "qodo" as const },
];

function StateIcon({ state }: { state: "passing" | "skipped" }) {
  return state === "passing" ? (
    <Check size={16} strokeWidth={2.5} className="text-[#00c58d]" />
  ) : (
    <Minus size={16} strokeWidth={2.5} className="text-muted-foreground/60" />
  );
}

function ReviewAvatar({ kind }: { kind: (typeof REVIEW_COMMENTS)[number]["avatar"] }) {
  const colors = {
    rabbit: "bg-[#ff5a13] text-white",
    greptile: "bg-[#25d99a] text-[#003d30]",
    github: "bg-black text-white",
    qodo: "bg-[#6557c7] text-white",
  };
  const icon = {
    rabbit: <Rabbit size={16} fill="currentColor" />,
    greptile: <Diamond size={17} strokeWidth={3} />,
    github: <GitBranch size={16} strokeWidth={2.5} />,
    qodo: <span className="text-[15px] font-bold leading-none">Q</span>,
  }[kind];

  return (
    <span className={`grid size-5 shrink-0 place-items-center rounded-full ${colors[kind]}`}>
      {icon}
    </span>
  );
}

/** Right rail: the state header (PR pill + action + tabs) over the check list. */
function WorkspacePanel() {
  return (
    <aside
      aria-label="Workspace review and checks"
      className="flex w-96 shrink-0 flex-col overflow-y-auto border-l border-border text-left max-[1100px]:hidden"
    >
      {/* The git state reads as an inset glow behind the header, masked away
          toward the bottom edge so it flows into the body instead of banding
          across it. */}
      <div
        className="sticky top-0 z-20 shrink-0 rounded-tr-[16px] bg-surface-1 px-4 pb-8 pt-4"
        style={{ backgroundImage: toneWash }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 rounded-tr-[16px]"
          style={{
            boxShadow: toneInsetShadow,
            maskImage: "linear-gradient(to bottom, #000 60%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to bottom, #000 60%, transparent 100%)",
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-7 shrink-0 items-center overflow-hidden rounded-full border-2 border-white/30 bg-white/30 text-[12px] font-semibold text-white">
            <span className="px-2.5">#142</span>
            <span className="flex h-full items-center bg-white/30 px-1.5">
              <ArrowUpRight size={13} />
            </span>
          </span>
          <button
            type="button"
            className="ml-auto flex h-7 shrink-0 items-center overflow-hidden rounded-full bg-[#FFAA4F] text-[#4a2c05] transition-colors hover:bg-[#ffbb70]"
          >
            <span className="pl-3 pr-1 text-[12px] font-semibold">Push</span>
            <span className="flex items-center pl-1 pr-2">
              <ChevronDown size={13} />
            </span>
          </button>
        </div>
        <div className="mt-3 flex items-center gap-4 text-[13px] font-medium leading-5">
          <span className="text-[13px] font-medium capitalize text-white">Check</span>
          <span className="text-[13px] font-medium capitalize text-white/35">Changes</span>
        </div>
      </div>

      <div className="flex flex-col gap-7 px-4 py-4">
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold leading-6 text-foreground">antigravity-rewrite</h2>
          <ul className="list-disc pl-5 text-[13px] leading-6 text-muted-foreground">
            <li>Integrate official Antigravity ACP binary and harden connection lifecycle</li>
          </ul>
        </section>
        <section className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold text-foreground">Deployments</h3>
          <ul className="flex flex-col">
            <li className="flex min-h-8 items-center gap-2.5 py-1 text-[13px]">
              <span className="flex w-4 shrink-0 items-center justify-center">
                <StateIcon state="passing" />
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">Preview</span>
              <ArrowUpRight size={13} className="shrink-0 text-muted-foreground/70" />
            </li>
          </ul>
        </section>
        <section className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold text-foreground">Checks</h3>
          <ul className="flex flex-col">
            {CHECKS.map((check) => (
              <li key={check.label} className="flex min-h-8 items-center gap-2.5 py-1 text-[13px]">
                <span className="flex w-4 shrink-0 items-center justify-center">
                  <StateIcon state={check.state} />
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">{check.label}</span>
                {check.showLink !== false && (
                  <ArrowUpRight size={13} className="shrink-0 text-muted-foreground/70" />
                )}
              </li>
            ))}
          </ul>
        </section>
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
              Review comments
            </h3>
            <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
              Latest <ChevronDown size={13} />
            </span>
          </div>
          <ul className="flex flex-col">
            {REVIEW_COMMENTS.map((comment) => (
              <li
                key={comment.name}
                className="flex min-h-9 items-center gap-2 border-b border-white/10 px-3 py-1.5 text-[13px]"
              >
                <ReviewAvatar kind={comment.avatar} />
                <span className="min-w-0 truncate text-foreground">{comment.name}</span>
                <span className="text-muted-foreground/70">{comment.count}</span>
                {comment.inline && (
                  <span className="truncate text-[11px] text-muted-foreground/60">
                    {comment.inline} inline
                  </span>
                )}
                <ChevronRight size={16} className="ml-auto shrink-0 text-muted-foreground" />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  );
}

const SURPRISE_VIDEO_ID = "dQw4w9WgXcQ";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

function loadYouTubeAPI(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  });
}

export default function ProductDemo() {
  const [activeSession, setActiveSession] = useState("tab-1");
  const activeSessionRef = useRef(activeSession);
  activeSessionRef.current = activeSession;
  const playerHostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);

  // Create the player only after the page is interactive, so the YouTube
  // payload never competes with hero render. It then cues + buffers quietly
  // while the visitor reads, ready before they click.
  useEffect(() => {
    let cancelled = false;
    let idleId: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const init = () => {
      loadYouTubeAPI()
        .then((YT) => {
          if (cancelled || !playerHostRef.current || playerRef.current) return;
          playerRef.current = new YT.Player(playerHostRef.current, {
            videoId: SURPRISE_VIDEO_ID,
            width: "100%",
            height: "100%",
            playerVars: { rel: 0, preload: 1 },
            events: {
              onReady: (event: { target: { playVideo: () => void } }) => {
                if (!cancelled && activeSessionRef.current === "tab-2") event.target.playVideo();
              },
            },
          });
        })
        .catch(() => {});
    };

    if (typeof (window as any).requestIdleCallback === "function") {
      idleId = (window as any).requestIdleCallback(init, { timeout: 4000 });
    } else {
      timer = setTimeout(init, 2500);
    }
    return () => {
      cancelled = true;
      if (idleId !== null) (window as any).cancelIdleCallback?.(idleId);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Start / stop playback the moment the tab changes — no iframe mount wait.
  useEffect(() => {
    const player = playerRef.current;
    if (!player?.playVideo) return;
    if (activeSession === "tab-1") {
      player.pauseVideo?.();
    } else {
      player.playVideo();
    }
  }, [activeSession]);

  return (
    <section
      data-pipper-id="product-demo"
      aria-label="Pipper workspace preview"
      className="flex w-full shrink-0 justify-center overflow-hidden bg-transparent p-[clamp(0.9rem,2.4vw,3rem)]"
    >
      <div className="dark relative flex h-full min-h-[44rem] w-full max-w-[96rem] overflow-hidden rounded-[18px] border border-white/10 bg-surface-1 text-foreground">
        {/* Left rail: projects on top, workspace grid below. */}
        <aside
          aria-label="Projects and workspaces"
          className="flex w-80 shrink-0 flex-col border-r border-border max-[1100px]:hidden"
        >
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-end px-2 pt-3">
              <span
                aria-label="Collapse workspace sidebar"
                className="grid size-8 place-items-center rounded-4xl text-muted-foreground"
              >
                <PanelLeft size={16} />
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1 px-2 pb-2 pt-1">
              <div className="min-w-0 flex-1">
                <ProjectTabs />
              </div>
              <span
                aria-label="New workspace in pipper"
                className="grid size-8 shrink-0 place-items-center rounded-4xl text-muted-foreground"
              >
                <Plus size={16} />
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2">
              <div className="columns-2 gap-2">
                {WORKSPACES.map((workspace) => (
                  <WorkspaceCard
                    key={workspace.path}
                    name={workspace.name}
                    path={workspace.path}
                    selected={workspace.selected}
                  />
                ))}
              </div>
              <span className="mt-2 flex h-8 w-full items-center justify-center gap-2 rounded-md text-[12px] text-muted-foreground">
                <ChevronDown size={14} />
                Load more ({HIDDEN_WORKSPACE_COUNT})
              </span>
            </div>
          </div>
          <div className="shrink-0 border-t border-white/5 bg-[#1a1a1a] p-2">
            <div className="flex items-center gap-1">
              <span className="flex h-8 flex-1 items-center gap-2 rounded-md px-2 text-left text-[13px] text-neutral-400">
                <FolderPlus size={16} />
                New project
              </span>
            </div>
          </div>
        </aside>

        <main className="relative flex min-w-0 flex-1 overflow-hidden">
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex h-12 shrink-0 items-center gap-2 bg-surface-1 px-3">
              <div className="mx-auto mt-2 min-w-0 max-w-[1000px] px-4">
                <Tabs value={activeSession} onValueChange={setActiveSession}>
                  <TabsList className="min-w-0 max-w-full gap-1 overflow-x-auto p-1">
                    {sessions.map((session) => (
                      <TabItem
                        key={session.value}
                        value={session.value}
                        label={session.label}
                        icon={session.icon}
                      />
                    ))}
                  </TabsList>
                </Tabs>
              </div>
              <span
                aria-label="Toggle workspace panel"
                className="mt-2 hidden size-8 shrink-0 place-items-center rounded-4xl text-muted-foreground max-[1100px]:grid"
              >
                <PanelLeft size={16} className="-scale-x-100" />
              </span>
            </div>

            <div className="relative mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden">
              <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
                {activeSession === "tab-1" && (
                  <div className="relative z-20 shrink-0 px-3 pb-5 pt-2">
                    <Composer />
                  </div>
                )}
                <div
                  aria-hidden={activeSession !== "tab-2"}
                  className={
                    activeSession === "tab-2"
                      ? "flex h-full items-center justify-center p-4"
                      : "hidden"
                  }
                >
                  <div className="aspect-video w-full max-w-3xl overflow-hidden rounded-xl border border-white/10 bg-black">
                    <div ref={playerHostRef} className="h-full w-full" />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <WorkspacePanel />
        </main>
      </div>
    </section>
  );
}
