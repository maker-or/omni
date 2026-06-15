"use client";

// Base UI flavour of the Fluid Functionalism scroll area. Same API and
// behaviour as the Radix flavour (registry/radix/scroll-area.tsx): shared
// scroll-fade cues, shape-system scrollbar, native overflow fallback on
// touch-primary devices. Scrollbar machinery adapted from Lina by SameerJS6
// (https://lina.sameer.sh); built on @base-ui/react/scroll-area, whose
// scrollbars stay mounted while scrollable and expose hover/scroll state as
// data attributes instead of Radix's show/hide presence animation.

import {
  createContext,
  use,
  useRef,
  type ComponentPropsWithoutRef,
  type ComponentRef,
} from "react";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { cn } from "@/lib/utils";
import { useShape } from "@/lib/shape-context";
import { useScrollEdges, ScrollEdgeCue, type ScrollEdgeCueSize } from "@/lib/scroll-fade";
import { useTouchPrimary } from "@/hooks/use-touch-primary";

// On touch-primary devices the Base UI machinery is skipped entirely in
// favour of native overflow scrolling (better physics, momentum,
// rubber-banding); the context lets the exported ScrollBar no-op there.
const ScrollAreaContext = createContext<boolean>(false);

type Orientation = "vertical" | "horizontal" | "both";

interface ScrollAreaProps extends ComponentPropsWithoutRef<"div"> {
  viewportClassName?: string;
  viewportRef?: React.RefObject<HTMLDivElement | null>;
  /** Surface-gradient + chevron cues at edges with more content. Auto-shows
   *  on overflow; set to `false` to disable. Defaults to `true`. */
  scrollFade?: boolean;
  /** Cue band size along the scroll axis: `"tight"` (32px) or
   *  `"comfortable"` (60px). Defaults to `"comfortable"`. */
  cueSize?: ScrollEdgeCueSize;
  /** Show the directional chevron in the cues. The gradient fade always
   *  renders; set to `false` for fade-only cues. Defaults to `true`. */
  chevron?: boolean;
  /** Which axes get scrollbars and edge cues. Defaults to `"vertical"`. */
  orientation?: Orientation;
  ref?: React.Ref<ComponentRef<typeof ScrollAreaPrimitive.Root>>;
}

const ScrollArea = ({
  className,
  children,
  viewportClassName,
  viewportRef,
  scrollFade = true,
  cueSize = "comfortable",
  chevron = true,
  orientation = "vertical",
  ref,
  ...props
}: ScrollAreaProps) => {
  const defaultViewportRef = useRef<HTMLDivElement>(null);
  const activeViewportRef = viewportRef ?? defaultViewportRef;
  const isTouch = useTouchPrimary();
  const edges = useScrollEdges(activeViewportRef, {
    enabled: scrollFade,
    axis: orientation,
  });

  // Cues read the substrate surface from context — ScrollArea doesn't
  // elevate, so the gradient matches whatever background it sits on.
  const cues = scrollFade && (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-[inherit]"
    >
      {orientation !== "horizontal" && (
        <>
          <ScrollEdgeCue
            mode="absolute"
            edge="top"
            visible={edges.top}
            size={cueSize}
            chevron={chevron}
          />
          <ScrollEdgeCue
            mode="absolute"
            edge="bottom"
            visible={edges.bottom}
            size={cueSize}
            chevron={chevron}
          />
        </>
      )}
      {orientation !== "vertical" && (
        <>
          <ScrollEdgeCue
            mode="absolute"
            edge="left"
            visible={edges.left}
            size={cueSize}
            chevron={chevron}
          />
          <ScrollEdgeCue
            mode="absolute"
            edge="right"
            visible={edges.right}
            size={cueSize}
            chevron={chevron}
          />
        </>
      )}
    </div>
  );

  return (
    <ScrollAreaContext.Provider value={isTouch}>
      {isTouch ? (
        <div
          ref={ref}
          role="group"
          data-slot="scroll-area"
          aria-roledescription="scroll area"
          className={cn("relative overflow-hidden", className)}
          {...props}
        >
          <div
            ref={activeViewportRef}
            data-slot="scroll-area-viewport"
            className={cn(
              "size-full rounded-[inherit]",
              orientation === "vertical" && "overflow-y-auto",
              orientation === "horizontal" && "overflow-x-auto",
              orientation === "both" && "overflow-auto",
              viewportClassName,
            )}
            tabIndex={0}
          >
            {children}
          </div>
          {cues}
        </div>
      ) : (
        <ScrollAreaPrimitive.Root
          ref={ref}
          data-slot="scroll-area"
          className={cn("relative overflow-hidden", className)}
          {...props}
        >
          <ScrollAreaPrimitive.Viewport
            ref={activeViewportRef}
            data-slot="scroll-area-viewport"
            className={cn("size-full rounded-[inherit]", viewportClassName)}
          >
            {/* Content gives Base UI an intrinsic size to measure
                  horizontal overflow against. */}
            <ScrollAreaPrimitive.Content>{children}</ScrollAreaPrimitive.Content>
          </ScrollAreaPrimitive.Viewport>
          {cues}
          {orientation !== "horizontal" && <ScrollBar orientation="vertical" />}
          {orientation !== "vertical" && <ScrollBar orientation="horizontal" />}
          {orientation === "both" && <ScrollAreaPrimitive.Corner />}
        </ScrollAreaPrimitive.Root>
      )}
    </ScrollAreaContext.Provider>
  );
};

ScrollArea.displayName = "ScrollArea";

const ScrollBar = ({
  className,
  orientation = "vertical",
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Scrollbar> & {
  ref?: React.Ref<ComponentRef<typeof ScrollAreaPrimitive.Scrollbar>>;
}) => {
  const isTouch = use(ScrollAreaContext);
  const shape = useShape();

  if (isTouch) return null;

  return (
    <ScrollAreaPrimitive.Scrollbar
      ref={ref}
      orientation={orientation}
      data-slot="scroll-area-scrollbar"
      // Base UI keeps the scrollbar mounted while scrollable; visibility is
      // a plain opacity transition off its hover/scroll state attributes,
      // matching the cue fade — 160ms in, 120ms out (exits faster, per the
      // animation guidelines); spring tokens are framer-motion configs and
      // don't apply here.
      className={cn(
        // The 10px track stays as a comfortable hit target; the thumb inside
        // it rests narrow and low-contrast, then widens + darkens on hover so
        // it gets out of the way until you reach for it.
        "group/scrollbar absolute z-20 flex touch-none select-none",
        // Show immediately; on hide, wait out the 150ms thumb shrink before
        // fading so the thumb visibly narrows back first instead of the fade
        // masking it.
        "opacity-0 transition-opacity duration-120 ease-out delay-160",
        "data-[hovering]:duration-160 data-[scrolling]:duration-160",
        "data-[hovering]:opacity-100 data-[scrolling]:opacity-100",
        "data-[hovering]:delay-0 data-[scrolling]:delay-0",
        orientation === "vertical" && "top-0 right-0 h-full w-2.5",
        orientation === "horizontal" && "bottom-0 left-0 h-2.5 w-full flex-col",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className={cn(
          "relative bg-foreground/25 transition-[background-color,width,height] duration-160 ease-in-out",
          "group-hover/scrollbar:bg-foreground/45 active:!bg-foreground/60",
          shape.bg,
          orientation === "vertical" &&
            "mx-auto my-1 w-1 h-[var(--scroll-area-thumb-height)] group-hover/scrollbar:w-1.5",
          orientation === "horizontal" &&
            "my-auto mx-1 h-1 w-[var(--scroll-area-thumb-width)] group-hover/scrollbar:h-1.5",
        )}
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
};

ScrollBar.displayName = "ScrollBar";

export { ScrollArea, ScrollBar };
export type { ScrollAreaProps };
