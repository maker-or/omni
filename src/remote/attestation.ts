/**
 * Checks pipper.dev's signed "laptop H belongs to account S" statement
 * (marketing/src/lib/laptop-attestation.ts) with the public key built into
 * the hosted app. A laptop can only present its real owner: an attacker who
 * sends a pairing link to *their* laptop shows *their* account.
 */

export interface LaptopOwner {
  sub: string;
  email: string | null;
  name: string | null;
}

export type OwnerCheck =
  | { verified: true; owner: LaptopOwner }
  | { verified: false; reason: string };

const PREFIX = "pa1";

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function verifyLaptopOwner(
  attestation: string | null,
  host: string,
  publicKey: string | undefined,
  now = Date.now(),
): Promise<OwnerCheck> {
  if (!publicKey) return { verified: false, reason: "This app can't check laptop owners." };
  if (!attestation) return { verified: false, reason: "The laptop didn't say who owns it." };
  const parts = attestation.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    return { verified: false, reason: "The laptop's owner statement is malformed." };
  }
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      fromBase64Url(publicKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "Ed25519",
      key,
      fromBase64Url(parts[2]!),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok)
      return { verified: false, reason: "The laptop's owner statement isn't signed by Pipper." };
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1]!))) as {
      host?: unknown;
      sub?: unknown;
      email?: unknown;
      name?: unknown;
      exp?: unknown;
    };
    if (typeof claims.host !== "string" || claims.host !== host.toLowerCase()) {
      return { verified: false, reason: "The owner statement is for a different laptop." };
    }
    if (typeof claims.exp !== "number" || now >= claims.exp) {
      return { verified: false, reason: "The laptop's owner statement has expired." };
    }
    if (typeof claims.sub !== "string" || !claims.sub) {
      return { verified: false, reason: "The laptop's owner statement is malformed." };
    }
    return {
      verified: true,
      owner: {
        sub: claims.sub,
        email: typeof claims.email === "string" ? claims.email : null,
        name: typeof claims.name === "string" ? claims.name : null,
      },
    };
  } catch {
    return { verified: false, reason: "The laptop's owner statement couldn't be checked." };
  }
}
