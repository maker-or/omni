import { Notification } from "electron";

export type AgentNotificationKind = "turn-completed" | "turn-failed" | "permission-required";

/**
 * Plain-data notification request. AgentConnectionManager emits these; the
 * Electron adapter turns them into OS notifications so the manager itself
 * stays free of electron imports and remains unit-testable.
 */
export interface AgentOsNotification {
  kind: AgentNotificationKind;
  /** Human thread label, or null when no title is known yet. */
  threadTitle: string | null;
  detail?: string;
}

export type OsNotifier = (notification: AgentOsNotification) => void;

const TITLES: Record<AgentNotificationKind, string> = {
  "turn-completed": "Agent finished",
  "turn-failed": "Agent run failed",
  "permission-required": "Permission needed",
};

/**
 * OS notifications for events the user cannot see because the window is
 * hidden: a turn settling, or an agent blocked on a permission prompt while
 * its human is away.
 */
export function createElectronOsNotifier(onActivate: () => void): OsNotifier {
  return (input) => {
    if (!Notification.isSupported()) {
      console.warn("[Notifications] OS notifications unsupported; dropping:", input.kind);
      return;
    }
    const body = [input.threadTitle ?? "Untitled thread", input.detail]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
    const notification = new Notification({
      title: TITLES[input.kind],
      body,
    });
    notification.on("click", () => {
      try {
        onActivate();
      } catch (error) {
        console.error("[Notifications] activate handler failed:", error);
      }
    });
    // Windows/Linux surface delivery failures here; macOS denial is silent
    // at the API level, so also confirm attempts in the dev-terminal log.
    notification.on("failed", (_event, error) => {
      console.error("[Notifications] OS rejected notification:", error);
    });
    console.log(`[Notifications] showing ${input.kind}: ${TITLES[input.kind]} — ${body}`);
    notification.show();
  };
}
