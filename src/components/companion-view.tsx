import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CaretDownIcon,
  CheckIcon,
  InfoIcon,
  MagnifyingGlassIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { usePipperStore } from "@/store/pipper-store";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { InputMessage } from "@/components/ui/input-message";
import { Streamdown } from "streamdown";
import { surfaceClasses } from "@/lib/surface-classes";
import { cn } from "@/lib/utils";
import { AmbientPixelField } from "@/components/ambient-pixel-field";
import { toast } from "@/components/ui/toast";
import type {
  AgentBridgeEvent,
  AgentModelSummary,
  AgentRuntimeSnapshot,
} from "../../contracts/agent.ts";
import { stringifyMessageContent, type MessageLike } from "@/lib/message-utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Elevated } from "@/lib/elevated";
import { ProviderMark, formatProviderName } from "@/components/agent-panel";

export function getMessageKey(message: MessageLike, index: number): string {
  const meta = message as { id?: string; toolCallId?: string };
  const uniqueId = meta.id ?? meta.toolCallId;
  if (uniqueId) return `${message.role ?? "message"}-${uniqueId}`;
  return `${message.role ?? "message"}-${index}`;
}

export function parseComponentAnnotation(
  bodyText: string,
): { componentId: string; text: string } | null {
  const normalized = bodyText.replace(/\r\n/g, "\n").trimStart();
  const match = normalized.match(/^\[component:\s*(.+?)\]\s*\n+([\s\S]+)$/i);
  if (!match) return null;
  return { componentId: match[1], text: match[2] };
}

export function isInternalCommitPrompt(message: MessageLike): boolean {
  if (message.role !== "user") return false;
  const text = stringifyMessageContent(message).trimStart();
  return (
    text.startsWith("[PIPPER_INTERNAL_COMMIT]") ||
    text.startsWith("<!-- pipper-internal-commit -->")
  );
}

export function formatModelCost(model: AgentModelSummary): string {
  if (!model.cost) return "Cost unavailable";
  const input = model.cost.input;
  const output = model.cost.output;
  if (!Number.isFinite(input) || !Number.isFinite(output))
    return "Cost unavailable";
  return `$${input.toFixed(input >= 1 ? 2 : 3)}/M in · $${output.toFixed(
    output >= 1 ? 2 : 3,
  )}/M out`;
}

const ANSI_PATTERN = new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, "g");

function cleanStatusText(text: string | null | undefined): string | null {
  const cleaned = text?.replace(ANSI_PATTERN, "").trim();
  return cleaned ? cleaned : null;
}

function patchEditorSnapshot(
  snapshot: AgentRuntimeSnapshot | null,
  patch: Partial<AgentRuntimeSnapshot>,
): AgentRuntimeSnapshot | null {
  if (!snapshot) return snapshot;
  return { ...snapshot, ...patch };
}

export function applyEditorBridgeEvent(
  snapshot: AgentRuntimeSnapshot | null,
  payload: AgentBridgeEvent,
): AgentRuntimeSnapshot | null {
  switch (payload.type) {
    case "snapshot":
      return payload.snapshot;
    case "status":
      return patchEditorSnapshot(snapshot, {
        status: { ...snapshot?.status, [payload.key]: payload.text },
      });
    case "working-message":
      return patchEditorSnapshot(snapshot, {
        workingMessage: payload.message ?? null,
      });
    case "working-visible":
      return patchEditorSnapshot(snapshot, { workingVisible: payload.visible });
    case "title":
      return patchEditorSnapshot(snapshot, { title: payload.title ?? null });
    case "editor-text":
      return patchEditorSnapshot(snapshot, { editorText: payload.text });
    case "event":
    case "ui-request":
    case "ui-response":
    case "notification":
      return snapshot;
  }
}

export function getEditorStatusItems(
  snapshot: AgentRuntimeSnapshot | null,
): string[] {
  if (!snapshot) return [];
  const items: string[] = [];
  if (snapshot.workingVisible) {
    const workingMessage = cleanStatusText(snapshot.workingMessage);
    if (workingMessage) items.push(workingMessage);
  }
  for (const value of Object.values(snapshot.status)) {
    const statusText = cleanStatusText(value);
    if (statusText) items.push(statusText);
  }
  const hiddenThinkingLabel = cleanStatusText(snapshot.hiddenThinkingLabel);
  if (hiddenThinkingLabel && snapshot.isStreaming)
    items.push(`Thinking: ${hiddenThinkingLabel}`);
  const editorText = cleanStatusText(snapshot.editorText);
  if (editorText) {
    items.push(
      `Draft: ${editorText.length > 120 ? `${editorText.slice(0, 117)}...` : editorText}`,
    );
  }
  if (snapshot.isCompacting) items.push("Compacting");
  if (snapshot.isRetrying) items.push("Retrying");
  return items.filter((item, index, all) => all.indexOf(item) === index);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

// ─── Editor session hook ───────────────────────────────────────────────────
function useEditorSession() {
  const [snapshot, setSnapshot] = useState<AgentRuntimeSnapshot | null>(null);
  const [isActivated, setIsActivated] = useState(false);
  const [isActivating, setIsActivating] = useState(true);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [activationAttempt, setActivationAttempt] = useState(0);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let active = true;

    async function activate() {
      try {
        setIsActivating(true);
        setActivationError(null);
        setIsActivated(false);
        if (window.omni?.editor?.onEvent) {
          unsubscribe = window.omni.editor.onEvent(
            (payload: AgentBridgeEvent) => {
              if (payload.type === "notification") {
                toast({
                  icon:
                    payload.level === "error" ? (
                      <WarningIcon className="size-5 text-red-500" />
                    ) : (
                      <InfoIcon className="size-5 text-blue-500" />
                    ),
                  title: payload.level.toUpperCase(),
                  description: payload.message,
                });
              }
              setSnapshot((current) =>
                applyEditorBridgeEvent(current, payload),
              );
            },
          );
        }
        await window.omni?.editor?.activate?.();
        const initial = await window.omni?.editor?.getState?.();
        if (!active) return;
        if (initial) setSnapshot(initial);
        setIsActivated(true);
      } catch (err) {
        console.error(
          "[CompanionView] Failed to activate editor session:",
          err,
        );
        if (active) {
          setActivationError(
            errorMessage(err, "Failed to activate editor session."),
          );
        }
      } finally {
        if (active) setIsActivating(false);
      }
    }

    void activate();

    return () => {
      active = false;
      unsubscribe?.();
      void window.omni?.editor?.dispose?.();
      void window.omni?.pipper?.exitEditMode?.();
      void window.omni?.pipper?.setProcessing?.(null);
    };
  }, [activationAttempt]);

  const sendPrompt = useCallback(
    async (message: string, streamingBehavior?: "followUp" | "steer") => {
      if (!message.trim()) return;
      await window.omni?.editor?.sendPrompt?.({ message, streamingBehavior });
    },
    [],
  );

  const abort = useCallback(async () => {
    await window.omni?.editor?.abort?.();
  }, []);

  const retryActivate = useCallback(() => {
    setActivationAttempt((value) => value + 1);
  }, []);

  return {
    snapshot,
    isActivated,
    isActivating,
    activationError,
    retryActivate,
    sendPrompt,
    abort,
  };
}

// ─── CompanionView ─────────────────────────────────────────────────────────
export function CompanionView() {
  const {
    snapshot,
    isActivated,
    isActivating,
    activationError,
    retryActivate,
    sendPrompt,
    abort,
  } = useEditorSession();
  const [inputValue, setInputValue] = useState("");
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [streamingBehavior, setStreamingBehavior] = useState<
    "followUp" | "steer"
  >("followUp");
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const { syncFromBroadcast } = usePipperStore();
  const overlayVisible = usePipperStore((state) => state.overlayVisible);
  const setOverlayVisible = usePipperStore((state) => state.setOverlayVisible);

  const [isProcessingAccept, setIsProcessingAccept] = useState(false);
  const [isProcessingReject, setIsProcessingReject] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [isSettingModel, setIsSettingModel] = useState(false);
  const [activePipperId, setActivePipperId] = useState<string | null>(null);

  const prevStreamingRef = useRef(false);

  const isStreaming = snapshot?.isStreaming ?? false;

  const handleAbort = useCallback(async () => {
    if (isStopping) return;
    setIsStopping(true);
    try {
      await abort();
      await window.omni?.pipper?.setProcessing?.(null);
    } catch (err) {
      setOperationError(errorMessage(err, "Failed to stop editor run."));
    } finally {
      setIsStopping(false);
    }
  }, [abort, isStopping]);

  const queueEditorPrompt = useCallback(
    async (message: string, behavior: "followUp" | "steer" | undefined) => {
      await sendPrompt(message, behavior);
    },
    [sendPrompt],
  );

  // ── 1. Enter edit mode immediately on mount ─────────────────────────────
  useEffect(() => {
    window.omni?.pipper?.enterEditMode?.().catch((err) => {
      setOperationError(errorMessage(err, "Failed to enter edit mode."));
    });
    const timer = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(timer);
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
      setActivePipperId(pipperId);
      queueEditorPrompt(
        `[Component: ${pipperId}]\n${text}`,
        isStreaming ? "followUp" : undefined,
      ).catch((err) => {
        setOperationError(errorMessage(err, "Failed to send overlay request."));
        void window.omni?.pipper?.setProcessing?.(null);
      });
    });
    return unsub;
  }, [isStreaming, queueEditorPrompt]);

  // ── 4. Clear beam when agent finishes streaming ──────────────────────────
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      void window.omni?.pipper?.setProcessing?.(null);
      if (overlayVisible) {
        void window.omni?.pipper?.enterEditMode?.();
      }
      setActivePipperId(null);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, overlayVisible]);

  useEffect(() => {
    if (!isModelDropdownOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        modelDropdownRef.current &&
        !modelDropdownRef.current.contains(target)
      ) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isModelDropdownOpen]);

  const activeMessages = (snapshot?.messages ?? []).filter(
    (m) =>
      ((m as MessageLike).role === "user" ||
        (m as MessageLike).role === "assistant") &&
      !isInternalCommitPrompt(m as MessageLike),
  );
  const streamingMessage =
    isStreaming && !isProcessingAccept
      ? (snapshot?.streamingMessage ?? null)
      : null;
  const models = snapshot?.models ?? [];
  const modelName = snapshot?.model?.name ?? "No model";
  const selectedModelProvider = snapshot?.model?.provider ?? null;
  const statusItems = useMemo(() => getEditorStatusItems(snapshot), [snapshot]);
  const queuedItems = [
    ...(snapshot?.queue.steering ?? []).map((text) => ({
      label: "Steer",
      text,
    })),
    ...(snapshot?.queue.followUp ?? []).map((text) => ({
      label: "Next",
      text,
    })),
  ];
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
  const conversationEntries = useMemo(() => {
    const entries = activeMessages.map((message, index) => ({
      key: getMessageKey(message as MessageLike, index),
      message: message as MessageLike,
      isStreaming: false,
    }));
    if (streamingMessage) {
      entries.push({
        key: "streaming",
        message: streamingMessage as MessageLike,
        isStreaming: true,
      });
    }
    return entries;
  }, [activeMessages, streamingMessage]);
  const conversationVirtualizer = useVirtualizer({
    count: conversationEntries.length,
    getScrollElement: () => messagesScrollRef.current,
    estimateSize: (index) =>
      conversationEntries[index]?.message.role === "user" ? 82 : 140,
    getItemKey: (index) => conversationEntries[index]?.key ?? index,
    overscan: 6,
  });
  const conversationScrollKey = useMemo(() => {
    const latest = conversationEntries[conversationEntries.length - 1];
    if (!latest) return `empty:${isStreaming}`;
    return [
      conversationEntries.length,
      latest.key,
      latest.isStreaming ? "streaming" : "settled",
      stringifyMessageContent(latest.message).length,
    ].join(":");
  }, [conversationEntries, isStreaming]);

  useEffect(() => {
    const scrollContainer = messagesScrollRef.current;
    if (!scrollContainer) return;
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }, [conversationScrollKey]);

  const handleSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !isActivated || isProcessingAccept || isProcessingReject)
      return;
    setInputValue("");
    setActivePipperId(null);
    setOperationError(null);
    await window.omni?.pipper?.setProcessing?.(null);
    try {
      await sendPrompt(trimmed, isStreaming ? streamingBehavior : undefined);
      setStreamingBehavior("followUp");
    } catch (err) {
      setInputValue(trimmed);
      setOperationError(errorMessage(err, "Failed to send editor request."));
    }
  };

  const handleSelectModel = async (model: AgentModelSummary) => {
    if (isSettingModel) return;
    setIsSettingModel(true);
    try {
      const success = await window.omni?.editor?.setModel?.({
        provider: model.provider,
        modelId: model.modelId,
      });
      if (success) {
        setIsModelDropdownOpen(false);
        setModelSearch("");
      } else {
        toast({
          icon: <WarningIcon className="size-5 text-red-500" />,
          title: "Model unchanged",
          description: "The selected editor model is unavailable.",
        });
      }
    } catch (err) {
      toast({
        icon: <WarningIcon className="size-5 text-red-500" />,
        title: "Model change failed",
        description: errorMessage(err, "Could not change the editor model."),
      });
    } finally {
      setIsSettingModel(false);
    }
  };

  const handleAccept = async () => {
    setIsProcessingAccept(true);
    setOperationError(null);
    try {
      const result = await window.omni?.pipper?.acceptChanges?.(
        "Accepted visual customization",
      );
      if (!result?.committed) {
        setOperationError("No edit-session changes to accept.");
        return;
      }
      await window.omni?.pipper?.exitEditMode?.();
      window.omni?.companion?.close?.();
    } catch (err) {
      console.error("[CompanionView] acceptChanges failed:", err);
      setOperationError(errorMessage(err, "Failed to accept changes."));
    } finally {
      setIsProcessingAccept(false);
    }
  };

  const handleReject = async () => {
    setIsProcessingReject(true);
    setOperationError(null);
    try {
      await window.omni?.pipper?.rejectChanges?.();
      await window.omni?.pipper?.exitEditMode?.();
      window.omni?.companion?.close?.();
    } catch (err) {
      console.error("[CompanionView] rejectChanges failed:", err);
      setOperationError(errorMessage(err, "Failed to reject changes."));
    } finally {
      setIsProcessingReject(false);
    }
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
      >
        <span className="text-xs font-medium text-muted-foreground"></span>
        <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <Switch
            label="Targeting"
            checked={overlayVisible}
            onToggle={() => {
              setOverlayVisible(!overlayVisible).catch((err) => {
                setOperationError(
                  errorMessage(err, "Failed to update targeting overlay."),
                );
              });
            }}
            className="px-0 py-0"
          />
        </div>
      </header>

      {/* ── Message Area ──────────────────────────────────────────────── */}
      <div
        ref={messagesScrollRef}
        className="relative z-10 flex-1 overflow-y-auto min-h-0 px-3 py-3"
      >
        {isEmpty ? (
          /* Empty state */
          <div className="flex min-h-full flex-col items-center justify-center gap-4 py-8 text-center select-none pointer-events-none">
            <div className="flex flex-col gap-1">
              <h2 className="text-2xl font-semibold text-foreground/55 tracking-tight">
                Edit Mode
              </h2>
            </div>
          </div>
        ) : (
          <div
            className="relative"
            style={{
              height: `${conversationVirtualizer.getTotalSize() + (isStreaming && !streamingMessage ? 44 : 0)}px`,
            }}
          >
            {conversationVirtualizer.getVirtualItems().map((virtualRow) => {
              const entry = conversationEntries[virtualRow.index];
              if (!entry) return null;
              const msg = entry.message;
              const from = msg.role === "user" ? "user" : "assistant";
              const bodyText = stringifyMessageContent(msg);
              if (!bodyText.trim()) return null;

              const componentAnnotation = parseComponentAnnotation(bodyText);
              const displayText =
                from === "user" && componentAnnotation
                  ? componentAnnotation.text
                  : bodyText;

              return (
                <div
                  key={virtualRow.key}
                  ref={conversationVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="absolute left-0 top-0 w-full pb-3"
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div
                    className={cn(
                      "flex max-w-[92%] flex-col gap-1",
                      from === "user"
                        ? "ml-auto items-end"
                        : "mr-auto items-start",
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
                          <Streamdown
                            mode={entry.isStreaming ? "streaming" : "static"}
                          >
                            {bodyText}
                          </Streamdown>
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
                          <p className="text-[13px] leading-relaxed text-foreground">
                            {displayText}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {isStreaming && !streamingMessage && !isProcessingAccept && (
              <div
                className="absolute left-0 flex justify-start"
                style={{ top: `${conversationVirtualizer.getTotalSize()}px` }}
              >
                <ThinkingIndicator />
              </div>
            )}
          </div>
        )}
      </div>

      {(activationError ||
        operationError ||
        activePipperId ||
        isActivating ||
        statusItems.length > 0 ||
        queuedItems.length > 0) && (
        <div className="flex flex-col gap-1 border-t border-border/40 bg-surface-2/35 px-3 py-2 text-[12px] text-muted-foreground shrink-0">
          {isActivating && <div>Activating editor...</div>}
          {activationError && (
            <div className="flex items-center justify-between gap-2 text-red-500">
              <span>{activationError}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={retryActivate}
              >
                Retry
              </Button>
            </div>
          )}
          {operationError && (
            <div className="text-red-500">{operationError}</div>
          )}
          {activePipperId && (
            <div className="flex flex-wrap gap-1.5">
              <span
                className={cn(
                  "rounded-md border border-border/60 px-2 py-1 text-foreground",
                  surfaceClasses(3, 2),
                )}
              >
                Editing @{activePipperId}
              </span>
            </div>
          )}
          {statusItems.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {statusItems.map((item) => (
                <span
                  key={item}
                  className="max-w-full truncate rounded-md border border-border/60 bg-surface-2 px-2 py-1"
                  title={item}
                >
                  {item}
                </span>
              ))}
            </div>
          )}
          {queuedItems.length > 0 && (
            <div className="flex flex-col gap-1">
              {queuedItems.map((item, index) => (
                <div
                  key={`${item.label}-${index}`}
                  className="line-clamp-2"
                  title={item.text}
                >
                  <span className="font-medium text-foreground/80">
                    {item.label}
                  </span>
                  : {item.text}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Actions Area ── */}
      {activeMessages.length > 0 &&
        isActivated &&
        !isStreaming &&
        !isProcessingAccept &&
        !isProcessingReject && (
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

      {isProcessingReject && (
        <div className="flex items-center justify-center gap-2 px-3 py-2 text-xs text-muted-foreground animate-pulse shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-ping" />
          Reverting changes...
        </div>
      )}

      {/* ── Input Area ────────────────────────────────────────────────── */}
      <div className={cn("relative z-10 shrink-0 p-2")}>
        <InputMessage
          textareaRef={inputRef}
          value={inputValue}
          onValueChange={setInputValue}
          onSend={handleSend}
          placeholder={
            isActivating
              ? "Activating editor..."
              : activationError
                ? "Editor unavailable"
                : isProcessingAccept
                  ? "Committing..."
                  : isProcessingReject
                    ? "Reverting..."
                    : "start here"
          }
          disabled={
            !isActivated ||
            isActivating ||
            Boolean(activationError) ||
            isProcessingAccept ||
            isProcessingReject
          }
          isStreaming={isStreaming}
          onStop={() => void handleAbort()}
          isStopping={isStopping}
          rightSlot={
            <div
              ref={modelDropdownRef}
              className="relative flex items-center gap-1.5"
            >
              <Button
                type="button"
                data-pipper-id="companion-model-selector"
                variant="ghost"
                size="sm"
                trailingIcon={CaretDownIcon}
                active={isModelDropdownOpen}
                disabled={models.length === 0 || isSettingModel || !isActivated}
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
                          if (event.key === "Escape")
                            setIsModelDropdownOpen(false);
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
                        const providerLabel = formatProviderName(
                          model.provider,
                        );
                        return (
                          <button
                            type="button"
                            key={`${model.provider}:${model.modelId}`}
                            aria-label={`${model.name}, ${providerLabel}, ${formatModelCost(model)}`}
                            title={`${model.name} · ${providerLabel} · ${formatModelCost(model)}`}
                            disabled={isSettingModel}
                            className={cn(
                              "group/model-row flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
                              isSelected
                                ? "bg-accent text-foreground"
                                : "text-muted-foreground hover:bg-hover hover:text-foreground",
                              isSettingModel && "cursor-not-allowed opacity-60",
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
                              <span className="block truncate text-foreground">
                                {model.name}
                              </span>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {providerLabel} · {formatModelCost(model)}
                              </span>
                            </span>
                            {isSelected && (
                              <CheckIcon
                                className="shrink-0"
                                size={13}
                                weight="bold"
                              />
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
