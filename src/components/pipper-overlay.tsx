import { useEffect, useRef, useState, useCallback } from "react";
import { usePipperStore } from "@/store/pipper-store";
import { InputMessage } from "@/components/ui/input-message";
import { surfaceClasses } from "@/lib/surface-classes";
import { cn } from "@/lib/utils";
import { BorderBeam } from "border-beam";

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
      if (overlayRef.current) overlayRef.current.style.pointerEvents = "none";
      const el = document.elementFromPoint(x, y);
      if (overlayRef.current) overlayRef.current.style.pointerEvents = "all";
      if (!el) return null;
      const pipper = el.closest("[data-pipper-id]") as HTMLElement | null;
      if (!pipper) return null;
      const pipperId = pipper.getAttribute("data-pipper-id");
      if (!pipperId) return null;
      return { el: pipper, pipperId };
    },
    [],
  );

  // Clear everything when edit mode exits
  useEffect(() => {
    if (!editMode) {
      setHighlight(null);
      setPopup(null);
      setCommentText("");
    }
  }, [editMode]);

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
  }, [popup, escArmed, exitEditMode]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (popup || isBeaming) return;
      const found = findPipperElement(e.clientX, e.clientY);
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
        label: found.pipperId,
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
      const popupTop = Math.min(rect.bottom + 10, window.innerHeight - 200);
      const popupLeft = Math.max(8, Math.min(rect.left, window.innerWidth - 320));
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
        top: popupTop,
        left: popupLeft,
        pipperId: found.pipperId,
        label: found.pipperId,
        elementRect: rect,
      });
      setCommentText("");
    },
    [popup, isBeaming, findPipperElement],
  );

  const handleMouseLeave = useCallback(() => {
    if (!popup && !isBeaming) setHighlight(null);
  }, [popup, isBeaming]);

  if (!editMode) return null;

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

          {/* "Editing…" label chip */}
          <div
            className={cn(
              "absolute -top-7 left-0 flex items-center gap-1.5 rounded-md px-2 py-1",
              "text-[11px] font-semibold text-foreground whitespace-nowrap",
              surfaceClasses(5, 4),
            )}
          >
            <span className="size-1.5 rounded-full bg-foreground animate-pulse" />
            Editing {highlight.label}…
          </div>
        </div>
      )}

      {/* Comment popup — surface-5 sits above the page (surface-1) */}
      {popup && (
        <div
          className={"fixed z-[9992] flex flex-col gap-2 rounded-xl p-3"}
          style={{ top: popup.top, left: popup.left, width: 308 }}
          onClick={(e) => e.stopPropagation()}
        >
          <BorderBeam size="pulse-outside" colorVariant="mono">
            <InputMessage
              value={commentText}
              onValueChange={setCommentText}
              onSend={(text) => {
                if (!popup || !text.trim()) return;
                const { pipperId, label } = popup;
                (async () => {
                  try {
                    await window.omni?.pipper?.setProcessing?.(pipperId);
                  } catch {
                    /* noop */
                  }
                  try {
                    await window.omni?.pipper?.addComment(pipperId, text.trim());
                  } catch (err) {
                    console.error("[PipperOverlay] addComment failed:", err);
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
