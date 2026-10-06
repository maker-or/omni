/**
 * Laptops this phone is paired with. The phone app runs in two places:
 * - served by the laptop itself (Tailscale, localhost, quick tunnel): one
 *   laptop, same origin, `apiBase` is "";
 * - hosted at a trusted site (e.g. remote.pipper.dev): any number of laptops,
 *   each reached cross-origin at its locked-down `lt-*.<domain>` hostname.
 */

export interface PairedLaptop {
  /** "self" for the laptop serving this page, else its hostname. */
  id: string;
  /** "" (same origin) or https://<laptop host>. */
  apiBase: string;
  token: string;
  /** Name the laptop gave this phone (shown so the user knows which pairing it is). */
  deviceName: string | null;
  pairedAt: number;
  /** What the laptop calls itself (unverified). */
  name?: string | null;
  /** Owner verified via pipper.dev's signed statement; null if unverified. */
  owner?: { sub: string; email: string | null; name: string | null } | null;
}

/** Display label for a laptop: verified owner first, then its own name. */
export function laptopLabel(laptop: PairedLaptop): string {
  const who = laptop.owner?.email ?? laptop.owner?.name;
  const name = laptop.name ?? (laptop.id === SELF_ID ? "This laptop" : laptop.id.split(".")[0]!);
  return who ? `${name} · ${who}` : name;
}

/**
 * Verified owners of the laptops already paired other than `sub`. A new
 * laptop owned by someone else is the pairing-link hijack case, so the
 * confirmation screen warns about it.
 */
export function otherOwners(laptops: PairedLaptop[], sub: string | null): string[] {
  const others = laptops
    .map((l) => l.owner)
    .filter((o): o is NonNullable<PairedLaptop["owner"]> => !!o && o.sub !== sub)
    .map((o) => o.email ?? o.name ?? o.sub);
  return [...new Set(others)];
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const LAPTOPS_KEY = "omni:remote-laptops";
const ACTIVE_KEY = "omni:remote-active-laptop";
/** Single same-origin token from before multi-laptop support. */
const LEGACY_TOKEN_KEY = "omni:remote-token";
export const SELF_ID = "self";

/**
 * Hostnames a hosted app may pair with: the reserved `lt-` label under the
 * laptop domain. A pairing link can't point the app (and its tokens) at any
 * other host.
 */
export function isAllowedLaptopHost(host: string, domain: string): boolean {
  const suffix = `.${domain.toLowerCase()}`;
  const h = host.toLowerCase();
  if (!h.endsWith(suffix)) return false;
  return /^lt-[a-z0-9-]{1,48}$/.test(h.slice(0, -suffix.length));
}

/** `#pair=CODE` (laptop-served) or `#pair=CODE&host=HOST` (hosted app). */
export function parsePairingLink(text: string): { code: string; host: string | null } | null {
  const hash = text.includes("#") ? text.slice(text.indexOf("#") + 1) : text;
  const params = new URLSearchParams(hash);
  const code = params.get("pair");
  if (!code || !/^[0-9A-Za-z-]{4,32}$/.test(code)) return null;
  const host = params.get("host");
  return { code, host: host ? host.toLowerCase() : null };
}

function safeGet(store: KeyValueStore, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(store: KeyValueStore, key: string, value: string | null): void {
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    // Private mode etc.: pairing lasts for this page load only.
  }
}

export function loadLaptops(store: KeyValueStore): PairedLaptop[] {
  try {
    const parsed: unknown = JSON.parse(safeGet(store, LAPTOPS_KEY) ?? "[]");
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (l): l is PairedLaptop =>
          !!l &&
          typeof l.id === "string" &&
          typeof l.token === "string" &&
          typeof l.apiBase === "string",
      );
    }
  } catch {
    // corrupt: fall through
  }
  return [];
}

function saveLaptops(store: KeyValueStore, laptops: PairedLaptop[]): void {
  safeSet(store, LAPTOPS_KEY, JSON.stringify(laptops));
}

/** Fold a pre-multi-laptop token into the list once. */
export function migrateLegacyToken(store: KeyValueStore, now = Date.now()): void {
  const legacy = safeGet(store, LEGACY_TOKEN_KEY);
  if (!legacy) return;
  const laptops = loadLaptops(store);
  if (!laptops.some((l) => l.id === SELF_ID)) {
    laptops.push({ id: SELF_ID, apiBase: "", token: legacy, deviceName: null, pairedAt: now });
    saveLaptops(store, laptops);
    if (!safeGet(store, ACTIVE_KEY)) safeSet(store, ACTIVE_KEY, SELF_ID);
  }
  safeSet(store, LEGACY_TOKEN_KEY, null);
}

export function activeLaptop(store: KeyValueStore): PairedLaptop | null {
  const laptops = loadLaptops(store);
  const id = safeGet(store, ACTIVE_KEY);
  return laptops.find((l) => l.id === id) ?? laptops[0] ?? null;
}

export function setActiveLaptop(store: KeyValueStore, id: string): void {
  safeSet(store, ACTIVE_KEY, id);
}

/** Add or replace a laptop (re-pairing replaces its token) and make it active. */
export function rememberLaptop(store: KeyValueStore, laptop: PairedLaptop): void {
  saveLaptops(store, [...loadLaptops(store).filter((l) => l.id !== laptop.id), laptop]);
  setActiveLaptop(store, laptop.id);
}

export function forgetLaptop(store: KeyValueStore, id: string): void {
  const rest = loadLaptops(store).filter((l) => l.id !== id);
  saveLaptops(store, rest);
  if (safeGet(store, ACTIVE_KEY) === id) safeSet(store, ACTIVE_KEY, rest[0]?.id ?? null);
}
