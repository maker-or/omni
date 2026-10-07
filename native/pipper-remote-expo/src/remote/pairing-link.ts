/**
 * A pairing offer from the laptop's QR or link, before it is redeemed. The
 * laptop shows it in Settings → Remote as a one-time code plus a link:
 * - named tunnel (Cloudflare): `https://remote.pipper.dev/#pair=CODE&host=lt-….pipper.dev`
 * - laptop-served (quick tunnel or Tailscale): `<laptop origin>/remote#pair=CODE`
 *
 * Port of `PairingLink` in native/pipper-remote-ios. Parses by hand: React
 * Native's `URL` doesn't implement the getters this needs.
 */
export interface PairingLink {
  code: string;
  /** Origin of the laptop API, e.g. `https://lt-ab12.pipper.dev`. */
  baseURL: string;
  host: string;
  /**
   * Reached through Pipper's own network (a named Cloudflare tunnel), so
   * pipper.dev's signed owner statement can be checked for this host.
   */
  isNamedTunnel: boolean;
}

/** Domain whose reserved `lt-*` hosts are Pipper laptop tunnels. */
export const LAPTOP_DOMAIN = "pipper.dev";
/** Port the laptop listens on when reached directly (Tailscale). */
export const DEFAULT_LAPTOP_PORT = 4173;

interface ParsedURL {
  scheme: string;
  host: string;
  port: number | null;
  hasUserInfo: boolean;
  fragment: string | null;
}

const URL_PATTERN = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)[^?#]*(?:\?[^#]*)?(?:#(.*))?$/i;

function parseURL(text: string): ParsedURL | null {
  const m = URL_PATTERN.exec(text);
  if (!m) return null;
  let authority = m[2]!;
  const at = authority.lastIndexOf("@");
  const hasUserInfo = at >= 0;
  if (hasUserInfo) authority = authority.slice(at + 1);
  let host: string;
  let portText: string | undefined;
  const v6 = /^\[([^\]]+)\](?::(\d*))?$/.exec(authority);
  if (v6) {
    host = v6[1]!;
    portText = v6[2];
  } else {
    const parts = authority.split(":");
    if (parts.length > 2) return null;
    host = parts[0]!;
    portText = parts[1];
  }
  let port: number | null = null;
  if (portText !== undefined && portText !== "") {
    if (!/^\d{1,5}$/.test(portText)) return null;
    port = Number(portText);
    if (port > 65535) return null;
  }
  return {
    scheme: m[1]!.toLowerCase(),
    host: host.toLowerCase(),
    port,
    hasUserInfo,
    fragment: m[3] ?? null,
  };
}

function originOf(url: ParsedURL): string | null {
  if (!url.host) return null;
  const host = url.host.includes(":") ? `[${url.host}]` : url.host;
  return `${url.scheme}://${host}${url.port !== null ? `:${url.port}` : ""}`;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function fragmentParams(fragment: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of fragment.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    if (!out.has(key)) out.set(key, safeDecode(pair.slice(eq + 1)));
  }
  return out;
}

// MARK: Rules

export function isValidCode(code: string): boolean {
  return /^[0-9A-Za-z-]{4,32}$/.test(code);
}

/**
 * `lt-<label>.pipper.dev`: the only hosts the zone locks down as Pipper
 * laptop APIs, so a link can't point this app (and its token) elsewhere.
 */
export function isLaptopTunnelHost(host: string, domain = LAPTOP_DOMAIN): boolean {
  const h = host.toLowerCase();
  const suffix = `.${domain.toLowerCase()}`;
  if (!h.endsWith(suffix)) return false;
  return /^lt-[a-z0-9-]{1,48}$/.test(h.slice(0, -suffix.length));
}

/** Plain HTTP is only allowed where the laptop itself binds it. */
export function isTailscaleOrLoopback(host: string): boolean {
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  const labels = host.split(".");
  if (labels.length !== 4 || !labels.every((l) => /^\d{1,3}$/.test(l) && Number(l) <= 255)) {
    return false;
  }
  const [a, b] = labels.map(Number) as [number, number];
  return a === 100 && b >= 64 && b <= 127;
}

/**
 * HTTPS to a Pipper tunnel (named or quick), or plain HTTP only to
 * Tailscale (100.64/10) or loopback.
 */
function isAllowedBase(url: ParsedURL): boolean {
  if (!url.host || url.hasUserInfo) return false;
  if (url.scheme === "https") {
    return isLaptopTunnelHost(url.host) || url.host.endsWith(".trycloudflare.com");
  }
  if (url.scheme === "http") return isTailscaleOrLoopback(url.host);
  return false;
}

function makeLink(code: string, base: string): PairingLink | null {
  const trimmed = code.trim();
  const url = parseURL(base);
  if (!url || !isValidCode(trimmed) || !isAllowedBase(url)) return null;
  const origin = originOf(url);
  if (!origin) return null;
  return {
    code: trimmed,
    baseURL: origin,
    host: url.host,
    isNamedTunnel: url.scheme === "https" && isLaptopTunnelHost(url.host),
  };
}

/** Parses a scanned QR or pasted pairing link. Null for anything else. */
export function parsePairingLink(text: string): PairingLink | null {
  const url = parseURL(text.trim());
  if (!url || url.fragment === null || url.hasUserInfo) return null;
  const params = fragmentParams(url.fragment);
  const code = params.get("pair");
  if (!code) return null;
  const host = params.get("host");
  if (host !== undefined) {
    // Hosted-app link: the laptop is named by `host`, never by the page.
    if (!isLaptopTunnelHost(host)) return null;
    return makeLink(code, `https://${host.toLowerCase()}`);
  }
  // Laptop-served link: the laptop is the page's own origin.
  const origin = originOf(url);
  return origin ? makeLink(code, origin) : null;
}

/**
 * Typed or pasted by hand: a full pairing link in `address` wins; otherwise
 * `address` names the laptop (`lt-….pipper.dev`, a Tailscale IP, or a URL)
 * and `code` is the one shown under the QR.
 */
export function manualPairingLink(address: string, code: string): PairingLink | null {
  const text = address.trim();
  const link = parsePairingLink(text);
  if (link) return link;
  if (!text) return null;
  if (text.includes("://")) {
    const url = parseURL(text);
    const origin = url && !url.hasUserInfo && originOf(url);
    return origin ? makeLink(code, origin) : null;
  }
  const host = text.split("/")[0]!;
  const bare = host.split(":")[0]!;
  if (isLaptopTunnelHost(bare)) return makeLink(code, `https://${host.toLowerCase()}`);
  return makeLink(code, `http://${host.includes(":") ? host : `${host}:${DEFAULT_LAPTOP_PORT}`}`);
}
