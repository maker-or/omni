import { estimateJsonBytes } from "../src/lib/session-retention.ts";
import type { AcpBridgeEvent } from "../contracts/acp.ts";
import type { MonitorBridgeEvent } from "../contracts/monitor.ts";
import type { AgentOsNotification, OsNotifier } from "./os-notifications.ts";
import type { WindowAttentionSource, WindowVisibilitySource } from "./window-visibility.ts";

type SendToRenderer = (channel: string, payload: unknown) => void;

export interface RendererBroadcasterDeps {
  send: SendToRenderer;
  visibility?: WindowVisibilitySource;
  attention?: WindowAttentionSource;
  notify?: OsNotifier;
  getActiveThreadId: () => string | null;
  getBridgeEventObserver: () => ((event: MonitorBridgeEvent) => void) | undefined;
  /** Catch the renderer up once the window becomes visible again. */
  flushAfterHiddenPeriod: () => void;
}

/**
 * Streaming deltas an invisible renderer need not replay: the main process
 * keeps the authoritative slice either way, and one snapshot on visible
 * produces the same end state. Everything user-actionable (permissions),
 * cheap (stop, running-threads), or window-scoped (title) stays direct.
 */
const COALESCIBLE_WHEN_HIDDEN = new Set<AcpBridgeEvent["type"]>([
  "session-update",
  "thread-tool-calls",
]);

function bridgeEventThreadId(payload: AcpBridgeEvent): string | null {
  return "threadId" in payload && typeof payload.threadId === "string" ? payload.threadId : null;
}

/**
 * The single output port for agent bridge events: delivers them over IPC,
 * suppresses high-volume streaming while the window is hidden (one flush on
 * visible replaces the storm), reports delivery metrics to the monitor, and
 * escalates user-actionable events to the OS when nobody is watching.
 */
export class RendererBroadcaster {
  private readonly deps: RendererBroadcasterDeps;

  constructor(deps: RendererBroadcasterDeps) {
    this.deps = deps;
    // The hidden-window gate dropped streaming deltas; the moment the window
    // can be seen again, catch the renderer up with one authoritative pass.
    deps.visibility?.onChange((visible) => {
      if (visible) deps.flushAfterHiddenPeriod();
    });
  }

  isVisible(): boolean {
    return this.deps.visibility?.isVisible() ?? true;
  }

  emit(payload: AcpBridgeEvent): void {
    if (COALESCIBLE_WHEN_HIDDEN.has(payload.type) && !this.isVisible()) {
      this.recordCoalescedEvent(payload);
      return;
    }
    const observer = this.deps.getBridgeEventObserver();
    if (!observer) {
      this.deps.send("agent:event", payload);
      return;
    }
    const startedAt = performance.now();
    const bytes = estimateJsonBytes(payload);
    const serializationMs = performance.now() - startedAt;
    const threadId = bridgeEventThreadId(payload);
    const threadRole = threadId
      ? threadId === this.deps.getActiveThreadId()
        ? "active"
        : "background"
      : "unknown";
    const deliveryStartedAt = performance.now();
    try {
      this.deps.send("agent:event", payload);
    } finally {
      observer({
        timestamp: Date.now(),
        eventType: payload.type,
        bytes,
        serializationMs,
        deliveryMs: performance.now() - deliveryStartedAt,
        threadId,
        threadRole,
        deliveryMode: "direct",
      });
    }
  }

  /**
   * Bookkeeping for a suppressed event. Bytes stay unmeasured on purpose:
   * walking a multi-KB payload here would reintroduce per-event cost on the
   * exact hot path this gate exists to elide.
   */
  private recordCoalescedEvent(payload: AcpBridgeEvent): void {
    const observer = this.deps.getBridgeEventObserver();
    if (!observer) return;
    const threadId = bridgeEventThreadId(payload);
    observer({
      timestamp: Date.now(),
      eventType: payload.type,
      bytes: 0,
      serializationMs: 0,
      deliveryMs: 0,
      threadId,
      threadRole: threadId
        ? threadId === this.deps.getActiveThreadId()
          ? "active"
          : "background"
        : "unknown",
      deliveryMode: "coalesced",
    });
  }

  /**
   * Fire an OS notification only when the user is not attending to the app.
   * Attention is broader than visibility: Cmd+Tab to another app on macOS
   * leaves the window "visible" (no minimize, no full occlusion) while the
   * user is clearly elsewhere — that is exactly when a finished turn or a
   * blocked permission must escalate to the OS.
   */
  notifyIfHidden(notification: AgentOsNotification): void {
    const visible = this.isVisible();
    const focused = this.deps.attention?.isFocused() ?? true;
    if (visible && focused) return;
    try {
      this.deps.notify?.(notification);
    } catch (error) {
      console.error("[Notifications] failed:", error);
    }
  }
}
