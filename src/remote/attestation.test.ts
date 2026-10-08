import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
// pipper.dev's real signer: the phone must verify exactly what it produces.
import { signLaptopAttestation } from "../../marketing/src/lib/laptop-attestation.ts";
import { verifyLaptopOwner } from "./attestation.ts";

const HOST = "lt-0123456789abcdef0123.pipper.dev";

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicRaw: publicKey.export({ format: "jwk" }).x! };
}

describe("laptop owner verification", () => {
  const pipper = keys();
  const sign = (host = HOST, now = Date.now(), key = pipper.privateKey) =>
    signLaptopAttestation(
      { host, sub: "user_owner", email: "owner@example.com", name: "Owner" },
      key,
      now,
    );

  it("accepts pipper.dev's statement for this exact host", async () => {
    expect(await verifyLaptopOwner(sign(), HOST, pipper.publicRaw)).toEqual({
      verified: true,
      owner: { sub: "user_owner", email: "owner@example.com", name: "Owner" },
    });
  });

  it("rejects a statement signed by anyone else (e.g. an attacker's own key)", async () => {
    const attacker = keys();
    const forged = sign(HOST, Date.now(), attacker.privateKey);
    expect(await verifyLaptopOwner(forged, HOST, pipper.publicRaw)).toMatchObject({
      verified: false,
    });
  });

  it("rejects a real statement replayed for a different laptop", async () => {
    const forOtherLaptop = sign("lt-ffffffffffffffffffff.pipper.dev");
    expect(await verifyLaptopOwner(forOtherLaptop, HOST, pipper.publicRaw)).toMatchObject({
      verified: false,
      reason: expect.stringMatching(/different laptop/),
    });
  });

  it("rejects tampered owner details", async () => {
    const [prefix, body, sig] = sign().split(".");
    const claims = JSON.parse(Buffer.from(body!, "base64url").toString());
    const swapped = Buffer.from(
      JSON.stringify({ ...claims, email: "victim@example.com" }),
    ).toString("base64url");
    expect(
      await verifyLaptopOwner(`${prefix}.${swapped}.${sig}`, HOST, pipper.publicRaw),
    ).toMatchObject({
      verified: false,
    });
  });

  it("rejects expired, missing, and malformed statements, and a missing key", async () => {
    const old = sign(HOST, Date.now() - 31 * 24 * 60 * 60_000);
    for (const [attestation, key] of [
      [old, pipper.publicRaw],
      [null, pipper.publicRaw],
      ["pa1.only-two", pipper.publicRaw],
      ["xx1.a.b", pipper.publicRaw],
      [sign(), undefined],
    ] as const) {
      expect(await verifyLaptopOwner(attestation, HOST, key)).toMatchObject({ verified: false });
    }
  });
});
