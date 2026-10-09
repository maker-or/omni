type Direction = "left" | "right";

const GESTURE_IDLE_MS = 400;
const SWIPE_THRESHOLD_PX = 80;

/** One navigation per horizontal wheel burst, including its momentum tail. */
export function createPageSwipeTracker() {
  let lastEventAt = -Infinity;
  let horizontal = 0;
  let vertical = 0;
  let consumed = false;

  return {
    reset() {
      lastEventAt = -Infinity;
      horizontal = 0;
      vertical = 0;
      consumed = false;
    },
    push(deltaX: number, deltaY: number, timestamp: number, blocked: boolean): Direction | null {
      if (timestamp - lastEventAt > GESTURE_IDLE_MS) {
        horizontal = 0;
        vertical = 0;
        consumed = false;
      }
      lastEventAt = timestamp;
      if (blocked) consumed = true;
      if (consumed) return null;
      horizontal += deltaX;
      vertical += Math.abs(deltaY);
      if (Math.abs(horizontal) < SWIPE_THRESHOLD_PX || Math.abs(horizontal) < vertical * 2) {
        return null;
      }
      consumed = true;
      return horizontal > 0 ? "left" : "right";
    },
  };
}

/** Preserve horizontal scrolling (including at its edges) inside nested content. */
export function hasHorizontalScrollTarget(target: EventTarget | null): boolean {
  let element = target instanceof Element ? target : null;
  while (element) {
    if (element.scrollWidth > element.clientWidth + 1) {
      const { overflowX } = getComputedStyle(element);
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    element = element.parentElement;
  }
  return false;
}

interface PageSwipeOptions {
  readFluidSwipeEnabled: () => Promise<boolean>;
  subscribeToNativeSwipe: (callback: (direction: Direction) => void) => (() => void) | undefined;
  isEnabled: () => boolean;
  navigate: (direction: Direction) => void;
}

/** Combine macOS's discrete page gestures with its configured fluid gesture. */
export function listenForPageSwipes(options: PageSwipeOptions): () => void {
  const tracker = createPageSwipeTracker();
  let fluidSwipeEnabled = false;
  let disposed = false;
  let preferenceRevision = 0;
  const refreshPreference = () => {
    const revision = ++preferenceRevision;
    fluidSwipeEnabled = false;
    tracker.reset();
    void options
      .readFluidSwipeEnabled()
      .then((enabled) => {
        if (!disposed && revision === preferenceRevision) fluidSwipeEnabled = enabled;
      })
      .catch(() => {});
  };
  const onWheel = (event: WheelEvent) => {
    if (!fluidSwipeEnabled || !options.isEnabled()) return;
    const blocked =
      event.defaultPrevented ||
      event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      hasHorizontalScrollTarget(event.target);
    const direction = tracker.push(event.deltaX, event.deltaY, event.timeStamp, blocked);
    if (!direction) return;
    event.preventDefault();
    options.navigate(direction);
  };
  refreshPreference();
  const unsubscribe = options.subscribeToNativeSwipe((direction) => {
    if (!options.isEnabled()) return;
    // A discrete gesture and its scroll tail must not navigate twice.
    tracker.push(0, 0, performance.now(), true);
    options.navigate(direction);
  });
  window.addEventListener("focus", refreshPreference);
  window.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    disposed = true;
    unsubscribe?.();
    window.removeEventListener("focus", refreshPreference);
    window.removeEventListener("wheel", onWheel);
  };
}
