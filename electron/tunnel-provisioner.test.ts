import { describe, expect, it } from "vitest";
import { TunnelSetupError, requestNamedTunnel } from "./tunnel-provisioner.ts";

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
      return new Response(JSON.stringify({ hostname: "Labc.pipper-remote.dev", token: "tok" }));
    }) as unknown as typeof fetch;
    const tunnel = await requestNamedTunnel({
      credential: "pl1.a.b",
      port: 4173,
      apiBase: "https://staging.pipper.dev",
      fetchImpl,
    });
    expect(tunnel).toEqual({ hostname: "labc.pipper-remote.dev", token: "tok" });
    expect(seen).toEqual({
      url: "https://staging.pipper.dev/api/remote/tunnel",
      auth: "Bearer pl1.a.b",
      body: { port: 4173 },
    });
  });

  it("needs a sign-in first, and says so without retrying", async () => {
    const error = await failure(requestNamedTunnel({ credential: null, port: 4173 }));
    expect(error.fatal).toBe(true);
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
      expect(error).toMatchObject({ fatal: true, message: `no (${status})` });
    }
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

  it("rejects a malformed answer", async () => {
    for (const body of [{ hostname: "evil host", token: "t" }, { hostname: "a.example.com" }]) {
      const error = await failure(
        requestNamedTunnel({ credential: "c", port: 4173, fetchImpl: respond(200, body) }),
      );
      expect(error.fatal).toBe(false);
    }
  });
});
