import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Desktop sign-in handoff. The desktop app opens /auth with three params:
 * `return_to` (its loopback callback), `state` (a one-time value it checks
 * on the way back) and `laptop_id` (a random id it keeps per install). After
 * Clerk sign-in, /auth/complete redirects to the callback with the user's
 * profile, the echoed state, and a signed laptop credential.
 */

/** Params forwarded from /auth (and /sign-in, /sign-up) to /auth/complete. */
export const HANDOFF_PARAMS = ["return_to", "state", "laptop_id"] as const;

const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const LAPTOP_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Laptop credentials last 90 days; signing in again issues a fresh one. */
export const LAPTOP_CREDENTIAL_TTL_MS = 90 * 24 * 60 * 60_000;
const CREDENTIAL_PREFIX = "pl1";

/** /auth/complete URL carrying the desktop's handoff params through Clerk. */
export function authCompleteUrl(current: URL): URL {
  const next = new URL("/auth/complete", current);
  for (const key of HANDOFF_PARAMS) {
    const value = current.searchParams.get(key);
    if (value) next.searchParams.set(key, value);
  }
  return next;
}

/**
 * Only the desktop's own loopback listener may receive a signed-in user's
 * profile and credential. Anything else would make /auth/complete an open
 * redirect that hands identity to whoever crafted the link.
 */
export function isLoopbackCallback(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
    url.port !== "" &&
    url.pathname === "/auth/callback" &&
    url.username === "" &&
    url.password === ""
  );
}

export function validState(value: string | null): string | null {
  return value && STATE_RE.test(value) ? value : null;
}

export function validLaptopId(value: string | null): string | null {
  const lower = value?.toLowerCase() ?? null;
  return lower && LAPTOP_ID_RE.test(lower) ? lower : null;
}

export interface LaptopClaims {
  /** Clerk user id. */
  sub: string;
  /** Per-install laptop id; a credential only ever controls that laptop. */
  lid: string;
  /** Owner shown to phones (via the laptop attestation); from Clerk at sign-in. */
  email?: string | null;
  name?: string | null;
  iat: number;
  exp: number;
}

function hmac(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

/** Server secret for laptop credentials; null when unset or too short to be safe. */
export function laptopCredentialSecret(raw: string | undefined): string | null {
  return raw && raw.length >= 32 ? raw : null;
}

export function signLaptopCredential(
  claims: { sub: string; lid: string; email?: string | null; name?: string | null },
  secret: string,
  now = Date.now(),
): string {
  const payload: LaptopClaims = {
    sub: claims.sub,
    lid: claims.lid,
    email: claims.email ?? null,
    name: claims.name ?? null,
    iat: now,
    exp: now + LAPTOP_CREDENTIAL_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signed = `${CREDENTIAL_PREFIX}.${body}`;
  return `${signed}.${hmac(secret, signed).toString("base64url")}`;
}

/** Claims of a valid, unexpired credential, else null. */
export function verifyLaptopCredential(
  token: string,
  secret: string,
  now = Date.now(),
): LaptopClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== CREDENTIAL_PREFIX) return null;
  const expected = hmac(secret, `${parts[0]}.${parts[1]}`);
  const given = Buffer.from(parts[2]!, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let claims: Partial<LaptopClaims>;
  try {
    claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof claims.sub !== "string" ||
    !claims.sub ||
    typeof claims.lid !== "string" ||
    !validLaptopId(claims.lid) ||
    typeof claims.exp !== "number" ||
    typeof claims.iat !== "number" ||
    now >= claims.exp
  ) {
    return null;
  }
  const text = (value: unknown) =>
    typeof value === "string" && value ? value.slice(0, 200) : null;
  return {
    sub: claims.sub,
    lid: claims.lid,
    email: text(claims.email),
    name: text(claims.name),
    iat: claims.iat,
    exp: claims.exp,
  };
}
