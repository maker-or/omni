import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DesktopIdentity, withSignInParams, type SecretBox } from "./desktop-identity.ts";

/** Reversible stand-in for safeStorage, so tests can see what reaches disk. */
const fakeBox: SecretBox = {
  available: () => true,
  encrypt: (plain) => Buffer.from(`enc:${Buffer.from(plain).toString("base64")}`),
  decrypt: (cipher) => Buffer.from(cipher.toString().slice(4), "base64").toString(),
};

describe("desktop identity", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "identity-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps one laptop id per install", () => {
    const id = new DesktopIdentity({ dir }).laptopId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new DesktopIdentity({ dir }).laptopId()).toBe(id);
  });

  it("accepts each sign-in state once, and only before it expires", () => {
    const identity = new DesktopIdentity({ dir });
    const state = identity.beginSignIn(0);
    expect(identity.consumeState("forged", 1)).toBe(false);
    expect(identity.consumeState(state, 1)).toBe(true);
    expect(identity.consumeState(state, 2)).toBe(false);
    const late = identity.beginSignIn(0);
    expect(identity.consumeState(late, 16 * 60_000)).toBe(false);
    expect(identity.consumeState(null)).toBe(false);
  });

  it("remembers only a few pending sign-ins", () => {
    const identity = new DesktopIdentity({ dir });
    const states = Array.from({ length: 6 }, () => identity.beginSignIn(0));
    expect(identity.consumeState(states[0]!, 1)).toBe(false);
    expect(identity.consumeState(states[5]!, 1)).toBe(true);
  });

  it("stores the credential only encrypted, and reloads it", () => {
    new DesktopIdentity({ dir, secretBox: fakeBox }).saveCredential("pl1.secret.sig");
    expect(readFileSync(join(dir, "laptop-credential.bin"), "utf8")).not.toContain("secret");
    const reloaded = new DesktopIdentity({ dir, secretBox: fakeBox });
    expect(reloaded.credential()).toBe("pl1.secret.sig");
    reloaded.clearCredential();
    expect(new DesktopIdentity({ dir, secretBox: fakeBox }).credential()).toBeNull();
  });

  it("keeps the credential in memory only without OS encryption", () => {
    const box: SecretBox = { ...fakeBox, available: () => false };
    const identity = new DesktopIdentity({ dir, secretBox: box });
    identity.saveCredential("pl1.secret.sig");
    expect(identity.credential()).toBe("pl1.secret.sig");
    expect(new DesktopIdentity({ dir, secretBox: box }).credential()).toBeNull();
  });

  it("adds the handoff params to the sign-in URL", () => {
    const url = new URL(
      withSignInParams("https://www.pipper.dev/auth", {
        returnTo: "http://127.0.0.1:5000/auth/callback",
        state: "s1",
        laptopId: "l1",
      }),
    );
    expect(url.searchParams.get("return_to")).toBe("http://127.0.0.1:5000/auth/callback");
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("laptop_id")).toBe("l1");
  });
});
