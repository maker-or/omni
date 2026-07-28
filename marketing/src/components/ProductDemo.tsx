"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy02Icon, GitBranchIcon, Sun01Icon, Tick02Icon } from "@hugeicons/core-free-icons";

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
    <div className="group/lights flex items-center gap-1.5" aria-label="Window controls">
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
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-black/[0.055] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 dark:hover:bg-white/[0.08]"
    >
      {children}
    </button>
  );
}

export default function ProductDemo() {
  const [tab, setTab] = useState<DemoTab>("compression");
  const [dark, setDark] = useState(false);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState("");
  const [sentMessage, setSentMessage] = useState("");
  const [responseState, setResponseState] = useState<ResponseState>("idle");
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const active = conversations[tab];
  const transcript = useMemo(() => `${active.user}\n\n${active.answer}`, [active]);

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

  async function copyTranscript() {
    try {
      await navigator.clipboard.writeText(transcript);
    } catch {
      // Clipboard can be unavailable in an embedded preview. The visual state
      // still demonstrates the intended interaction.
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
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
      aria-label="Interactive product demo"
      className="h-svh w-[100svw] max-w-none shrink-0 overflow-hidden bg-black p-[clamp(0.9rem,2.4vw,3rem)] text-neutral-950"
    >
      <div
        className={`grid h-full min-h-0 grid-cols-[minmax(0,7fr)_minmax(15rem,3fr)] gap-[clamp(0.9rem,2.4vw,3rem)] max-[760px]:grid-cols-1 ${
          dark ? "dark" : ""
        }`}
      >
        <Elevated
          offset={1}
          shadowLevel={7}
          className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[22px] text-foreground"
        >
          <header className="grid min-h-[72px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 px-5">
            <div className="flex min-w-0 items-center gap-5">
              <TrafficLights />
              <div className="min-w-0 leading-tight">
                <div className="truncate text-[14px] font-medium tracking-[-0.01em]">
                  {active.project}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-muted-foreground">
                  <HugeiconsIcon icon={GitBranchIcon} size={13} strokeWidth={1.6} />
                  <span>{active.branch}</span>
                </div>
              </div>
            </div>

            <Tabs value={tab} onValueChange={changeTab}>
              <TabsList className="bg-muted/80">
                <TabItem value="compression" label="Middle-out compression" />
                <TabItem value="hooli" label="Hooli chat" />
              </TabsList>
            </Tabs>

            <div className="flex justify-self-end rounded-full w-fit bg-muted/80 p-1">
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
                label={copied ? "Copied transcript" : "Copy transcript"}
                onClick={copyTranscript}
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={copied ? "done" : "copy"}
                    initial={{ opacity: 0, scale: 0.75 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.75 }}
                    transition={{ duration: 0.12 }}
                  >
                    <HugeiconsIcon
                      icon={copied ? Tick02Icon : Copy02Icon}
                      size={19}
                      strokeWidth={1.6}
                    />
                  </motion.span>
                </AnimatePresence>
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
                  <div className="mx-auto flex min-h-full w-full max-w-[46rem] flex-col gap-5">
                    <ChatMessage from="user" time="just now">
                      {conversation.user}
                    </ChatMessage>

                    <ThinkingSteps defaultOpen className="w-full">
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

                    <div className="mt-auto pt-8">
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

        <Elevated
          offset={1}
          shadowLevel={7}
          aria-label="Secondary demo screen"
          className="min-h-0 min-w-0 rounded-[22px] max-[760px]:hidden"
        />
      </div>
    </section>
  );
}
