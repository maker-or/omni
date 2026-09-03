import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

export type VerticalPopoverPlacement = "top" | "bottom";

export type AnchoredPopoverPosition = {
  placement: VerticalPopoverPlacement;
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

type PopoverWidth = number | "anchor";

type PopoverPositionOptions = {
  viewportWidth: number;
  viewportHeight: number;
  popoverWidth: PopoverWidth;
  minWidth?: number;
  gap?: number;
  margin?: number;
};

const DEFAULT_GAP = 6;
const DEFAULT_MARGIN = 8;

export function calculateAnchoredPopoverPosition(
  anchorRect: Pick<DOMRect, "top" | "right" | "bottom" | "left" | "width">,
  {
    viewportWidth,
    viewportHeight,
    popoverWidth,
    minWidth = 0,
    gap = DEFAULT_GAP,
    margin = DEFAULT_MARGIN,
  }: PopoverPositionOptions,
): AnchoredPopoverPosition {
  const spaceAbove = Math.max(0, anchorRect.top - gap - margin);
  const spaceBelow = Math.max(0, viewportHeight - anchorRect.bottom - gap - margin);
  const placement: VerticalPopoverPlacement = spaceBelow >= spaceAbove ? "bottom" : "top";
  const availableHeight = placement === "bottom" ? spaceBelow : spaceAbove;
  const requestedWidth = popoverWidth === "anchor" ? anchorRect.width : popoverWidth;
  const width = Math.max(
    0,
    Math.min(Math.max(requestedWidth, minWidth), viewportWidth - margin * 2),
  );
  const left = Math.max(margin, Math.min(anchorRect.left, viewportWidth - width - margin));

  return {
    placement,
    left,
    width,
    maxHeight: availableHeight,
    ...(placement === "bottom"
      ? { top: anchorRect.bottom + gap }
      : { bottom: viewportHeight - anchorRect.top + gap }),
  };
}

export function useAnchoredPopoverPosition(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  popoverWidth: PopoverWidth,
  minWidth = 0,
): AnchoredPopoverPosition | null {
  const [position, setPosition] = useState<AnchoredPopoverPosition | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const nextPosition = calculateAnchoredPopoverPosition(anchor.getBoundingClientRect(), {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      popoverWidth,
      minWidth,
    });
    setPosition((current) =>
      current &&
      current.placement === nextPosition.placement &&
      current.left === nextPosition.left &&
      current.width === nextPosition.width &&
      current.maxHeight === nextPosition.maxHeight &&
      current.top === nextPosition.top &&
      current.bottom === nextPosition.bottom
        ? current
        : nextPosition,
    );
  }, [anchorRef, popoverWidth, minWidth]);

  // Re-measure after every open render. Query changes and streamed content can
  // move the in-flow composer without producing a window resize or scroll event.
  useLayoutEffect(() => {
    if (open) updatePosition();
  });

  useEffect(() => {
    if (!open) return;

    const anchor = anchorRef.current;
    const resizeObserver =
      anchor && typeof ResizeObserver !== "undefined" ? new ResizeObserver(updatePosition) : null;
    if (anchor) resizeObserver?.observe(anchor);

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [anchorRef, open, updatePosition]);

  return position;
}
