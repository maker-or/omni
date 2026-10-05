import type { RemoteDevice, RemotePairResponse } from "../../contracts/remote.ts";

/** This device's token, issued by the laptop when a pairing code is redeemed. */
const TOKEN_KEY = "omni:remote-token";
/** Fired when the laptop stops accepting our token (revoked or expired). */
export const UNPAIRED_EVENT = "omni:unpaired";

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private mode etc.: pairing lasts for this page load only.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

async function failure(path: string, res: Response): Promise<Error> {
  const text = await res.text().catch(() => "");
  let message = text.slice(0, 200);
  try {
    message = (JSON.parse(text) as { error?: string }).error ?? message;
  } catch {
    // not JSON
  }
  return new Error(`${path} → ${res.status} ${message}`);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${readToken() ?? ""}`,
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event(UNPAIRED_EVENT));
  }
  if (!res.ok) throw await failure(path, res);
  return (await res.json()) as T;
}

/** A readable default name so the laptop's device list is recognizable. */
export function deviceNameFromUserAgent(ua = navigator.userAgent): string {
  const device = /iPad/.test(ua)
    ? "iPad"
    : /iPhone/.test(ua)
      ? "iPhone"
      : /Android/.test(ua)
        ? "Android phone"
        : /Macintosh/.test(ua)
          ? "Mac"
          : "Browser";
  const browser = /EdgiOS|Edg\//.test(ua)
    ? "Edge"
    : /CriOS|Chrome\//.test(ua)
      ? "Chrome"
      : /FxiOS|Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : null;
  return browser ? `${device} · ${browser}` : device;
}

/** Redeem a one-time code from the laptop and keep the issued token. */
export async function pairWithCode(code: string): Promise<RemoteDevice> {
  const path = "/api/remote/pair";
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, deviceName: deviceNameFromUserAgent() }),
  });
  if (!res.ok) {
    if (res.status === 401)
      throw new Error("That code is wrong or has expired. Make a new one on the laptop.");
    if (res.status === 429) throw new Error("Too many attempts. Wait a minute and try again.");
    throw await failure(path, res);
  }
  const body = (await res.json()) as RemotePairResponse;
  saveToken(body.token);
  return body.device;
}

/** Pairing code carried in a scanned QR link: /remote#pair=CODE. */
export function pairingCodeFromUrl(url: string): string | null {
  return /[#&]pair=([0-9A-Za-z-]+)/.exec(url)?.[1] ?? null;
}
