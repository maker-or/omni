"use client";

import {
  useRef,
  useState,
  useEffect,
  useMemo,
  useCallback,
  type ComponentPropsWithoutRef,
} from "react";
import { Elevated } from "@/lib/elevated";
import { cn } from "@/lib/utils";
import { LazyMotion, m, domAnimation } from "framer-motion";

export interface AmbientPixelFieldProps extends ComponentPropsWithoutRef<"div"> {
  /** Size of each square pixel in px. Default is 6. */
  pixelSize?: number;
  /** Gap between pixels in px. Default is 4. */
  gap?: number;
  /** Intensity scaling factor for pixel opacities. Default is 0.6. */
  intensity?: number;
  /** Height ratio from bottom (0 to 1) where pixels completely fade out. Default is 0.5 (50%). */
  fadeStart?: number;
  /** Whether the background blurred light fields animate. Default is true. */
  animated?: boolean;
  /** Design system surface elevation offset. If provided, wraps container in Elevated. */
  offset?: number;
  /** Override for shadow level when using Elevated. */
  shadowLevel?: number;
  ref?: React.Ref<HTMLDivElement>;
}

const getRandomSeed = () => Math.random() * 1000;

const AmbientPixelField = ({
  pixelSize = 6,
  gap = 4,
  intensity = 0.2,
  fadeStart = 0.5,
  animated = true,
  offset,
  shadowLevel,
  className,
  style,
  ref,
  ...props
}: AmbientPixelFieldProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const observerRef = useRef<ResizeObserver | null>(null);

  // Generate a single random seed once when the grid component is created
  const [seed] = useState(getRandomSeed);

  // Deterministic pseudo-random float generator based on coordinate hashing.
  // This ensures that when the window resizes, the opacity of a pixel at
  // coordinate (r, c) remains perfectly stable and doesn't flicker.
  const getPixelOpacity = useCallback(
    (r: number, c: number) => {
      const x = r + seed;
      const y = c + seed;
      const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453123;
      return h - Math.floor(h);
    },
    [seed],
  );

  const { width, height } = dimensions;
  const stride = pixelSize + gap;
  const cols = Math.max(0, Math.floor((width + gap) / stride));
  const rows = Math.max(0, Math.floor((height + gap) / stride));

  // Memoize the pixels so we don't recreate DOM nodes on every render,
  // only when the grid dimensions, pixel settings, or intensity change.
  const pixels = useMemo(() => {
    const arr = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const opacity = getPixelOpacity(r, c) * intensity;
        arr.push(
          <div
            key={`${r}-${c}`}
            style={{
              width: pixelSize,
              height: pixelSize,
              borderRadius: "1px",
              opacity,
            }}
            className="bg-foreground/10 shrink-0 transition-opacity duration-300"
          />,
        );
      }
    }
    return arr;
  }, [rows, cols, pixelSize, gap, intensity, getPixelOpacity]);

  // Mask gradient that starts fully opaque at the bottom (0% from bottom / 100% of gradient mask)
  // and completely fades away to transparent at fadeStart percentage height.
  const maskGradient = useMemo(() => {
    const pct = Math.max(0, Math.min(100, fadeStart * 100));
    return `linear-gradient(to top, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0) ${pct}%, rgba(0, 0, 0, 0) 100%)`;
  }, [fadeStart]);

  // Render helper
  const renderContent = () => (
    <LazyMotion features={domAnimation}>
      {/* Animated blurred ambient glow fields in the background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <m.div
          style={{
            position: "absolute",
            width: "60%",
            height: "60%",
            left: "10%",
            bottom: "-20%",
            borderRadius: "9999px",
            filter: "blur(100px)",
            background:
              "radial-gradient(circle, var(--color-primary, currentColor) 0%, transparent 70%)",
          }}
          animate={
            animated
              ? {
                  opacity: [0.015, 0.04, 0.015],
                  scale: [1, 1.05, 1],
                  y: [0, -6, 0],
                }
              : undefined
          }
          transition={{
            duration: 30,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
        <m.div
          style={{
            position: "absolute",
            width: "50%",
            height: "50%",
            right: "15%",
            bottom: "-10%",
            borderRadius: "9999px",
            filter: "blur(120px)",
            background:
              "radial-gradient(circle, var(--color-primary, currentColor) 0%, transparent 70%)",
          }}
          animate={
            animated
              ? {
                  opacity: [0.01, 0.03, 0.01],
                  scale: [1.04, 0.96, 1.04],
                  y: [0, 8, 0],
                }
              : undefined
          }
          transition={{
            duration: 45,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </div>

      {/* Pixel grid */}
      {width > 0 && height > 0 && (
        <div
          className="absolute inset-0 pointer-events-none z-10 grid"
          style={{
            gridTemplateColumns: `repeat(${cols}, ${pixelSize}px)`,
            gridTemplateRows: `repeat(${rows}, ${pixelSize}px)`,
            gap: `${gap}px`,
            justifyContent: "center",
            alignContent: "end",
            WebkitMaskImage: maskGradient,
            maskImage: maskGradient,
          }}
        >
          {pixels}
        </div>
      )}
    </LazyMotion>
  );

  // Merge container refs and manage ResizeObserver
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }

      containerRef.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }

      if (node) {
        const observer = new ResizeObserver((entries) => {
          if (!entries || entries.length === 0) return;
          const { width, height } = entries[0].contentRect;
          setDimensions({ width, height });
        });
        observer.observe(node);
        observerRef.current = observer;
      }
    },
    [ref],
  );

  const mergedClass = cn(
    "relative w-full h-full bg-transparent overflow-hidden pointer-events-none select-none",
    className,
  );

  if (offset !== undefined) {
    return (
      <Elevated
        ref={setRef}
        offset={offset}
        shadowLevel={shadowLevel}
        className={mergedClass}
        style={style}
        {...props}
      >
        {renderContent()}
      </Elevated>
    );
  }

  return (
    <div ref={setRef} className={mergedClass} style={style} {...props}>
      {renderContent()}
    </div>
  );
};

AmbientPixelField.displayName = "AmbientPixelField";

export { AmbientPixelField };
