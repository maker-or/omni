/**
 * Tracks whether the main window can actually be seen by the user, merging two
 * sources of truth:
 *
 * 1. Window-level events (minimize/hide/show/restore) — always available.
 * 2. Renderer-reported `document.visibilityState`, which additionally covers
 *    full occlusion (Chromium marks a fully covered window hidden even though
 *    BrowserWindow still reports visible).
 *
 * The merged result is "visible" only when BOTH sources agree the window is
 * visible; before any renderer report arrives, the window level alone decides
 * (fail-open: behave like today rather than suppressing traffic).
 */
/** Consumer-facing view of visibility (keeps consumers testable without Electron). */
export interface WindowVisibilitySource {
  isVisible(): boolean;
  onChange(listener: (visible: boolean) => void): () => void;
}

/** Whether the window currently holds the user's attention (keyboard focus). */
export interface WindowAttentionSource {
  isFocused(): boolean;
}

export class WindowVisibilityGate implements WindowVisibilitySource {
  private windowVisible = true;
  /** Null until the first renderer report lands. */
  private rendererVisible: boolean | null = null;
  private readonly listeners = new Set<(visible: boolean) => void>();

  isVisible(): boolean {
    if (this.rendererVisible !== null) return this.windowVisible && this.rendererVisible;
    return this.windowVisible;
  }

  setWindowVisible(visible: boolean): void {
    if (this.windowVisible === visible) return;
    const wasVisible = this.isVisible();
    this.windowVisible = visible;
    this.emitIfChanged(wasVisible);
  }

  /** Called from the renderer via IPC on document visibilitychange. */
  setRendererVisible(visible: boolean): void {
    if (this.rendererVisible !== null && this.rendererVisible === visible) return;
    const wasVisible = this.isVisible();
    this.rendererVisible = visible;
    this.emitIfChanged(wasVisible);
  }

  onChange(listener: (visible: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitIfChanged(wasVisible: boolean): void {
    const isVisibleNow = this.isVisible();
    if (wasVisible === isVisibleNow) return;
    // Snapshot so a listener unsubscribing mid-loop can't corrupt iteration.
    const snapshot = [...this.listeners];
    for (const listener of snapshot) {
      try {
        listener(isVisibleNow);
      } catch (error) {
        console.error("[WindowVisibility] listener failed:", error);
      }
    }
  }
}
