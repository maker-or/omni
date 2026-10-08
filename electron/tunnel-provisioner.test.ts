import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  PIPPER_TUNNEL_API_PATH,
  TunnelSetupError,
  requestNamedTunnel,
} from "./tunnel-provisioner.ts";

function respond(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

async function failure(promise: Promise<unknown>): Promise<TunnelSetupError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(TunnelSetupError);
  return error as TunnelSetupError;
}

describe("named tunnel request", () => {
  it("sends the credential and port, and returns the tunnel", async () => {
    let seen: { url: string; auth: string | null; body: unknown } | null = null;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = {
        url,
        auth: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)),
      };
      return new Response(
        JSON.stringify({
          hostname: "Labc.pipper-remote.dev",
          token: "tok",
          attestation: "pa1.abc.def",
        }),
      );
    }) as unknown as typeof fetch;
    const tunnel = await requestNamedTunnel({
      credential: "pl1.a.b",
      port: 4173,
      apiBase: "https://staging.pipper.dev",
      fetchImpl,
    });
    expect(tunnel).toEqual({
      hostname: "labc.pipper-remote.dev",
      token: "tok",
      attestation: "pa1.abc.def",
    });
    expect(seen).toEqual({
      url: "https://staging.pipper.dev/api/remote/tunnel.json",
      auth: "Bearer pl1.a.b",
      body: { port: 4173 },
    });
  });

  it("needs a sign-in first, and says so without retrying", async () => {
    const error = await failure(requestNamedTunnel({ credential: null, port: 4173 }));
    expect(error.fatal).toBe(true);
    expect(error.signInRequired).toBe(true);
    expect(error.message).toMatch(/Sign in/);
  });

  it("treats auth, limit, and not-configured answers as needing the user", async () => {
    for (const status of [401, 409, 503]) {
      const error = await failure(
        requestNamedTunnel({
          credential: "c",
          port: 4173,
          fetchImpl: respond(status, { error: `no (${status})` }),
        }),
      );
      // Only a refused credential is fixed by signing in again.
      expect(error).toMatchObject({
        fatal: true,
        signInRequired: status === 401,
        message: `no (${status})`,
      });
    }
  });

  it("calls the path pipper.dev's router actually serves", () => {
    // Astro maps src/pages/<path>.ts to exactly /<path> (".json" included),
    // so the endpoint file must sit at the path the desktop requests.
    const page = join(__dirname, "..", "marketing", "src", "pages", `${PIPPER_TUNNEL_API_PATH}.ts`);
    expect(existsSync(page), page).toBe(true);
  });

  it("stops retrying when the endpoint doesn't exist", async () => {
    const error = await failure(
      requestNamedTunnel({ credential: "c", port: 4173, fetchImpl: respond(404, {}) }),
    );
    expect(error.fatal).toBe(true);
  });

  it("retries transient failures", async () => {
    for (const status of [429, 500, 502]) {
      const error = await failure(
        requestNamedTunnel({ credential: "c", port: 4173, fetchImpl: respond(status, {}) }),
      );
      expect(error.fatal).toBe(false);
    }
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const error = await failure(
      requestNamedTunnel({ credential: "c", port: 4173, fetchImpl: offline }),
    );
    expect(error.fatal).toBe(false);
  });

  it("passes on only something shaped like an owner statement", async () => {
    for (const attestation of [undefined, 42, "not-a-statement", "pa1.a.b.c"]) {
      const tunnel = await requestNamedTunnel({
        credential: "c",
        port: 4173,
        fetchImpl: respond(200, { hostname: "lt-a.pipper.dev", token: "t", attestation }),
      });
      expect(tunnel.attestation).toBeNull();
    }
  });

  it("rejects a malformed answer", async () => {
    for (const body of [{ hostname: "evil host", token: "t" }, { hostname: "a.example.com" }]) {
      const error = await failure(
        requestNamedTunnel({ credential: "c", port: 4173, fetchImpl: respond(200, body) }),
      );
      expect(error.fatal).toBe(false);
    }
  });
});
