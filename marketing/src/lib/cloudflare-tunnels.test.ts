import { describe, expect, test } from "vitest";
import {
  CloudflareApiError,
  MAX_TUNNELS_PER_USER,
  TunnelLimitError,
  provisionLaptopTunnel,
  tunnelEnv,
  tunnelLabels,
  type TunnelEnv,
} from "./cloudflare-tunnels.ts";

const ENV: TunnelEnv = {
  apiToken: "cf-test-token",
  accountId: "acct",
  zoneId: "zone",
  domain: "pipper-remote.dev",
};
const SECRET = "s".repeat(48);

interface Call {
  method: string;
  path: string;
  body: unknown;
  auth: string | null;
}

/** In-memory stand-in for the Cloudflare API endpoints the provisioner uses. */
function fakeCloudflare(
  seed: {
    tunnels?: Array<{ id: string; name: string }>;
    dns?: Array<{ id: string; name: string; content: string }>;
  } = {},
) {
  const tunnels = [...(seed.tunnels ?? [])];
  const dns = [...(seed.dns ?? [])];
  const calls: Call[] = [];
  const ok = (result: unknown) =>
    new Response(JSON.stringify({ success: true, errors: [], result }), { status: 200 });
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const path = url.pathname.replace("/client/v4", "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      method,
      path: `${path}${url.search}`,
      body,
      auth: new Headers(init?.headers).get("authorization"),
    });
    if (method === "GET" && path === "/accounts/acct/cfd_tunnel") {
      const name = url.searchParams.get("name");
      return ok(name ? tunnels.filter((t) => t.name === name) : tunnels);
    }
    if (method === "POST" && path === "/accounts/acct/cfd_tunnel") {
      const created = { id: `tun-${tunnels.length + 1}`, name: body.name };
      tunnels.push(created);
      return ok(created);
    }
    if (method === "PUT" && path.endsWith("/configurations")) return ok({});
    if (method === "GET" && path === "/zones/zone/dns_records") {
      return ok(dns.filter((r) => r.name === url.searchParams.get("name.exact")));
    }
    if (method === "POST" && path === "/zones/zone/dns_records") {
      dns.push({ id: `dns-${dns.length + 1}`, name: body.name, content: body.content });
      return ok({});
    }
    if (method === "PATCH" && path.startsWith("/zones/zone/dns_records/")) return ok({});
    if (method === "GET" && path.endsWith("/token"))
      return ok(`connector-token-for-${path.split("/")[4]}`);
    return new Response(
      JSON.stringify({ success: false, errors: [{ code: 7003, message: "No route" }] }),
      { status: 404 },
    );
  }) as typeof fetch;
  return { fetchImpl, calls, tunnels, dns };
}

describe("laptop tunnel provisioning", () => {
  const labels = tunnelLabels(SECRET, "user_1", "laptop-a", ENV.domain);

  test("labels are stable, single-level, and don't reveal the user id", () => {
    expect(tunnelLabels(SECRET, "user_1", "laptop-a", ENV.domain)).toEqual(labels);
    expect(labels.hostname).toMatch(/^l[0-9a-f]{20}\.pipper-remote\.dev$/);
    expect(labels.name.startsWith(labels.userPrefix)).toBe(true);
    expect(JSON.stringify(labels)).not.toContain("user_1");
    expect(tunnelLabels(SECRET, "user_1", "laptop-b", ENV.domain).userPrefix).toBe(
      labels.userPrefix,
    );
    expect(tunnelLabels(SECRET, "user_2", "laptop-a", ENV.domain).hostname).not.toBe(
      labels.hostname,
    );
  });

  test("creates a remotely managed tunnel, routes the hostname, and returns its token", async () => {
    const cf = fakeCloudflare();
    const result = await provisionLaptopTunnel(ENV, labels, 4173, cf.fetchImpl);
    expect(result).toEqual({
      tunnelId: "tun-1",
      hostname: labels.hostname,
      token: "connector-token-for-tun-1",
    });
    expect(cf.calls.every((c) => c.auth === "Bearer cf-test-token")).toBe(true);
    expect(
      cf.calls.find((c) => c.method === "POST" && c.path === "/accounts/acct/cfd_tunnel")?.body,
    ).toEqual({
      name: labels.name,
      config_src: "cloudflare",
    });
    expect(cf.calls.find((c) => c.method === "PUT")?.body).toEqual({
      config: {
        ingress: [
          { hostname: labels.hostname, service: "http://127.0.0.1:4173" },
          { service: "http_status:404" },
        ],
      },
    });
    expect(cf.dns).toEqual([
      { id: "dns-1", name: labels.hostname, content: "tun-1.cfargotunnel.com" },
    ]);
  });

  test("is idempotent: a second call reuses the tunnel and DNS record", async () => {
    const cf = fakeCloudflare();
    await provisionLaptopTunnel(ENV, labels, 4173, cf.fetchImpl);
    await provisionLaptopTunnel(ENV, labels, 4183, cf.fetchImpl);
    expect(cf.tunnels).toHaveLength(1);
    expect(cf.dns).toHaveLength(1);
    // The new port is still applied.
    expect(cf.calls.filter((c) => c.method === "PUT").at(-1)?.body).toMatchObject({
      config: { ingress: [{ service: "http://127.0.0.1:4183" }, {}] },
    });
  });

  test("repoints a stale DNS record at the current tunnel", async () => {
    const cf = fakeCloudflare({
      tunnels: [{ id: "tun-9", name: labels.name }],
      dns: [{ id: "dns-old", name: labels.hostname, content: "deleted.cfargotunnel.com" }],
    });
    await provisionLaptopTunnel(ENV, labels, 4173, cf.fetchImpl);
    expect(cf.calls.find((c) => c.method === "PATCH")).toMatchObject({
      path: "/zones/zone/dns_records/dns-old",
      body: { content: "tun-9.cfargotunnel.com", proxied: true },
    });
  });

  test("caps how many laptops one account can connect", async () => {
    const cf = fakeCloudflare({
      tunnels: Array.from({ length: MAX_TUNNELS_PER_USER }, (_, i) => ({
        id: `t${i}`,
        name: `${labels.userPrefix}other${i}`,
      })),
    });
    await expect(provisionLaptopTunnel(ENV, labels, 4173, cf.fetchImpl)).rejects.toBeInstanceOf(
      TunnelLimitError,
    );
    expect(cf.calls.some((c) => c.method === "POST")).toBe(false);
  });

  test("surfaces Cloudflare API failures", async () => {
    const failing = (async () =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 10000, message: "Authentication error" }],
        }),
        {
          status: 403,
        },
      )) as unknown as typeof fetch;
    await expect(provisionLaptopTunnel(ENV, labels, 4173, failing)).rejects.toBeInstanceOf(
      CloudflareApiError,
    );
  });

  test("needs every setting to be configured", () => {
    expect(tunnelEnv({})).toBeNull();
    expect(
      tunnelEnv({
        CLOUDFLARE_API_TOKEN: "t",
        CLOUDFLARE_ACCOUNT_ID: "a",
        CLOUDFLARE_ZONE_ID: "z",
        REMOTE_TUNNEL_DOMAIN: "Pipper-Remote.dev",
      }),
    ).toEqual({ apiToken: "t", accountId: "a", zoneId: "z", domain: "pipper-remote.dev" });
  });
});
