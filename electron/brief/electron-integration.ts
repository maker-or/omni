import {
  app,
  ipcMain,
  Notification,
  powerMonitor,
  protocol,
  session,
  shell,
  type BrowserWindow,
  type WebContents,
} from "electron";
import { existsSync } from "node:fs";
import os from "node:os";
import { delimiter, join } from "node:path";
import {
  BRIEF_SCHEME,
  type BriefOpenRequest,
  type BriefSettingsPatch,
  type BriefStatus,
} from "../../contracts/brief.ts";
import { BriefService, type BriefKeys } from "./service.ts";
import { BriefStore } from "./store.ts";

/**
 * Electron wiring for the Morning Brief: the `pipper-brief://` scheme inside
 * the embedded browser's session, hardening for every `<webview>`, IPC for
 * the renderer, and the launch / schedule / wake triggers.
 */

/** Session partition shared by all embedded-browser tabs. */
export const BROWSER_PARTITION = "persist:pipper-browser";

/** Must run before `app.whenReady()`. */
export function registerBriefScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: BRIEF_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

function firstNonEmpty(...values: Array<string | undefined>): string | null {
  return values.find((v) => typeof v === "string" && v.trim().length > 0)?.trim() ?? null;
}

export function resolveEnvBriefKeys(): BriefKeys {
  return {
    composio: firstNonEmpty(
      process.env.PIPPER_COMPOSIO_API_KEY,
      process.env.COMPOSIO_API_KEY,
      import.meta.env.VITE_PIPPER_COMPOSIO_API_KEY,
    ),
    typesafe: firstNonEmpty(
      process.env.PIPPER_TYPESAFE_API_KEY,
      process.env.TYPESAFE_API_KEY,
      import.meta.env.VITE_PIPPER_TYPESAFE_API_KEY,
    ),
    anthropic: firstNonEmpty(process.env.PIPPER_ANTHROPIC_API_KEY, process.env.ANTHROPIC_API_KEY),
  };
}

function resolveClaudeBinary(): string | null {
  if (process.env.PIPPER_BRIEF_DISABLE_CLAUDE_CLI === "1") return null;
  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  const candidates = [
    ...(process.env.PATH ?? "")
      .split(delimiter)
      .filter(Boolean)
      .map((dir) => join(dir, exe)),
    join(os.homedir(), ".local", "bin", exe),
    join(os.homedir(), ".claude", "local", exe),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Lock down every `<webview>` and route its popups to the system browser. */
function hardenWebviews(): void {
  app.on("web-contents-created", (_event, contents: WebContents) => {
    contents.on("will-attach-webview", (attachEvent, webPreferences, params) => {
      if (params.partition !== BROWSER_PARTITION) {
        attachEvent.preventDefault();
        return;
      }
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webSecurity = true;
      const src = params.src ?? "";
      if (src && !src.startsWith(`${BRIEF_SCHEME}:`) && !isHttpUrl(src) && src !== "about:blank") {
        attachEvent.preventDefault();
      }
    });
    if (contents.getType() !== "webview") return;
    contents.setWindowOpenHandler(({ url }) => {
      if (isHttpUrl(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (navEvent, url) => {
      if (!isHttpUrl(url) && !url.startsWith(`${BRIEF_SCHEME}:`) && url !== "about:blank") {
        navEvent.preventDefault();
      }
    });
  });
}

export interface BriefIntegrationOptions {
  getMainWindow: () => BrowserWindow | null;
  getTheme: () => "light" | "dark" | "system";
  getUser: () => { id: string | null; name: string | null } | null;
}

export interface BriefIntegration {
  service: BriefService;
  /** Call once the main window has painted (first launch of the session). */
  onMainWindowReady: () => void;
  dispose: () => void;
}

export function installBrief(options: BriefIntegrationOptions): BriefIntegration {
  hardenWebviews();

  const store = new BriefStore(join(app.getPath("userData"), "brief"));
  let pendingOpen: BriefOpenRequest | null = null;

  const sendToMain = (channel: string, payload: unknown): boolean => {
    const win = options.getMainWindow();
    if (!win || win.isDestroyed() || win.webContents.isLoading()) return false;
    win.webContents.send(channel, payload);
    return true;
  };

  const focusMain = () => {
    const win = options.getMainWindow();
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };

  const service = new BriefService({
    store,
    envKeys: resolveEnvBriefKeys(),
    getTheme: options.getTheme,
    getUser: options.getUser,
    resolveClaudeBinary,
    openExternal: (url) => {
      if (isHttpUrl(url)) void shell.openExternal(url);
    },
    openInApp: (url, activate) => {
      const request: BriefOpenRequest = { url, focus: activate };
      // Keep it for a renderer that mounts after this fires (cold start).
      pendingOpen = request;
      return sendToMain("brief:open", request) || options.getMainWindow() != null;
    },
    startAgentDraft: (prompt) => {
      focusMain();
      return sendToMain("brief:agentPrompt", { prompt });
    },
    notify: (title, body, onClick) => {
      if (!Notification.isSupported()) return;
      const notification = new Notification({ title, body });
      notification.on("click", () => {
        focusMain();
        onClick();
      });
      notification.show();
    },
    broadcastStatus: (status: BriefStatus) => {
      sendToMain("brief:status", status);
    },
  });

  session
    .fromPartition(BROWSER_PARTITION)
    .protocol.handle(BRIEF_SCHEME, (request) => service.handleRequest(request));

  ipcMain.handle("brief:getStatus", () => service.getStatus());
  ipcMain.handle("brief:takePendingOpen", () => {
    const request = pendingOpen;
    pendingOpen = null;
    return request;
  });
  ipcMain.handle("brief:ackOpen", () => {
    pendingOpen = null;
  });
  ipcMain.handle("brief:getSettings", () => service.getSettingsView());
  ipcMain.handle("brief:updateSettings", (_event, patch: BriefSettingsPatch) =>
    service.updateSettings(patch ?? {}),
  );
  ipcMain.handle("brief:getConnections", () => service.getConnections(true));
  ipcMain.handle("brief:connect", (_event, source: string) => service.connect(source));

  const onResume = () => void service.onResume();
  powerMonitor.on("resume", onResume);
  powerMonitor.on("unlock-screen", onResume);

  let launched = false;
  return {
    service,
    onMainWindowReady: () => {
      if (launched) return;
      launched = true;
      void service.onLaunch().catch((error) => {
        console.error("[Brief] Launch trigger failed:", error);
      });
    },
    dispose: () => {
      powerMonitor.removeListener("resume", onResume);
      powerMonitor.removeListener("unlock-screen", onResume);
      service.dispose();
    },
  };
}
