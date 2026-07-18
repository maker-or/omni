import { useEffect, useRef, useState, useCallback } from "react";
import { WarningIcon } from "@phosphor-icons/react";
import { usePipperStore } from "@/store/pipper-store";
import { InputMessage } from "@/components/ui/input-message";
import { surfaceClasses } from "@/lib/surface-classes";
import { cn } from "@/lib/utils";
import { BorderBeam } from "border-beam";
import { Elevated } from "@/lib/elevated";
import { toast } from "@/components/ui/toast";

interface HighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
  pipperId: string;
  label: string;
}

interface CommentPopup {
  top: number;
  left: number;
  pipperId: string;
  label: string;
  elementRect: DOMRect;
}

function getPipperElementById(pipperId: string): HTMLElement | null {
  // Single attribute-selector query instead of enumerating every
  // [data-pipper-id] element and comparing in JS.
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(pipperId)
      : pipperId.replace(/["\\]/g, "\\$&");
  return document.querySelector<HTMLElement>(`[data-pipper-id="${escaped}"]`);
}

function getPopupPosition(rect: DOMRect): { top: number; left: number } {
  return {
    top: Math.max(8, Math.min(rect.bottom + 10, window.innerHeight - 200)),
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 320)),
  };
}

function rectChanged(rect: DOMRect, highlight: HighlightRect): boolean {
  return (
    Math.abs(rect.top - highlight.top) > 0.5 ||
    Math.abs(rect.left - highlight.left) > 0.5 ||
    Math.abs(rect.width - highlight.width) > 0.5 ||
    Math.abs(rect.height - highlight.height) > 0.5
  );
}

/**
 * PipperOverlay — full-screen crosshair layer.
 *
 * Lifecycle:
 *   Hover  → highlight rect + label chip on [data-pipper-id] elements
 *   Click  → inline comment popup appears (highlight stays)
 *   Submit → pipper:setProcessing(id) activates beam; pipper:addComment IPC fires;
 *            companion auto-sends the prompt; popup closes
 *   Esc ×1 → dismiss popup (if open) or arm exit counter
 *   Esc ×2 → exit edit mode + close companion
 */
export function PipperOverlay() {
  const editMode = usePipperStore((s) => s.editMode);
  const overlayVisible = usePipperStore((s) => s.overlayVisible);
  const processingId = usePipperStore((s) => s.processingId);
  const exitEditMode = usePipperStore((s) => s.exitEditMode);

  const isBeaming = !!processingId;

  const [highlight, setHighlight] = useState<HighlightRect | null>(null);
  const [popup, setPopup] = useState<CommentPopup | null>(null);
  const [commentText, setCommentText] = useState("");
  const [escArmed, setEscArmed] = useState(false);
  const escTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const findPipperElement = useCallback(
    (x: number, y: number): { el: HTMLElement; pipperId: string } | null => {
      // elementsFromPoint returns the whole stack under the cursor, so the
      // overlay never has to toggle its own pointer-events per sample (two
      // style writes + a forced style recalc on every mousemove).
      const overlayEl = overlayRef.current;
      const top = document.elementsFromPoint(x, y).find((node) => node !== overlayEl);
      if (!top) return null;
      const start = top instanceof HTMLElement ? top : top.parentElement;
      // closest() picks the innermost annotated ancestor — the most specific
      // target — without measuring a rect for every candidate on the chain.
      const pipper = start?.closest<HTMLElement>("[data-pipper-id]") ?? null;
      const pipperId = pipper?.getAttribute("data-pipper-id");
      if (!pipper || !pipperId) return null;
      return { el: pipper, pipperId };
    },
    [],
  );

  // Clear everything when edit mode exits or the overlay is hidden.
  useEffect(() => {
    if (!editMode || !overlayVisible) {
      setHighlight(null);
      setPopup(null);
      setCommentText("");
      setEscArmed(false);
      if (escTimerRef.current) clearTimeout(escTimerRef.current);
    }
  }, [editMode, overlayVisible]);

  // Focus popup textarea when it opens
  useEffect(() => {
    if (popup) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [popup]);

  // Global Escape handler — double-Esc exits edit mode AND closes the companion
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!editMode || !overlayVisible) return;
      if (e.key !== "Escape") return;

      // If popup is open, first Esc just closes it (doesn't arm exit)
      if (popup) {
        setPopup(null);
        setCommentText("");
        return;
      }

      if (escArmed) {
        // Second Esc — exit BOTH the overlay and the companion panel
        if (escTimerRef.current) clearTimeout(escTimerRef.current);
        setEscArmed(false);
        setHighlight(null);
        void exitEditMode();
        void window.omni?.pipper?.setProcessing?.(null);
        window.omni?.companion?.close?.();
      } else {
        setEscArmed(true);
        escTimerRef.current = setTimeout(() => setEscArmed(false), 1500);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (escTimerRef.current) clearTimeout(escTimerRef.current);
    };
  }, [editMode, overlayVisible, popup, escArmed, exitEditMode]);

  // Mirrors of popup/beam state for the hover rAF callback, so a frame
  // scheduled just before a click can't clobber the locked highlight.
  const hoverBlockedRef = useRef(false);
  hoverBlockedRef.current = Boolean(popup) || isBeaming;
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const hoverFrameRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (hoverFrameRef.current !== null) cancelAnimationFrame(hoverFrameRef.current);
    };
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (popup || isBeaming) return;
      // rAF-throttle hover tracking: coalesce the mousemove burst (can be
      // 120+/s) into at most one hit-test + rect read per frame.
      pointerRef.current = { x: e.clientX, y: e.clientY };
      if (hoverFrameRef.current !== null) return;
      hoverFrameRef.current = requestAnimationFrame(() => {
        hoverFrameRef.current = null;
        const point = pointerRef.current;
        if (!point || hoverBlockedRef.current) return;
        const found = findPipperElement(point.x, point.y);
        if (!found) {
          setHighlight((current) => (current ? null : current));
          return;
        }
        const rect = found.el.getBoundingClientRect();
        setHighlight((current) => {
          // Same target, same geometry — keep the identity, skip the render.
          if (current && current.pipperId === found.pipperId && !rectChanged(rect, current)) {
            return current;
          }
          return {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            pipperId: found.pipperId,
            label: found.pipperId,
          };
        });
      });
    },
    [popup, isBeaming, findPipperElement],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (popup || isBeaming) return;
      const found = findPipperElement(e.clientX, e.clientY);
      if (!found) return;
      const rect = found.el.getBoundingClientRect();
      const popupPosition = getPopupPosition(rect);
      // Explicitly lock the highlight to the clicked element
      // so it stays visible while the popup is open
      setHighlight({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        pipperId: found.pipperId,
        label: found.pipperId,
      });
      setPopup({
        top: popupPosition.top,
        left: popupPosition.left,
        pipperId: found.pipperId,
        label: found.pipperId,
        elementRect: rect,
      });
      void window.omni?.analytics?.componentMutationRequested?.({
        componentId: found.pipperId,
        source: "overlay",
      });
      setCommentText("");
    },
    [popup, isBeaming, findPipperElement],
  );

  const handleMouseLeave = useCallback(() => {
    if (!popup && !isBeaming) setHighlight(null);
  }, [popup, isBeaming]);

  useEffect(() => {
    if (!processingId || highlight) return;
    const element = getPipperElementById(processingId);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setHighlight({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      pipperId: processingId,
      label: processingId,
    });
  }, [highlight, processingId]);

  useEffect(() => {
    const lockedPipperId = popup?.pipperId ?? processingId;
    if (!editMode || !overlayVisible || !lockedPipperId || (!popup && !isBeaming)) return;

    let frame = 0;
    // Cache the tracked element across frames — re-resolving it is a DOM
    // query, and it only ever changes when the page reloads or the element
    // unmounts (both leave it disconnected).
    let element: HTMLElement | null = null;
    const updateLockedGeometry = () => {
      if (
        !element ||
        !element.isConnected ||
        element.getAttribute("data-pipper-id") !== lockedPipperId
      ) {
        element = getPipperElementById(lockedPipperId);
      }
      if (!element) {
        setHighlight((current) => (current?.pipperId === lockedPipperId ? null : current));
        frame = requestAnimationFrame(updateLockedGeometry);
        return;
      }

      const rect = element.getBoundingClientRect();
      setHighlight((current) => {
        if (!current || current.pipperId !== lockedPipperId || !rectChanged(rect, current)) {
          return current;
        }
        return {
          ...current,
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        };
      });
      setPopup((current) => {
        if (!current || current.pipperId !== lockedPipperId) return current;
        const nextPosition = getPopupPosition(rect);
        const hasMoved =
          Math.abs(current.top - nextPosition.top) > 0.5 ||
          Math.abs(current.left - nextPosition.left) > 0.5 ||
          Math.abs(current.elementRect.top - rect.top) > 0.5 ||
          Math.abs(current.elementRect.left - rect.left) > 0.5 ||
          Math.abs(current.elementRect.width - rect.width) > 0.5 ||
          Math.abs(current.elementRect.height - rect.height) > 0.5;
        if (!hasMoved) return current;
        return {
          ...current,
          ...nextPosition,
          elementRect: rect,
        };
      });

      frame = requestAnimationFrame(updateLockedGeometry);
    };

    frame = requestAnimationFrame(updateLockedGeometry);
    return () => cancelAnimationFrame(frame);
  }, [editMode, isBeaming, overlayVisible, popup, processingId]);

  if (!editMode || !overlayVisible) return null;

  return (
    <>
      {/* Full-screen capture layer */}
      <div
        ref={overlayRef}
        className="fixed inset-0 z-[9990]"
        style={{ cursor: isBeaming ? "wait" : "crosshair" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      />

      {/* Esc-armed hint — the first Esc arms exit; show what the second does */}
      {escArmed && !popup && (
        <div
          data-pipper-id="edit-mode-escape-hint"
          className="fixed left-1/2 top-4 z-[9993] pointer-events-none"
          style={{ animation: "fade-in 160ms ease-out both" }}
        >
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5",
              "text-[11px] font-semibold text-foreground whitespace-nowrap",
              surfaceClasses(5, 4),
            )}
          >
            Press <kbd className="rounded border border-border/70 px-1 text-[10px]">Esc</kbd> again
            to exit Edit Mode
          </div>
        </div>
      )}

      {/* Hover highlight — shown when hovering (no popup, no beam) */}
      {highlight && !popup && !isBeaming && (
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
            style={{
              animation: "pipper-highlight-pulse 1.4s ease-in-out infinite",
            }}
          />
          {/* Label chip — sits on the surface level above the page */}
          {/*<div
            className={cn(
              "absolute buttom-1 left-0 flex items-center gap-1 rounded-md px-2 py-1",
              "text-[11px] font-semibold text-foreground whitespace-nowrap",
              surfaceClasses(5, 4),
            )}
          >
            @ {highlight.label}
          </div>*/}
        </div>
      )}

      {/* Selected highlight — shown while popup is open (user is typing) */}
      {highlight && popup && !isBeaming && (
        <div
          className="fixed z-[9991] pointer-events-none"
          style={{
            top: highlight.top - 2,
            left: highlight.left - 2,
            width: highlight.width + 4,
            height: highlight.height + 4,
          }}
        >
          {/* Same BorderBeam settings as the InputMessage popup */}
          <BorderBeam size="pulse-inner" colorVariant="mono" className="w-full h-full">
            <div className="absolute inset-0 rounded-sm" />
          </BorderBeam>
        </div>
      )}

      {/* Locked highlight while beam is active */}
      {highlight && isBeaming && (
        <div
          className="fixed z-[9991] pointer-events-none"
          style={{
            top: highlight.top - 2,
            left: highlight.left - 2,
            width: highlight.width + 4,
            height: highlight.height + 4,
          }}
        >
          {/* Same BorderBeam settings as the selected highlight */}
          <BorderBeam size="line" colorVariant="mono" className="w-full h-full">
            <div className="absolute inset-0 rounded-sm" />
          </BorderBeam>


        </div>
      )}

      {/* Comment popup — an Elevated floating surface above the page */}
      {popup && (
        <div
          className={"fixed z-[9992] flex flex-col gap-2"}
          style={{
            top: popup.top,
            left: popup.left,
            width: 308,
            animation: "pipper-popup-in 140ms ease-out both",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <BorderBeam size="pulse-inner" colorVariant="mono">

              <InputMessage
                value={commentText}
                onValueChange={setCommentText}
                onSend={(text) => {
                  if (!popup || !text.trim()) return;
                  const { pipperId, label } = popup;
                  (async () => {
                    try {
                      await window.omni?.pipper?.addComment(pipperId, text.trim());
                    } catch (err) {
                      console.error("[PipperOverlay] addComment failed:", err);
                      await window.omni?.pipper?.setProcessing?.(null).catch(() => undefined);
                      toast({
                        icon: <WarningIcon className="size-5 text-red-500" />,
                        title: "Could not send edit",
                        description:
                          err instanceof Error ? err.message : "The companion did not receive it.",
                      });
                      return;
                    }
                    try {
                      await window.omni?.pipper?.setProcessing?.(pipperId);
                    } catch (err) {
                      console.error("[PipperOverlay] setProcessing failed:", err);
                      toast({
                        icon: <WarningIcon className="size-5 text-yellow-500" />,
                        title: "Edit sent without highlight",
                        description:
                          err instanceof Error
                            ? err.message
                            : "The companion received the request.",
                      });
                    }
                    setPopup(null);
                    setCommentText("");
                    setHighlight({
                      top: popup.elementRect.top,
                      left: popup.elementRect.left,
                      width: popup.elementRect.width,
                      height: popup.elementRect.height,
                      pipperId,
                      label,
                    });
                  })();
                }}
                placeholder="Describe the change…"
                textareaRef={inputRef}
                leftSlot={() => (
                  <>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-md px-1.5 py-0.5",
                        "text-[10px] font-bold text-foreground tracking-wide",
                        surfaceClasses(7, 4),
                      )}
                    >
                      @ {popup.label}
                    </span>
                  </>
                )}
                minRows={1}
                maxRows={4}
              />

          </BorderBeam>
        </div>
      )}
    </>
  );
}
