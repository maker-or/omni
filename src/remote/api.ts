import type {
  RemoteDevice,
  RemoteLaptopIdentity,
  RemotePairPreviewResponse,
  RemotePairResponse,
} from "../../contracts/remote.ts";
import { verifyLaptopOwner, type OwnerCheck } from "./attestation.ts";
import {
  SELF_ID,
  activeLaptop,
  forgetLaptop,
  isAllowedLaptopHost,
  loadLaptops,
  otherOwners,
  migrateLegacyToken,
  rememberLaptop,
  setActiveLaptop,
  type KeyValueStore,
  type PairedLaptop,
} from "./laptops.ts";

/** Fired when the laptop stops accepting our token (revoked or expired). */
export const UNPAIRED_EVENT = "omni:unpaired";

// Read as full `import.meta.env.X` expressions: the hosted build
// (vite.remote-web.config.ts) substitutes exactly these at build time.
/** True in the build served from the trusted site (remote.pipper.dev). */
export const IS_HOSTED_APP = (import.meta.env.VITE_REMOTE_HOSTED as string | undefined) === "true";
/** pipper.dev's public key for laptop owner statements (hosted build only). */
const ATTESTATION_PUBLIC_KEY = import.meta.env.VITE_REMOTE_ATTESTATION_PUBLIC_KEY as
  | string
  | undefined;
/** Domain whose `lt-*` hosts a hosted app may pair with. */
export const LAPTOP_DOMAIN =
  (import.meta.env.VITE_REMOTE_LAPTOP_DOMAIN as string | undefined) ?? "pipper.dev";

function storage(): KeyValueStore {
  try {
    return localStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => void memory.set(k, v),
      removeItem: (k) => void memory.delete(k),
    };
  }
}

let migrated = false;
export function currentLaptop(): PairedLaptop | null {
  const store = storage();
  if (!migrated) {
    migrateLegacyToken(store);
    migrated = true;
  }
  return activeLaptop(store);
}

export function listLaptops(): PairedLaptop[] {
  currentLaptop();
  return loadLaptops(storage());
}

export function switchLaptop(id: string): void {
  setActiveLaptop(storage(), id);
}

/** Drop this phone's pairing with the active laptop (locally). */
export function forgetCurrentLaptop(): void {
  const laptop = currentLaptop();
  if (laptop) forgetLaptop(storage(), laptop.id);
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

/** Call the active laptop's API (same origin, or cross-origin when hosted). */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const laptop = currentLaptop();
  const res = await fetch(`${laptop?.apiBase ?? ""}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${laptop?.token ?? ""}`,
      ...init?.headers,
    },
  });
  if (res.status === 401 && laptop) {
    forgetLaptop(storage(), laptop.id);
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

function apiBaseFor(host: string | null): string {
  if (host && !isAllowedLaptopHost(host, LAPTOP_DOMAIN)) {
    throw new Error("This pairing link doesn't point to a Pipper laptop.");
  }
  if (!host && IS_HOSTED_APP) {
    throw new Error("Scan the QR code shown on your laptop with your phone's camera.");
  }
  return host ? `https://${host}` : "";
}

export interface PairingPreview {
  laptop: RemoteLaptopIdentity;
  /** Owner check; laptop-served pages skip it (the page *is* that laptop). */
  owner: OwnerCheck | null;
  /** Verified owners of other paired laptops, when they differ from this one. */
  otherOwners: string[];
}

/**
 * Ask the laptop who it is, without using the code up, so the user can
 * confirm before this phone sends it anything (pairing-link hijack defense).
 */
export async function previewPairing(code: string, host: string | null): Promise<PairingPreview> {
  const apiBase = apiBaseFor(host);
  const path = "/api/remote/pair/preview";
  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    if (res.status === 401)
      throw new Error("That code is wrong or has expired. Make a new one on the laptop.");
    if (res.status === 429) throw new Error("Too many attempts. Wait a minute and try again.");
    throw await failure(path, res);
  }
  const { laptop } = (await res.json()) as RemotePairPreviewResponse;
  const owner = host
    ? await verifyLaptopOwner(laptop.attestation, host, ATTESTATION_PUBLIC_KEY)
    : null;
  const sub = owner?.verified ? owner.owner.sub : null;
  return { laptop, owner, otherOwners: host ? otherOwners(listLaptops(), sub) : [] };
}

/**
 * Redeem a one-time code. `host` comes from a hosted pairing link and must be
 * an allowed laptop host; without it, the laptop is the one serving this page.
 * Links and scans go through previewPairing() + user confirmation first.
 */
export async function pairWithCode(
  code: string,
  host: string | null = null,
): Promise<RemoteDevice> {
  const apiBase = apiBaseFor(host);
  const path = "/api/remote/pair";
  const res = await fetch(`${apiBase}${path}`, {
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
  const owner = host
    ? await verifyLaptopOwner(body.laptop?.attestation ?? null, host, ATTESTATION_PUBLIC_KEY)
    : null;
  rememberLaptop(storage(), {
    id: host ?? SELF_ID,
    apiBase,
    token: body.token,
    deviceName: body.device.name,
    pairedAt: Date.now(),
    name: body.laptop?.name ?? null,
    owner: owner?.verified ? owner.owner : null,
  });
  return body.device;
}

export { parsePairingLink } from "./laptops.ts";
