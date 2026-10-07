import { ed25519 } from "@noble/curves/ed25519.js";

import type { LaptopOwner } from "./types";

/**
 * pipper.dev's signed "laptop H belongs to account S" statement
 * (marketing/src/lib/laptop-attestation.ts), checked with the public key
 * built into this app. A laptop can only present its real owner: someone who
 * sends a pairing link to *their* laptop shows *their* account.
 *
 * Same key as the hosted phone app (vite.remote-web.config.ts) and the iOS
 * app (`LaptopAttestation.pipperPublicKey`). Rotate all three together with
 * pipper.dev's `PIPPER_LAPTOP_ATTESTATION_KEY`.
 */
export const PIPPER_PUBLIC_KEY = "wwg9F0_hnCTB4nPa_zy3gFk5Blq2_NeVPruKcOWlAkQ";
const PREFIX = "pa1";

export type OwnerCheck =
  | { verified: true; owner: LaptopOwner }
  | { verified: false; reason: string };

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Hermes has no WebCrypto, and `atob` handles only the standard alphabet. */
export function base64URLDecode(value: string): Uint8Array | null {
  const input = value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (input.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((input.length * 3) / 4));
  let bits = 0;
  let buffer = 0;
  let o = 0;
  for (const ch of input) {
    const v = BASE64URL.indexOf(ch);
    if (v < 0) return null;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}

function asciiBytes(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
}

/** UTF-8 decode without relying on TextDecoder. */
function utf8(bytes: Uint8Array): string {
  return decodeURIComponent(
    Array.from(bytes, (b) => `%${b.toString(16).padStart(2, "0")}`).join(""),
  );
}

export function verifyLaptopOwner(
  attestation: string | null | undefined,
  host: string,
  publicKey: string = PIPPER_PUBLIC_KEY,
  now: number = Date.now(),
): OwnerCheck {
  if (!attestation) return { verified: false, reason: "The laptop didn't say who owns it." };
  const malformed: OwnerCheck = {
    verified: false,
    reason: "The laptop's owner statement is malformed.",
  };
  const parts = attestation.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return malformed;
  const payload = base64URLDecode(parts[1]!);
  const signature = base64URLDecode(parts[2]!);
  if (!payload || !signature) return malformed;
  const key = base64URLDecode(publicKey);
  if (!key || key.length !== 32) {
    return { verified: false, reason: "This app can't check laptop owners." };
  }
  let ok = false;
  try {
    ok = ed25519.verify(signature, asciiBytes(`${parts[0]}.${parts[1]}`), key);
  } catch {
    ok = false;
  }
  if (!ok)
    return { verified: false, reason: "The laptop's owner statement isn't signed by Pipper." };
  let claims: { host?: unknown; sub?: unknown; email?: unknown; name?: unknown; exp?: unknown };
  try {
    claims = JSON.parse(utf8(payload));
  } catch {
    return malformed;
  }
  if (typeof claims.host !== "string" || claims.host !== host.toLowerCase()) {
    return { verified: false, reason: "The owner statement is for a different laptop." };
  }
  // `exp` is milliseconds since 1970, like Date.now() on pipper.dev.
  if (typeof claims.exp !== "number" || now >= claims.exp) {
    return { verified: false, reason: "The laptop's owner statement has expired." };
  }
  if (typeof claims.sub !== "string" || !claims.sub) return malformed;
  return {
    verified: true,
    owner: {
      sub: claims.sub,
      email: typeof claims.email === "string" ? claims.email : null,
      name: typeof claims.name === "string" ? claims.name : null,
    },
  };
}
