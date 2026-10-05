import { describe, expect, test } from "vitest";
import {
  LAPTOP_CREDENTIAL_TTL_MS,
  authCompleteUrl,
  isLoopbackCallback,
  laptopCredentialSecret,
  signLaptopCredential,
  validLaptopId,
  validState,
  verifyLaptopCredential,
} from "./desktop-auth.ts";

const SECRET = "s".repeat(48);
const LAPTOP = "3f2c8a1e-7b4d-4e9a-9c1f-2a6b8d0e4f17";

describe("desktop auth handoff", () => {
  test("only the desktop's loopback callback may receive identity", () => {
    expect(isLoopbackCallback("http://127.0.0.1:53121/auth/callback")).toBe(true);
    expect(isLoopbackCallback("http://localhost:53121/auth/callback")).toBe(true);
    for (const bad of [
      "https://evil.example/auth/callback",
      "http://127.0.0.1.evil.example:80/auth/callback",
      "http://127.0.0.1/auth/callback",
      "http://127.0.0.1:53121/other",
      "http://user:pw@127.0.0.1:53121/auth/callback",
      "javascript:alert(1)",
      "",
    ]) {
      expect(isLoopbackCallback(bad), bad).toBe(false);
    }
  });

  test("forwards only the handoff params to /auth/complete", () => {
    const url = authCompleteUrl(
      new URL(
        `https://www.pipper.dev/auth?return_to=http%3A%2F%2F127.0.0.1%3A5%2Fauth%2Fcallback&state=abcdefghijklmnop&laptop_id=${LAPTOP}&x=1`,
      ),
    );
    expect(url.pathname).toBe("/auth/complete");
    expect([...url.searchParams.keys()]).toEqual(["return_to", "state", "laptop_id"]);
  });

  test("validates state and laptop ids", () => {
    expect(validState("abcdefghijklmnop")).toBe("abcdefghijklmnop");
    expect(validState("short")).toBeNull();
    expect(validState("has spaces in it here")).toBeNull();
    expect(validLaptopId(LAPTOP.toUpperCase())).toBe(LAPTOP);
    expect(validLaptopId("not-a-uuid")).toBeNull();
  });
});

describe("laptop credentials", () => {
  test("round-trip user and laptop and expire after the TTL", () => {
    const token = signLaptopCredential({ sub: "user_1", lid: LAPTOP }, SECRET, 1_000);
    expect(verifyLaptopCredential(token, SECRET, 2_000)).toMatchObject({
      sub: "user_1",
      lid: LAPTOP,
    });
    expect(verifyLaptopCredential(token, SECRET, 1_000 + LAPTOP_CREDENTIAL_TTL_MS)).toBeNull();
  });

  test("reject tampering, other secrets, and junk", () => {
    const token = signLaptopCredential({ sub: "user_1", lid: LAPTOP }, SECRET, 0);
    const [prefix, body, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ sub: "user_2", lid: LAPTOP, iat: 0, exp: 9e15 }),
    ).toString("base64url");
    expect(verifyLaptopCredential(`${prefix}.${forged}.${sig}`, SECRET, 1)).toBeNull();
    expect(verifyLaptopCredential(token, "t".repeat(48), 1)).toBeNull();
    expect(verifyLaptopCredential(`${prefix}.${body}`, SECRET, 1)).toBeNull();
    expect(verifyLaptopCredential("garbage", SECRET, 1)).toBeNull();
  });

  test("refuse a weak signing secret", () => {
    expect(laptopCredentialSecret(undefined)).toBeNull();
    expect(laptopCredentialSecret("short")).toBeNull();
    expect(laptopCredentialSecret(SECRET)).toBe(SECRET);
  });
});
