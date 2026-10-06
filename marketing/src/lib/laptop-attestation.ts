import { createPrivateKey, sign, type KeyObject } from "node:crypto";

/**
 * pipper.dev's signed statement "laptop host H belongs to account S (email,
 * name)". The phone app verifies it with the matching public key built into
 * it (src/remote/attestation.ts), so a laptop can only ever present its
 * owner's real identity — a pairing link to someone else's laptop shows
 * *their* account, not a name they made up.
 *
 * Format: `pa1.<base64url JSON>.<base64url Ed25519 signature over "pa1.<JSON part>">`.
 */

export const ATTESTATION_PREFIX = "pa1";
/** Laptops re-provision on every launch, so a month is plenty. */
export const ATTESTATION_TTL_MS = 30 * 24 * 60 * 60_000;

export interface LaptopAttestation {
  v: 1;
  /** Laptop hostname the statement is about (e.g. lt-….pipper.dev). */
  host: string;
  /** Clerk user id of the owner. */
  sub: string;
  email: string | null;
  name: string | null;
  iat: number;
  exp: number;
}

/**
 * Ed25519 private key from PIPPER_LAPTOP_ATTESTATION_KEY (base64 PKCS#8 DER,
 * as printed by scripts/generate-attestation-key.mjs); null when unset/invalid.
 */
export function attestationKey(raw: string | undefined): KeyObject | null {
  if (!raw) return null;
  try {
    const key = createPrivateKey({ key: Buffer.from(raw, "base64"), format: "der", type: "pkcs8" });
    return key.asymmetricKeyType === "ed25519" ? key : null;
  } catch {
    return null;
  }
}

export function signLaptopAttestation(
  claims: { host: string; sub: string; email?: string | null; name?: string | null },
  key: KeyObject,
  now = Date.now(),
): string {
  const payload: LaptopAttestation = {
    v: 1,
    host: claims.host.toLowerCase(),
    sub: claims.sub,
    email: claims.email ?? null,
    name: claims.name ?? null,
    iat: now,
    exp: now + ATTESTATION_TTL_MS,
  };
  const signed = `${ATTESTATION_PREFIX}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${signed}.${sign(null, Buffer.from(signed), key).toString("base64url")}`;
}
