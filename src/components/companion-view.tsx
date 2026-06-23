import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { CaretDownIcon, CheckIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { usePipperStore } from "@/store/pipper-store";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { InputMessage } from "@/components/ui/input-message";
import { Streamdown } from "streamdown";
import { surfaceClasses } from "@/lib/surface-classes";
import { cn } from "@/lib/utils";
import { AmbientPixelField } from "@/components/ambient-pixel-field";
import type {
  AgentBridgeEvent,
  AgentModelSummary,
  AgentRuntimeSnapshot,
} from "../../contracts/agent.ts";
import { stringifyMessageContent, type MessageLike } from "@/lib/message-utils";
import { Button } from "@/components/ui/button";
import { Elevated } from "@/lib/elevated";
import { ProviderMark, formatProviderName } from "@/components/agent-panel";

function getMessageKey(message: MessageLike, index: number): string {
  const meta = message as { id?: string; toolCallId?: string };
  const uniqueId = meta.id ?? meta.toolCallId;
  if (uniqueId) return `${message.role ?? "message"}-${uniqueId}`;
  return `${message.role ?? "message"}-${index}`;
}

function parseComponentAnnotation(bodyText: string): { componentId: string; text: string } | null {
  const match = bodyText.match(/^\[Component:\s*(.+?)\]\n([\s\S]+)$/);
  if (!match) return null;
  return { componentId: match[1], text: match[2] };
}

function isInternalCommitPrompt(message: MessageLike): boolean {
  if (message.role !== "user") return false;
  return stringifyMessageContent(message).includes(
    "Commit all completed changes to Git with a clear, descriptive commit message",
  );
}

function formatModelCost(model: AgentModelSummary): string {
  if (!model.cost) return "Cost unavailable";
  const input = model.cost.input;
  const output = model.cost.output;
  if (!Number.isFinite(input) || !Number.isFinite(output)) return "Cost unavailable";
  return `$${input.toFixed(input >= 1 ? 2 : 3)}/M in · $${output.toFixed(
    output >= 1 ? 2 : 3,
  )}/M out`;
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
          unsubscribe = window.omni.editor.onEvent((payload: AgentBridgeEvent) => {
            if (payload.type === "snapshot") setSnapshot(payload.snapshot);
          });
        }
        await window.omni?.editor?.activate?.();
        const initial = await window.omni?.editor?.getState?.();
        if (initial) setSnapshot(initial);
        setIsActivated(true);
      } catch (err) {
        console.error("[CompanionView] Failed to activate editor session:", err);
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
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const { syncFromBroadcast } = usePipperStore();

  const [isProcessingAccept, setIsProcessingAccept] = useState(false);

  const activePipperIdRef = useRef<string | null>(null);
  const prevStreamingRef = useRef(false);

  // ── 1. Enter edit mode immediately on mount ─────────────────────────────
  useEffect(() => {
    void window.omni?.pipper?.enterEditMode?.();
    const timer = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, []);

  // ── 2. Sync pipper state broadcasts from main window ────────────────────
  useEffect(() => {
    if (!window.omni?.pipper?.onStateChanged) return;
    const unsub = window.omni.pipper.onStateChanged((payload) => syncFromBroadcast(payload));
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

  useEffect(() => {
    if (!isModelDropdownOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(target)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isModelDropdownOpen]);

  const activeMessages = (snapshot?.messages ?? []).filter(
    (m) =>
      ((m as MessageLike).role === "user" || (m as MessageLike).role === "assistant") &&
      !isInternalCommitPrompt(m as MessageLike),
  );
  const isStreaming = snapshot?.isStreaming ?? false;
  const streamingMessage =
    isStreaming && !isProcessingAccept ? (snapshot?.streamingMessage ?? null) : null;
  const models = snapshot?.models ?? [];
  const modelName = snapshot?.model?.name ?? "No model";
  const selectedModelProvider = snapshot?.model?.provider ?? null;
  const visibleModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return models.filter((model) => {
      if (!query) return true;
      return (
        model.name.toLowerCase().includes(query) ||
        model.modelId.toLowerCase().includes(query) ||
        formatProviderName(model.provider).toLowerCase().includes(query)
      );
    });
  }, [modelSearch, models]);

  const handleSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming || isProcessingAccept) return;
    setInputValue("");
    activePipperIdRef.current = null;
    await window.omni?.pipper?.setProcessing?.(null);
    await sendPrompt(trimmed);
  };

  const handleSelectModel = async (model: AgentModelSummary) => {
    const success = await window.omni?.editor?.setModel?.({
      provider: model.provider,
      modelId: model.modelId,
    });
    if (success) {
      setIsModelDropdownOpen(false);
      setModelSearch("");
    }
  };

  const handleAccept = async () => {
    setIsProcessingAccept(true);
    try {
      await window.omni?.pipper?.acceptChanges?.("Accepted visual customization");
      await window.omni?.pipper?.exitEditMode?.();
      window.omni?.companion?.close?.();
    } catch (err) {
      console.error("[CompanionView] acceptChanges failed:", err);
    } finally {
      setIsProcessingAccept(false);
    }
  };

  const handleReject = async () => {
    try {
      await window.omni?.pipper?.rejectChanges?.();
    } catch (err) {
      console.error("[CompanionView] rejectChanges failed:", err);
    }
    await window.omni?.pipper?.exitEditMode?.();
    window.omni?.companion?.close?.();
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

              const componentAnnotation = parseComponentAnnotation(bodyText);
              const displayText =
                from === "user" && componentAnnotation ? componentAnnotation.text : bodyText;

              return (
                <div
                  key={msgId}
                  className={cn(
                    "flex flex-col gap-1 max-w-[92%]",
                    from === "user" ? "self-end items-end" : "self-start items-start",
                  )}
                >
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
                      <div className="flex flex-col gap-1">
                        {componentAnnotation && (
                          <span
                            className={cn(
                              "inline-flex self-start items-center rounded-md px-1.5 py-0.5",
                              "text-[9px] font-bold tracking-wide uppercase text-foreground",
                              surfaceClasses(5, 3),
                            )}
                          >
                            {componentAnnotation.componentId}
                          </span>
                        )}
                        <p className="text-[13px] leading-relaxed text-foreground">{displayText}</p>
                      </div>
                    )}
                  </div>
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

            {isStreaming && !streamingMessage && !isProcessingAccept && (
              <div className="flex justify-start">
                <ThinkingIndicator />
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* ── Actions Area ── */}
      {activeMessages.length > 0 && !isStreaming && !isProcessingAccept && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border/40 bg-surface-2/40 backdrop-blur-md shrink-0">
          <Button
            variant="tertiary"
            size="sm"
            className="flex-1 text-red-500 hover:text-red-400 hover:bg-red-500/10 border-red-500/20"
            onClick={handleReject}
          >
            Reject
          </Button>
          <Button
            variant="tertiary"
            size="sm"
            className="flex-1 text-green-500 hover:text-green-400 hover:bg-green-500/10 border-green-500/20"
            onClick={handleAccept}
          >
            Accept
          </Button>
        </div>
      )}

      {isProcessingAccept && (
        <div className="flex items-center justify-center gap-2 px-3 py-2 text-xs text-muted-foreground animate-pulse shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-ping" />
          Committing changes & updating patch.md...
        </div>
      )}

      {/* ── Input Area ────────────────────────────────────────────────── */}
      <div className={cn("relative z-10 shrink-0 p-2")}>
        <InputMessage
          textareaRef={inputRef}
          value={inputValue}
          onValueChange={setInputValue}
          onSend={handleSend}
          placeholder={isProcessingAccept ? "Committing..." : "start here"}
          disabled={isProcessingAccept}
          rightSlot={
            <div ref={modelDropdownRef} className="relative flex items-center">
              <Button
                type="button"
                data-pipper-id="companion-model-selector"
                variant="ghost"
                size="sm"
                trailingIcon={CaretDownIcon}
                active={isModelDropdownOpen}
                disabled={models.length === 0}
                onClick={() => setIsModelDropdownOpen((value) => !value)}
                title={
                  snapshot?.model
                    ? `${snapshot.model.name} · ${formatModelCost(snapshot.model)}`
                    : undefined
                }
              >
                <span className="inline-flex min-w-0 max-w-[150px] items-center gap-1.5">
                  {selectedModelProvider && (
                    <ProviderMark
                      provider={selectedModelProvider}
                      className="h-3.5 w-3.5 opacity-85"
                    />
                  )}
                  <span className="truncate">{modelName}</span>
                </span>
              </Button>

              {isModelDropdownOpen && models.length > 0 && (
                <div
                  data-pipper-id="companion-model-dropdown"
                  className="absolute right-0 bottom-full z-[250] mb-1.5"
                >
                  <Elevated
                    offset={2}
                    shadowLevel={5}
                    className="flex h-[320px] w-[320px] flex-col overflow-hidden rounded-xl border border-border/80 p-1.5"
                  >
                    <label className="flex h-9 shrink-0 items-center gap-2 px-2.5 text-muted-foreground focus-within:text-foreground">
                      <MagnifyingGlassIcon size={14} />
                      <input
                        value={modelSearch}
                        onChange={(event) => setModelSearch(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setIsModelDropdownOpen(false);
                        }}
                        placeholder="Find a model"
                        aria-label="Find a model"
                        className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60"
                        autoFocus
                      />
                    </label>
                    <div className="mx-2 border-t border-border/60" />
                    <div className="min-h-0 flex-1 overflow-y-auto py-1">
                      {visibleModels.map((model) => {
                        const isSelected =
                          model.provider === snapshot?.model?.provider &&
                          model.modelId === snapshot?.model?.modelId;
                        const providerLabel = formatProviderName(model.provider);
                        return (
                          <button
                            type="button"
                            key={`${model.provider}:${model.modelId}`}
                            aria-label={`${model.name}, ${providerLabel}, ${formatModelCost(model)}`}
                            title={`${model.name} · ${providerLabel} · ${formatModelCost(model)}`}
                            className={cn(
                              "group/model-row flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
                              isSelected
                                ? "bg-accent text-foreground"
                                : "text-muted-foreground hover:bg-hover hover:text-foreground",
                            )}
                            onClick={() => void handleSelectModel(model)}
                          >
                            <span
                              aria-hidden
                              className={cn(
                                "flex size-7 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold transition-colors",
                                isSelected
                                  ? "border-border/70 bg-surface-4 text-foreground"
                                  : "border-transparent bg-transparent text-muted-foreground/70 group-hover/model-row:bg-surface-3 group-hover/model-row:text-foreground",
                              )}
                            >
                              <ProviderMark provider={model.provider} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-foreground">{model.name}</span>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {providerLabel} · {formatModelCost(model)}
                              </span>
                            </span>
                            {isSelected && (
                              <CheckIcon className="shrink-0" size={13} weight="bold" />
                            )}
                          </button>
                        );
                      })}
                      {visibleModels.length === 0 && (
                        <div className="flex h-24 items-center justify-center px-6 text-center text-[12px] text-muted-foreground">
                          No matching models
                        </div>
                      )}
                    </div>
                  </Elevated>
                </div>
              )}
            </div>
          }
        />
      </div>
    </div>
  );
}
