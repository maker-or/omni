import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, test } from "vitest";
import { ATTESTATION_TTL_MS, attestationKey, signLaptopAttestation } from "./laptop-attestation.ts";

describe("laptop attestation", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");

  test("loads only an Ed25519 key", () => {
    expect(attestationKey(raw)?.asymmetricKeyType).toBe("ed25519");
    expect(attestationKey(undefined)).toBeNull();
    expect(attestationKey("not a key")).toBeNull();
    const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey;
    expect(
      attestationKey(rsa.export({ format: "der", type: "pkcs8" }).toString("base64")),
    ).toBeNull();
  });

  test("signs host and owner so anyone with the public key can check them", () => {
    const token = signLaptopAttestation(
      { host: "LT-ABC.pipper.dev", sub: "user_1", email: "a@b.c", name: "A" },
      attestationKey(raw)!,
      1_000,
    );
    const [prefix, body, sig] = token.split(".");
    expect(prefix).toBe("pa1");
    expect(
      verify(null, Buffer.from(`${prefix}.${body}`), publicKey, Buffer.from(sig!, "base64url")),
    ).toBe(true);
    expect(JSON.parse(Buffer.from(body!, "base64url").toString())).toEqual({
      v: 1,
      host: "lt-abc.pipper.dev",
      sub: "user_1",
      email: "a@b.c",
      name: "A",
      iat: 1_000,
      exp: 1_000 + ATTESTATION_TTL_MS,
    });
  });
});
