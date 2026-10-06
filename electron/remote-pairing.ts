import { randomInt } from "node:crypto";
import type { RemoteScope } from "../contracts/remote.ts";
import { tokensEqual } from "./remote-security.ts";

/** How long a pairing code stays redeemable. */
export const PAIRING_CODE_TTL_MS = 5 * 60_000;
/** Wrong guesses tolerated before the live code is thrown away. */
export const MAX_FAILED_REDEEMS = 20;

// Crockford base32: no I, L, O, U, so codes read and type unambiguously.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 10; // 50 bits

export interface PairingCode {
  /** Canonical form without separators, e.g. "7KD2MQX9HT". */
  code: string;
  expiresAt: number;
  scopes: RemoteScope[];
}

/** "7KD2MQX9HT" → "7KD2M-QX9HT". */
export function formatPairingCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** Accept what a person types: any case, dashes/spaces, O for 0, I/L for 1. */
export function normalizePairingCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

/**
 * The single pairing code the laptop is currently offering. Kept in memory
 * only — a restart simply cancels it. At most one code is live: creating a
 * new one replaces the old. Codes are single-use, expire after
 * PAIRING_CODE_TTL_MS, and are discarded after MAX_FAILED_REDEEMS wrong
 * guesses, so 50 bits is far beyond what an online guesser can cover.
 */
export class PairingCodes {
  private current: PairingCode | null = null;
  private failures = 0;

  create(scopes: RemoteScope[], now = Date.now()): PairingCode {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
    this.current = { code, expiresAt: now + PAIRING_CODE_TTL_MS, scopes: [...scopes] };
    this.failures = 0;
    return this.current;
  }

  /** The live code, or null when there is none or it expired. */
  active(now = Date.now()): PairingCode | null {
    if (this.current && now >= this.current.expiresAt) this.current = null;
    return this.current;
  }

  cancel(): void {
    this.current = null;
    this.failures = 0;
  }

  /**
   * Check a code without using it up (pairing preview). Wrong guesses count
   * toward the same discard limit as redeem(), so previews can't be used to
   * guess freely.
   */
  check(input: string, now = Date.now()): RemoteScope[] | null {
    const live = this.active(now);
    if (!live) return null;
    if (!tokensEqual(normalizePairingCode(input), live.code)) {
      this.failures += 1;
      if (this.failures >= MAX_FAILED_REDEEMS) this.cancel();
      return null;
    }
    return live.scopes;
  }

  /** Consume the code; returns its scopes, or null for anything but a live match. */
  redeem(input: string, now = Date.now()): RemoteScope[] | null {
    const scopes = this.check(input, now);
    if (scopes) this.cancel();
    return scopes;
  }
}
