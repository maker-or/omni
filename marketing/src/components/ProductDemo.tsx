"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy02Icon, GitBranchIcon, Sun01Icon } from "@hugeicons/core-free-icons";

import { ChatMessage } from "@/components/ui/chat-message";
import { InputMessage } from "@/components/ui/input-message";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import {
  ThinkingStep,
  ThinkingSteps,
  ThinkingStepsContent,
  ThinkingStepsHeader,
} from "@/components/ui/thinking-steps";
import { Elevated } from "@/lib/elevated";
import { surfaceClasses } from "@/lib/surface-classes";
import { cn } from "@/lib/utils";

type DemoTab = "compression" | "hooli";
type ResponseState = "idle" | "thinking" | "done";

const conversations: Record<
  DemoTab,
  {
    user: string;
    answer: string;
    project: string;
    branch: string;
    file: string;
  }
> = {
  compression: {
    user: "Make middle-out compression better",
    answer:
      "Done. I moved boundary scoring ahead of chunk allocation and added a small overlap window. The benchmark keeps more context while using 18% fewer tokens.",
    project: "nucleus",
    branch: "main",
    file: "src/compression/middle-out.ts",
  },
  hooli: {
    user: "Summarize the Hooli launch thread",
    answer:
      "The launch stays on Thursday. Design approved the new empty state, infra wants a 10% canary first, and the only blocker is the migration dry run.",
    project: "hooli-web",
    branch: "launch/brief",
    file: "notes/launch-brief.md",
  },
};

function TrafficLights() {
  return (
    <div data-pipper-id="window-controls" className="group/lights flex items-center gap-1.5" aria-label="Window controls">
      <span className="size-2.5 rounded-full bg-neutral-400 transition-colors group-hover/lights:bg-[#ff5f57]" />
      <span className="size-2.5 rounded-full bg-neutral-400 transition-colors group-hover/lights:bg-[#febc2e]" />
      <span className="size-2.5 rounded-full bg-neutral-400 transition-colors group-hover/lights:bg-[#28c840]" />
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
  ...props
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  "data-pipper-id"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-black/[0.055] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 dark:hover:bg-white/[0.08]"
      {...props}
    >
      {children}
    </button>
  );
}

interface HighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
  pipperId: string;
}

interface CommentPopup {
  top: number;
  left: number;
  pipperId: string;
}

function getPopupPosition(rect: DOMRect): { top: number; left: number } {
  return {
    top: Math.max(8, Math.min(rect.bottom + 10, window.innerHeight - 200)),
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 320)),
  };
}

const defaultPrompts: Record<string, string> = {
  "window-controls": "Make the traffic light dots bigger and more rounded",
  "product-demo": "Add a subtle gradient border around the demo",
  "demo-header": "Reduce the header height and add a bottom separator",
  "project-info": "Make the project name bolder and larger",
  "demo-tabs": "Give the active tab a stronger highlight",
  "toolbar": "Add a gentle hover scale effect to the buttons",
  "chat-area": "Increase the gap between chat messages",
  "thinking-steps": "Make the thinking steps collapse smoother",
  "chat-input": "Darken the input background for better contrast",
};

function DemoOverlay() {
  const [processingId, setProcessingId] = useState<string | null>(null);
  const processingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlight, setHighlight] = useState<HighlightRect | null>(null);
  const [popup, setPopup] = useState<CommentPopup | null>(null);
  const [commentText, setCommentText] = useState("");
  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (processingTimer.current) clearTimeout(processingTimer.current);
    };
  }, []);

  useEffect(() => {
    if (popup) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [popup]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || !popup) return;
      setPopup(null);
      setCommentText("");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [popup]);

  function findPipperId(x: number, y: number): { el: HTMLElement; pipperId: string } | null {
    const top = document.elementsFromPoint(x, y).find(
      (node) => node !== overlayRef.current && node.getRootNode() === document,
    );
    if (!top) return null;
    const start = top instanceof HTMLElement ? top : top.parentElement;
    const pipper = start?.closest<HTMLElement>("[data-pipper-id]") ?? null;
    const pipperId = pipper?.getAttribute("data-pipper-id");
    if (!pipper || !pipperId) return null;
    return { el: pipper, pipperId };
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (popup || processingId) return;
    pointerRef.current = { x: e.clientX, y: e.clientY };
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const point = pointerRef.current;
      if (!point) return;
      const found = findPipperId(point.x, point.y);
      if (!found) {
        setHighlight(null);
        return;
      }
      const rect = found.el.getBoundingClientRect();
      setHighlight({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        pipperId: found.pipperId,
      });
    });
  }

  function handleClick(e: React.MouseEvent) {
    if (popup || processingId) return;
    const found = findPipperId(e.clientX, e.clientY);
    if (!found) return;
    const rect = found.el.getBoundingClientRect();
    const pos = getPopupPosition(rect);
    setHighlight({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      pipperId: found.pipperId,
    });
    setPopup({ top: pos.top, left: pos.left, pipperId: found.pipperId });
    setCommentText(defaultPrompts[found.pipperId] ?? "");
  }

  function handleMouseLeave() {
    if (!popup && !processingId) setHighlight(null);
  }

  return (
    <>
      <div
        ref={overlayRef}
        className="fixed inset-0 z-[9990]"
        style={{ cursor: "crosshair" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      />

      {highlight && processingId && (
        <div
          className="fixed z-[9991] pointer-events-none"
          style={{
            top: highlight.top - 2,
            left: highlight.left - 2,
            width: highlight.width + 4,
            height: highlight.height + 4,
          }}
        >
          <div
            className="absolute inset-0 rounded-sm"
            style={{
              boxShadow: "0 0 0 2px var(--ring), 0 0 0 4px color-mix(in oklab, var(--ring) 40%, transparent)",
              animation: "pipper-processing-pulse 0.8s ease-in-out infinite",
            }}
          />
        </div>
      )}

      {highlight && !popup && !processingId && (
        <div
          className="fixed z-[9991] pointer-events-none"
          style={{
            top: highlight.top - 2,
            left: highlight.left - 2,
            width: highlight.width + 4,
            height: highlight.height + 4,
            transition: "top 60ms, left 60ms, width 60ms, height 60ms",
          }}
        >
          <div
            className="absolute inset-0 rounded-sm ring-2 ring-ring"
            style={{ animation: "pipper-highlight-pulse 1.4s ease-in-out infinite" }}
          />
        </div>
      )}

      {popup && (
        <div
          className="fixed z-[9992] flex flex-col gap-2"
          style={{
            top: popup.top,
            left: popup.left,
            width: 308,
            animation: "pipper-popup-in 140ms ease-out both",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Elevated offset={2} shadowLevel={5} className="rounded-xl border border-border/80">
            <InputMessage
              value={commentText}
              onValueChange={setCommentText}
              onSend={(text) => {
                if (!text.trim() || !popup) return;
                const id = popup.pipperId;
                setPopup(null);
                setCommentText("");
                setProcessingId(id);
                if (processingTimer.current) clearTimeout(processingTimer.current);
                processingTimer.current = setTimeout(() => {
                  setProcessingId(null);
                  setHighlight(null);
                }, 1400);
              }}
              placeholder="Describe the change…"
              textareaRef={inputRef}
              leftSlot={() => (
                <span
                  className={cn(
                    "inline-flex items-center rounded-md px-1.5 py-0.5",
                    "text-[10px] font-bold text-foreground tracking-wide",
                    surfaceClasses(7, 4),
                  )}
                >
                  @ {popup.pipperId}
                </span>
              )}
              minRows={1}
              maxRows={4}
            />
          </Elevated>
        </div>
      )}
    </>
  );
}

export default function ProductDemo() {
  const [tab, setTab] = useState<DemoTab>("compression");
  const [dark, setDark] = useState(false);
  const [overlayActive, setOverlayActive] = useState(false);
  const [draft, setDraft] = useState("");
  const [sentMessage, setSentMessage] = useState("");
  const [responseState, setResponseState] = useState<ResponseState>("idle");
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const active = conversations[tab];

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );

  function clearFakeResponse() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setSentMessage("");
    setResponseState("idle");
  }

  function changeTab(value: string) {
    clearFakeResponse();
    setTab(value as DemoTab);
  }

  function submitMessage(value: string) {
    const next = value.trim();
    if (!next || responseState === "thinking") return;

    timers.current.forEach(clearTimeout);
    setDraft("");
    setSentMessage(next);
    setResponseState("thinking");
    timers.current = [window.setTimeout(() => setResponseState("done"), 2200)];
  }

  return (
    <section
      data-pipper-id="product-demo"
      aria-label="Interactive product demo"
      className="h-svh w-[100svw] max-w-none shrink-0 overflow-hidden bg-black p-[clamp(0.9rem,2.4vw,3rem)] text-neutral-950"
    >
      <Elevated
        offset={1}
        shadowLevel={7}
        className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[22px] text-foreground h-full ${dark ? "dark" : ""}`}
      >
          <header data-pipper-id="demo-header" className="grid min-h-[72px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 px-5">
            <div className="flex min-w-0 items-center gap-5">
              <TrafficLights />
              <div data-pipper-id="project-info" className="min-w-0 leading-tight">
                <div className="truncate text-[14px] font-medium tracking-[-0.01em]">
                  {active.project}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-muted-foreground">
                  <HugeiconsIcon icon={GitBranchIcon} size={13} strokeWidth={1.6} />
                  <span>{active.branch}</span>
                </div>
              </div>
            </div>

            <Tabs data-pipper-id="demo-tabs" value={tab} onValueChange={changeTab}>
              <TabsList className="bg-muted/80">
                <TabItem value="compression" label="Middle-out compression" />
                <TabItem value="hooli" label="Hooli chat" />
              </TabsList>
            </Tabs>

            <div data-pipper-id="toolbar" className="flex justify-self-end rounded-full w-fit bg-muted/80 p-1">
              <IconButton
                label={dark ? "Use light appearance" : "Use dark appearance"}
                onClick={() => setDark((value) => !value)}
              >
                <motion.span
                  animate={{ rotate: dark ? 180 : 0 }}
                  transition={{ type: "spring", stiffness: 360, damping: 25 }}
                >
                  <HugeiconsIcon icon={Sun01Icon} size={19} strokeWidth={1.6} />
                </motion.span>
              </IconButton>
              <IconButton
                label={overlayActive ? "Disable targeting" : "Enable targeting"}
                onClick={() => setOverlayActive((v) => !v)}
              >
                <HugeiconsIcon icon={Copy02Icon} size={19} strokeWidth={1.6} />
              </IconButton>
            </div>
          </header>

          <Tabs value={tab} onValueChange={changeTab} className="flex min-h-0 flex-1 flex-col">
            {(["compression", "hooli"] as const).map((value) => {
              const conversation = conversations[value];
              return (
                <TabPanel
                  key={value}
                  value={value}
                  className="min-h-0 flex-1 overflow-y-auto px-[clamp(1.25rem,5vw,6rem)] pb-5 pt-5"
                >
                  <div data-pipper-id="chat-area" className="mx-auto flex min-h-full w-full max-w-[46rem] flex-col gap-5">
                    <ChatMessage from="user" time="just now">
                      {conversation.user}
                    </ChatMessage>

                    <ThinkingSteps data-pipper-id="thinking-steps" defaultOpen className="w-full">
                      <ThinkingStepsHeader>Worked for 34 seconds</ThinkingStepsHeader>
                      <ThinkingStepsContent>
                        <ThinkingStep
                          icon="search"
                          label="Inspected the current implementation"
                          description={`Read ${conversation.file} and its closest tests.`}
                        />
                        <ThinkingStep
                          icon="brain"
                          label="Mapped the smallest safe change"
                          description="Kept the public API stable and isolated the hot path."
                        />
                        <ThinkingStep
                          icon="check"
                          label="Verified the result"
                          description="Focused tests pass and the benchmark improved."
                          isLast
                        />
                      </ThinkingStepsContent>
                    </ThinkingSteps>

                    <ChatMessage from="assistant">{conversation.answer}</ChatMessage>

                    {sentMessage && (
                      <ChatMessage from="user" time="now">
                        {sentMessage}
                      </ChatMessage>
                    )}

                    {responseState !== "idle" && (
                      <ThinkingSteps
                        defaultOpen
                        className="w-full"
                        key={`${sentMessage}-${responseState}`}
                      >
                        <ThinkingStepsHeader>
                          {responseState === "thinking"
                            ? "Working on your follow-up"
                            : "Worked for 12 seconds"}
                        </ThinkingStepsHeader>
                        <ThinkingStepsContent>
                          <ThinkingStep icon="search" label="Reading the active context" />
                          <ThinkingStep
                            icon="brain"
                            label="Preparing a focused update"
                            status={responseState === "thinking" ? "active" : "complete"}
                          />
                          <ThinkingStep
                            icon="check"
                            label="Updated the working tree"
                            status={responseState === "done" ? "complete" : "pending"}
                            isLast
                          />
                        </ThinkingStepsContent>
                      </ThinkingSteps>
                    )}

                    {responseState === "done" && (
                      <ChatMessage from="assistant">
                        I tightened that up and kept the change scoped. The preview has been updated
                        with the new result.
                      </ChatMessage>
                    )}

                    <div data-pipper-id="chat-input" className="mt-auto pt-8">
                      <Elevated
                        offset={1}
                        shadowLevel={3}
                        className="mx-auto w-full max-w-[35rem] rounded-3xl"
                      >
                        <InputMessage
                          value={draft}
                          onValueChange={setDraft}
                          onSend={(value) => submitMessage(value)}
                          placeholder="Ask pipper to change something…"
                          sendLabel="Send message"
                          minRows={2}
                          maxRows={4}
                          disabled={responseState === "thinking"}
                          className="bg-transparent shadow-none"
                        />
                      </Elevated>
                    </div>
                  </div>
                </TabPanel>
              );
            })}
          </Tabs>
        </Elevated>

      {overlayActive && <DemoOverlay />}
    </section>
  );
}
