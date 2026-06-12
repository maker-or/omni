import { useEffect, useRef, useState, useCallback } from "react";
import { usePipperStore } from "@/store/pipper-store";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { InputMessage } from "@/components/ui/input-message";
import { Streamdown } from "streamdown";
import { surfaceClasses } from "@/lib/surface-classes";
import { cn } from "@/lib/utils";
import { AmbientPixelField } from "@/components/ambient-pixel-field";
import type {
  AgentBridgeEvent,
  AgentRuntimeSnapshot,
} from "../../contracts/agent.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

type MessageLike = AgentMessage & { role?: string };

function stringifyMessageContent(message: MessageLike): string {
  const content = (message as unknown as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const typed = part as { type?: string; text?: string; thinking?: string };
      if (typed.type === "text" && typeof typed.text === "string")
        return typed.text;
      if (typed.type === "thinking" && typeof typed.thinking === "string")
        return typed.thinking;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function getMessageKey(message: MessageLike, index: number): string {
  const meta = message as { id?: string; toolCallId?: string };
  const uniqueId = meta.id ?? meta.toolCallId;
  if (uniqueId) return `${message.role ?? "message"}-${uniqueId}`;
  return `${message.role ?? "message"}-${index}`;
}

// ─── Editor session hook ───────────────────────────────────────────────────
function useEditorSession() {
  const [snapshot, setSnapshot] = useState<AgentRuntimeSnapshot | null>(null);
  const [isActivated, setIsActivated] = useState(false);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    async function activate() {
      try {
        if (window.omni?.editor?.onEvent) {
          unsubscribe = window.omni.editor.onEvent(
            (payload: AgentBridgeEvent) => {
              if (payload.type === "snapshot") setSnapshot(payload.snapshot);
            },
          );
        }
        await window.omni?.editor?.activate?.();
        const initial = await window.omni?.editor?.getState?.();
        if (initial) setSnapshot(initial);
        setIsActivated(true);
      } catch (err) {
        console.error(
          "[CompanionView] Failed to activate editor session:",
          err,
        );
      }
    }

    void activate();

    return () => {
      unsubscribe?.();
      void window.omni?.editor?.dispose?.();
      void window.omni?.pipper?.exitEditMode?.();
      void window.omni?.pipper?.setProcessing?.(null);
    };
  }, []);

  const sendPrompt = useCallback(async (message: string) => {
    if (!message.trim()) return;
    await window.omni?.editor?.sendPrompt?.({ message });
  }, []);

  return { snapshot, isActivated, sendPrompt };
}

// ─── CompanionView ─────────────────────────────────────────────────────────
export function CompanionView() {
  const { snapshot, sendPrompt } = useEditorSession();
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { syncFromBroadcast } = usePipperStore();

  const activePipperIdRef = useRef<string | null>(null);
  const prevStreamingRef = useRef(false);

  // ── 1. Enter edit mode immediately on mount ─────────────────────────────
  useEffect(() => {
    void window.omni?.pipper?.enterEditMode?.();
    setTimeout(() => inputRef.current?.focus(), 120);
  }, []);

  // ── 2. Sync pipper state broadcasts from main window ────────────────────
  useEffect(() => {
    if (!window.omni?.pipper?.onStateChanged) return;
    const unsub = window.omni.pipper.onStateChanged((payload) =>
      syncFromBroadcast(payload),
    );
    return unsub;
  }, [syncFromBroadcast]);

  // ── 3. Auto-send when a comment arrives from the overlay ─────────────────
  useEffect(() => {
    if (!window.omni?.pipper?.onCommentAdded) return;
    const unsub = window.omni.pipper.onCommentAdded((pipperId, text) => {
      activePipperIdRef.current = pipperId;
      void sendPrompt(`[Component: ${pipperId}]\n${text}`);
    });
    return unsub;
  }, [sendPrompt]);

  // ── 4. Clear beam when agent finishes streaming ──────────────────────────
  useEffect(() => {
    const isStreaming = snapshot?.isStreaming ?? false;
    if (prevStreamingRef.current && !isStreaming) {
      void window.omni?.pipper?.setProcessing?.(null);
      activePipperIdRef.current = null;
    }
    prevStreamingRef.current = isStreaming;
  }, [snapshot?.isStreaming]);

  // ── 5. Scroll to bottom on new messages ─────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [snapshot?.messages, snapshot?.streamingMessage]);

  const activeMessages = (snapshot?.messages ?? []).filter(
    (m) =>
      (m as MessageLike).role === "user" ||
      (m as MessageLike).role === "assistant",
  );
  const isStreaming = snapshot?.isStreaming ?? false;
  const streamingMessage = isStreaming
    ? (snapshot?.streamingMessage ?? null)
    : null;

  const handleSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    setInputValue("");
    activePipperIdRef.current = null;
    await window.omni?.pipper?.setProcessing?.(null);
    await sendPrompt(trimmed);
  };

  const isEmpty = activeMessages.length === 0 && !streamingMessage;

  return (
    // The companion window lives at surface-1 (page substrate)
    <div
      className={cn(
        "relative h-screen w-screen flex flex-col overflow-hidden select-none",
        "bg-surface-1 text-foreground",
      )}
    >
      {isEmpty && (
        <AmbientPixelField
          pixelSize={6}
          gap={4}
          intensity={0.65}
          fadeStart={0.5}
          animated={true}
          className="absolute inset-0 z-0 pointer-events-none"
        />
      )}

      {/* ── Title Bar ─────────────────────────────────────────────────── */}
      <header
        className={cn(
          "h-9 flex items-center justify-between px-3 shrink-0",
          "border-b border-border/60",
          "bg-surface-1",
        )}
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      ></header>

      {/* ── Message Area ──────────────────────────────────────────────── */}
      <div className="relative z-10 flex-1 overflow-y-auto min-h-0 px-3 py-3 flex flex-col gap-3">
        {isEmpty ? (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-8 text-center select-none pointer-events-none">
            <div className="flex flex-col gap-1">
              <h2 className="text-2xl font-semibold text-foreground/55 tracking-tight">
                Edit Mode
              </h2>
            </div>
          </div>
        ) : (
          <>
            {activeMessages.map((message, index) => {
              const msg = message as MessageLike;
              const from = msg.role === "user" ? "user" : "assistant";
              const bodyText = stringifyMessageContent(msg);
              const msgId = getMessageKey(msg, index);
              if (!bodyText.trim()) return null;

              // Structured annotation: [Component: X]\ncomment
              const componentMatch = bodyText.match(
                /^\[Component:\s*(.+?)\]\n([\s\S]+)$/,
              );

              return (
                <div
                  key={msgId}
                  className={cn(
                    "flex flex-col gap-1 max-w-[92%]",
                    from === "user"
                      ? "self-end items-end"
                      : "self-start items-start",
                  )}
                >
                  {from === "user" && componentMatch ? (
                    /* Annotation bubble — surface-3 (floats above page) */
                    <div
                      className={cn(
                        "flex flex-col gap-1 rounded-xl px-3 py-2",
                        surfaceClasses(3, 2),
                      )}
                      style={{ maxWidth: 240 }}
                    >
                      <span
                        className={cn(
                          "inline-flex self-start items-center rounded-md px-1.5 py-0.5",
                          "text-[9px] font-bold tracking-wide uppercase text-foreground",
                          surfaceClasses(5, 3),
                        )}
                      >
                        {componentMatch[1]}
                      </span>
                      <p className="text-[12px] leading-relaxed text-foreground">
                        {componentMatch[2]}
                      </p>
                    </div>
                  ) : (
                    /* Regular message bubble */
                    <div
                      className={cn(
                        "rounded-xl px-3 py-2 text-[13px] whitespace-pre-wrap break-words",
                        from === "user"
                          ? cn("text-foreground", surfaceClasses(4, 3))
                          : "text-foreground",
                      )}
                    >
                      {from === "assistant" ? (
                        <div className="prose prose-sm max-w-none dark:prose-invert text-[13px] leading-relaxed">
                          <Streamdown mode="static">{bodyText}</Streamdown>
                        </div>
                      ) : (
                        bodyText
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Streaming assistant message */}
            {streamingMessage && (
              <div className="self-start max-w-[92%]">
                <div className="text-[13px] leading-relaxed text-foreground">
                  <div className="prose prose-sm max-w-none dark:prose-invert text-[13px]">
                    <Streamdown mode="streaming">
                      {stringifyMessageContent(streamingMessage as MessageLike)}
                    </Streamdown>
                  </div>
                </div>
              </div>
            )}

            {isStreaming && !streamingMessage && (
              <div className="flex justify-start">
                <ThinkingIndicator />
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* ── Input Area ────────────────────────────────────────────────── */}
      <div className={cn("relative z-10 shrink-0 p-2")}>
        <InputMessage
          textareaRef={inputRef}
          value={inputValue}
          onValueChange={setInputValue}
          onSend={handleSend}
          placeholder="start here"
        />
      </div>
    </div>
  );
}
