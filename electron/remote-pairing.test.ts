import { describe, expect, it } from "vitest";
import {
  MAX_FAILED_REDEEMS,
  PAIRING_CODE_TTL_MS,
  PairingCodes,
  formatPairingCode,
  normalizePairingCode,
} from "./remote-pairing.ts";

describe("pairing codes", () => {
  it("redeems exactly once and hands back the offered scopes", () => {
    const codes = new PairingCodes();
    const { code } = codes.create(["read"], 0);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(codes.redeem(formatPairingCode(code), 1)).toEqual(["read"]);
    expect(codes.redeem(code, 2)).toBeNull();
  });

  it("accepts what people type", () => {
    expect(normalizePairingCode(" ab0il-o1xyz ")).toBe("AB011" + "01XYZ");
  });

  it("expires", () => {
    const codes = new PairingCodes();
    const { code } = codes.create(["read", "run"], 0);
    expect(codes.redeem(code, PAIRING_CODE_TTL_MS)).toBeNull();
    expect(codes.active(PAIRING_CODE_TTL_MS)).toBeNull();
  });

  it("replaces an older code when a new one is created", () => {
    const codes = new PairingCodes();
    const first = codes.create(["read"], 0).code;
    const second = codes.create(["read"], 1).code;
    expect(codes.redeem(first, 2)).toBeNull();
    expect(codes.redeem(second, 3)).toEqual(["read"]);
  });

  it("checks a code without using it up, counting wrong guesses", () => {
    const codes = new PairingCodes();
    const { code } = codes.create(["read"], 0);
    expect(codes.check(code, 1)).toEqual(["read"]);
    expect(codes.check(code, 2)).toEqual(["read"]);
    expect(codes.redeem(code, 3)).toEqual(["read"]);
    const next = codes.create(["read"], 4).code;
    for (let i = 0; i < MAX_FAILED_REDEEMS; i++) codes.check("0000000000", 5);
    expect(codes.redeem(next, 6)).toBeNull();
  });

  it("throws the code away after too many wrong guesses", () => {
    const codes = new PairingCodes();
    const { code } = codes.create(["read"], 0);
    for (let i = 0; i < MAX_FAILED_REDEEMS; i++) codes.redeem("0000000000", 1);
    expect(codes.redeem(code, 2)).toBeNull();
  });
});
