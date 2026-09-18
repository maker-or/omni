"use client";

import React, { useEffect, useRef, useState } from "react";
import { Tabs, TabsList, TabItem } from "@/components/ui/tabs";

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

const sessions = [
  { value: "tab-1", label: "surprise" },
  { value: "tab-2", label: "click here" },
];

const PROJECTS = ["omni"];
const MODELS = ["GPT - 7", "Fabel 6"];

type MenuKind = "project" | "model";

function Composer() {
  const [project, setProject] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [menu, setMenu] = useState<MenuKind | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const placeholder = !project
    ? "press @ for the project and @ for the model"
    : !model
      ? "press @ for the model"
      : "start typing your prompt";

  const focusInput = () => inputRef.current?.focus();

  // Track "@" typing: first free "@" opens the project menu, the next one
  // (once a project bubble exists) opens the model menu.
  function handleChange(value: string) {
    setPrompt(value);
    if (!value.endsWith("@")) {
      setMenu(null);
      return;
    }
    if (!project) setMenu("project");
    else if (!model) setMenu("model");
    else setMenu(null);
  }

  function commitMenuSelection(name: string) {
    if (menu === "project") setProject(name);
    else if (menu === "model") setModel(name);
    // Drop the "@" trigger char, close the menu, keep typing.
    setPrompt((current) => (current.endsWith("@") ? current.slice(0, -1) : current));
    setMenu(null);
    requestAnimationFrame(focusInput);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && menu) {
      event.preventDefault();
      const options = menu === "project" ? PROJECTS : MODELS;
      commitMenuSelection(options[0]);
      return;
    }
    if (event.key === "Escape") {
      setMenu(null);
      return;
    }
    // Empty input + Backspace removes the last bubble (model, then project).
    if (event.key === "Backspace" && prompt === "") {
      if (model) {
        event.preventDefault();
        setModel(null);
      } else if (project) {
        event.preventDefault();
        setProject(null);
      }
    }
  }

  const menuOptions = menu === "project" ? PROJECTS : MODELS;

  return (
    <div className="relative flex w-full max-w-3xl items-center justify-center gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full border border-[#088139] bg-[#26B25A] text-[14px] font-semibold text-[#088139]">
        @
      </span>
      {project && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#B1620D] bg-[#ffa946] px-2.5 py-1 text-[13px] font-medium text-[#a65b0e]">
          {project}
        </span>
      )}
      {model && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#2162ff] bg-[#d8e5ff] px-2.5 py-1 text-[13px] font-medium text-[#2162ff]">
          {model}
        </span>
      )}
      <input
        ref={inputRef}
        value={prompt}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Prompt"
        className="min-w-0 flex-1 bg-transparent text-[14px] text-white/90 outline-none placeholder:text-white/30"
        placeholder={placeholder}
      />
      {menu && (
        <div
          role="listbox"
          aria-label={menu === "project" ? "Projects" : "Models"}
          className="absolute left-11 top-full z-10 mt-2 w-52 overflow-hidden rounded-xl border border-white/10 bg-[#242424] shadow-2xl"
        >
          {menuOptions.map((name) => {
            const selected = menu === "project" ? name === project : name === model;
            return (
              <button
                key={name}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => commitMenuSelection(name)}
                className={`flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] transition-colors hover:bg-white/10 ${
                  selected ? "bg-white/10 text-white" : "text-white/85"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {selected && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                    className="shrink-0 text-white"
                  >
                    <path
                      d="M4 12.5 9.5 18 20 6.5"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ProductDemo() {
  const [activeSession, setActiveSession] = useState("tab-1");
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
      aria-label="Omni product preview"
      className="flex w-full shrink-0 justify-center overflow-hidden bg-transparent p-[clamp(0.9rem,2.4vw,3rem)]"
    >
      <div className="dark relative flex h-full min-h-[36rem] w-full max-w-6xl flex-col overflow-hidden rounded-[16px] border border-white/10 bg-[#1c1c1c] text-neutral-100">
        {/* Window header */}
        <header className="flex items-center gap-4 border-b border-white/[0.07] px-4 py-3">
          <div className="flex shrink-0 items-center gap-3">
            <div className="leading-tight text-center">
              <div className="text-[14px] font-semibold tracking-tight">omni</div>
              <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[11px] text-white/40">
                <span className="inline-flex items-center gap-1">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 256 256"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M232,64a32,32,0,1,0-40,31v17a8,8,0,0,1-8,8H96a23.84,23.84,0,0,0-8,1.38V95a32,32,0,1,0-16,0v66a32,32,0,1,0,16,0V144a8,8,0,0,1,8-8h88a24,24,0,0,0,24-24V95A32.06,32.06,0,0,0,232,64ZM64,64A16,16,0,1,1,80,80,16,16,0,0,1,64,64ZM96,192a16,16,0,1,1-16-16A16,16,0,0,1,96,192ZM200,80a16,16,0,1,1,16-16A16,16,0,0,1,200,80Z" />
                  </svg>
                  main
                </span>
                <span className="text-white/25">/</span>
                <span>main</span>
              </div>
            </div>
          </div>

          {/* Session tab strip */}
          <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
            <Tabs value={activeSession} onValueChange={setActiveSession} className="w-auto min-w-0">
              <TabsList className="w-full min-w-0 flex-1 gap-1 overflow-hidden rounded-full bg-white/[0.06]">
                {sessions.map((session) => (
                  <TabItem key={session.value} value={session.value} label={session.label} />
                ))}
              </TabsList>
            </Tabs>
            <button
              type="button"
              aria-label="New session"
              className="grid size-7 shrink-0 place-items-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path
                  d="M7 2v10M2 7h10"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <button
            type="button"
            aria-label="History"
            className="grid size-7 shrink-0 place-items-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M2.5 8a5.5 5.5 0 1 1 1.6 3.9M2.5 8V5.5M2.5 8h2.5M8 5.5V8l1.8 1.2"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </header>

        {/* Body: prompt on tab 1, preloaded video on tab 2.
            The player host stays mounted (hidden) so the video is cued
            before the first click — playback starts instantly. */}
        {activeSession === "tab-1" && (
          <div className="flex flex-1 items-start justify-center px-6 pt-8">
            <Composer />
          </div>
        )}
        <div
          className={`flex-1 items-center justify-center px-6 py-8 ${
            activeSession === "tab-1" ? "hidden" : "flex"
          }`}
        >
          <div className="aspect-video w-full max-w-3xl overflow-hidden rounded-xl border border-white/10">
            <div ref={playerHostRef} className="h-full w-full" />
          </div>
        </div>
      </div>
    </section>
  );
}
