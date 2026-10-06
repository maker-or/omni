import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { generateKeyPairSync, verify } from "node:crypto";
import { signLaptopCredential } from "./desktop-auth.ts";

const attestationKeys = generateKeyPairSync("ed25519");
import { POST } from "../pages/api/remote/tunnel.json.ts";

const SECRET = "s".repeat(48);
const LAPTOP = "3f2c8a1e-7b4d-4e9a-9c1f-2a6b8d0e4f17";

function call(body: unknown, auth?: string) {
  const request = new Request("https://www.pipper.dev/api/remote/tunnel.json", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST({ request } as Parameters<typeof POST>[0]) as Promise<Response>;
}

describe("POST /api/remote/tunnel.json", () => {
  let cloudflareCalls: string[];

  beforeEach(() => {
    vi.stubEnv("PIPPER_LAPTOP_CREDENTIAL_SECRET", SECRET);
    vi.stubEnv(
      "PIPPER_LAPTOP_ATTESTATION_KEY",
      attestationKeys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    );
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "cf-secret-token");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct");
    vi.stubEnv("CLOUDFLARE_ZONE_ID", "zone");
    vi.stubEnv("REMOTE_TUNNEL_DOMAIN", "pipper-remote.dev");
    cloudflareCalls = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      cloudflareCalls.push(`${init?.method ?? "GET"} ${url}`);
      const path = new URL(url).pathname;
      const result = path.endsWith("/token")
        ? "connector-token"
        : path.endsWith("/cfd_tunnel") && init?.method === "POST"
          ? { id: "tun-1", name: "x" }
          : init?.method === undefined || init.method === "GET"
            ? []
            : {};
      return new Response(JSON.stringify({ success: true, errors: [], result }));
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const credential = () =>
    signLaptopCredential(
      { sub: "user_1", lid: LAPTOP, email: "owner@example.com", name: "Owner" },
      SECRET,
    );

  test("returns this laptop's hostname and connector token, uncached", async () => {
    const res = await call({ port: 4173 }, `Bearer ${credential()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { hostname: string; token: string; attestation: string };
    expect(body.token).toBe("connector-token");
    // The owner statement is signed by pipper.dev and names this hostname.
    const [prefix, payload, sig] = body.attestation.split(".");
    expect(
      verify(
        null,
        Buffer.from(`${prefix}.${payload}`),
        attestationKeys.publicKey,
        Buffer.from(sig!, "base64url"),
      ),
    ).toBe(true);
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toMatchObject({
      host: body.hostname,
      sub: "user_1",
      email: "owner@example.com",
      name: "Owner",
    });
    expect(body.hostname).toMatch(/^lt-[0-9a-f]{20}\.pipper-remote\.dev$/);
  });

  test("refuses missing, forged, or foreign-secret credentials before touching Cloudflare", async () => {
    const other = signLaptopCredential({ sub: "user_1", lid: LAPTOP }, "t".repeat(48));
    for (const auth of [undefined, "Bearer nope", `Bearer ${other}`, `Basic ${credential()}`]) {
      expect((await call({ port: 4173 }, auth)).status).toBe(401);
    }
    expect(cloudflareCalls).toEqual([]);
  });

  test("validates the port", async () => {
    for (const port of [80, 70000, 4173.5, "4173", null]) {
      expect((await call({ port }, `Bearer ${credential()}`)).status).toBe(400);
    }
    expect((await call("{bad json", `Bearer ${credential()}`)).status).toBe(400);
  });

  test("is unavailable, not broken, when the server isn't configured", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
    expect((await call({ port: 4173 }, `Bearer ${credential()}`)).status).toBe(503);
  });

  test("hides Cloudflare error details from the caller", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 10000, message: "acct acct secret" }],
          }),
          { status: 403 },
        ),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await call({ port: 4173 }, `Bearer ${credential()}`);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("acct");
  });
});
