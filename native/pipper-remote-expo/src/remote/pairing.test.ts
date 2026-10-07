import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";

import { base64URLDecode, PIPPER_PUBLIC_KEY, verifyLaptopOwner } from "./attestation";
import { manualPairingLink, parsePairingLink } from "./pairing-link";

// Mirrors native/pipper-remote-ios/Tests/PipperRemoteCoreTests: the two apps
// must accept and refuse exactly the same pairing links and statements.

describe("pairing link", () => {
  it("parses a hosted-app link for a named tunnel", () => {
    const link = parsePairingLink(
      "https://remote.pipper.dev/#pair=7KD2MQX9HT&host=LT-ab12cd.pipper.dev",
    );
    expect(link?.code).toBe("7KD2MQX9HT");
    // The laptop is the `host` parameter, never the page that carried it.
    expect(link?.baseURL).toBe("https://lt-ab12cd.pipper.dev");
    expect(link?.isNamedTunnel).toBe(true);
  });

  it("parses laptop-served links", () => {
    const quick = parsePairingLink("https://calm-fox.trycloudflare.com/remote#pair=ABCDE-12345");
    expect(quick?.baseURL).toBe("https://calm-fox.trycloudflare.com");
    expect(quick?.isNamedTunnel).toBe(false);
    const tailnet = parsePairingLink("http://100.101.102.103:4173/remote#pair=ABCDE12345");
    expect(tailnet?.baseURL).toBe("http://100.101.102.103:4173");
  });

  it.each([
    "https://remote.pipper.dev/#pair=ABCDE&host=evil.example.com",
    "https://remote.pipper.dev/#pair=ABCDE&host=www.pipper.dev",
    "https://remote.pipper.dev/#pair=ABCDE&host=lt-x.pipper.dev.evil.com",
    "https://example.com/remote#pair=ABCDE",
    "http://192.168.1.4:4173/remote#pair=ABCDE",
    "http://lt-ab12cd.pipper.dev/remote#pair=ABCDE",
    "http://100.1.2.3:4173/remote#token=deadbeef",
    "https://lt-ab12cd.pipper.dev/#pair=bad%20code",
    "https://user@lt-ab12cd.pipper.dev/#pair=ABCDE",
    "not a url",
  ])("never points the app at a foreign host: %s", (text) => {
    expect(parsePairingLink(text)).toBeNull();
  });

  it("accepts typed addresses or a whole pasted link", () => {
    expect(manualPairingLink("lt-ab12cd.pipper.dev", " ABCDE-12345 ")?.baseURL).toBe(
      "https://lt-ab12cd.pipper.dev",
    );
    expect(manualPairingLink("100.82.38.10", "ABCDE")?.baseURL).toBe("http://100.82.38.10:4173");
    expect(manualPairingLink("100.82.38.10:5000", "ABCDE")?.baseURL).toBe(
      "http://100.82.38.10:5000",
    );
    expect(
      manualPairingLink("https://remote.pipper.dev/#pair=FROMLINK&host=lt-ab12cd.pipper.dev", "")
        ?.code,
    ).toBe("FROMLINK");
    expect(manualPairingLink("example.com", "ABCDE")).toBeNull();
    expect(manualPairingLink("lt-ab12cd.pipper.dev", "")).toBeNull();
  });
});

describe("laptop owner statement", () => {
  const utf8 = (text: string) => new TextEncoder().encode(text);
  const b64url = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const secret = ed25519.utils.randomSecretKey();
  const publicKey = b64url(ed25519.getPublicKey(secret));
  const now = 1_800_000_000_000;
  const claims = {
    host: "lt-ab12cd.pipper.dev",
    sub: "user_1",
    email: "me@example.com",
    name: "Mé",
    exp: now + 3_600_000,
  };

  /** Signs like pipper.dev: `pa1.<b64url JSON>.<b64url Ed25519 sig>`. */
  const sign = (body: object, key = secret) => {
    const head = `pa1.${b64url(utf8(JSON.stringify(body)))}`;
    return `${head}.${b64url(ed25519.sign(utf8(head), key))}`;
  };

  it("verifies the owner for this exact host", () => {
    expect(verifyLaptopOwner(sign(claims), "LT-ab12cd.pipper.dev", publicKey, now)).toEqual({
      verified: true,
      owner: { sub: "user_1", email: "me@example.com", name: "Mé" },
    });
  });

  it("refuses forged, moved, expired, or missing statements", () => {
    const statement = sign(claims);
    const cases: [string | null, string][] = [
      [sign(claims, ed25519.utils.randomSecretKey()), "lt-ab12cd.pipper.dev"],
      [statement, "lt-other.pipper.dev"],
      [sign({ ...claims, exp: now - 1 }), "lt-ab12cd.pipper.dev"],
      ["pa1.garbage", "lt-ab12cd.pipper.dev"],
      [null, "lt-ab12cd.pipper.dev"],
    ];
    for (const [text, host] of cases) {
      expect(verifyLaptopOwner(text, host, publicKey, now).verified).toBe(false);
    }
  });

  it("ships a usable public key", () => {
    expect(base64URLDecode(PIPPER_PUBLIC_KEY)?.length).toBe(32);
  });
});
