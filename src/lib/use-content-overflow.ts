import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Whether an element's rendered content is taller than its box — the truth
 * behind a "Show more" control. Measuring beats guessing from string length:
 * Markdown with lists, code blocks or images overflows a clamped box well
 * below any character threshold, and short prose never does.
 *
 * Re-measures when the element resizes (fonts loading, panel width changes)
 * and whenever `deps` change (new content, clamp toggled).
 */
export function useContentOverflow(
  ref: RefObject<HTMLElement | null>,
  deps: readonly unknown[],
): boolean {
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      setOverflowing(element.scrollHeight > element.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller-owned deps
  }, deps);

  return overflowing;
}
