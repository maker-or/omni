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
    tunnels?: Array<{
      id: string;
      name: string;
      status?: string;
      conns_inactive_at?: string;
      created_at?: string;
    }>;
    dns?: Array<{ id: string; name: string; content: string }>;
  } = {},
) {
  const tunnels = [...(seed.tunnels ?? [])];
  const dns = [...(seed.dns ?? [])];
  const calls: Call[] = [];
  const ok = (result: unknown, resultInfo?: unknown) =>
    new Response(JSON.stringify({ success: true, errors: [], result, result_info: resultInfo }), {
      status: 200,
    });
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
      if (name) return ok(tunnels.filter((t) => t.name === name));
      // Real paging: the API never returns more than per_page at once.
      const perPage = Number(url.searchParams.get("per_page") ?? 20);
      const page = Number(url.searchParams.get("page") ?? 1);
      const slice = tunnels.slice((page - 1) * perPage, page * perPage);
      return ok(slice, {
        page,
        per_page: perPage,
        count: slice.length,
        total_count: tunnels.length,
      });
    }
    if (method === "DELETE" && path.startsWith("/accounts/acct/cfd_tunnel/")) {
      const id = path.split("/").pop();
      const index = tunnels.findIndex((t) => t.id === id);
      if (index >= 0) tunnels.splice(index, 1);
      return ok({});
    }
    if (method === "DELETE" && path.startsWith("/zones/zone/dns_records/")) {
      const id = path.split("/").pop();
      const index = dns.findIndex((r) => r.id === id);
      if (index >= 0) dns.splice(index, 1);
      return ok({});
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
    expect(labels.hostname).toMatch(/^lt-[0-9a-f]{20}\.pipper-remote\.dev$/);
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

  test("caps how many laptops one account can have online at once", async () => {
    const cf = fakeCloudflare({
      tunnels: Array.from({ length: MAX_TUNNELS_PER_USER }, (_, i) => ({
        id: `t${i}`,
        name: `${labels.userPrefix}other${i}`,
        status: "healthy",
      })),
    });
    await expect(provisionLaptopTunnel(ENV, labels, 4173, cf.fetchImpl)).rejects.toBeInstanceOf(
      TunnelLimitError,
    );
    expect(cf.calls.some((c) => c.method === "POST" || c.method === "DELETE")).toBe(false);
  });

  test("frees a slot by deleting the user's longest-offline tunnel", async () => {
    // A reinstall mints a new laptop id; old tunnels must not lock the account out.
    const other = (i: number) => `${labels.userPrefix}${String(i).padStart(20, "0")}`;
    const host = (i: number) => `lt-${String(i).padStart(20, "0")}.${ENV.domain}`;
    const cf = fakeCloudflare({
      tunnels: [
        { id: "t0", name: other(0), status: "healthy" },
        { id: "t1", name: other(1), status: "down", conns_inactive_at: "2026-09-01T00:00:00Z" },
        { id: "t2", name: other(2), status: "down", conns_inactive_at: "2026-01-01T00:00:00Z" },
        { id: "t3", name: other(3), status: "inactive", created_at: "2026-06-01T00:00:00Z" },
        { id: "t4", name: other(4), status: "degraded" },
        { id: "someone-else", name: "pipper-zzzzzzzzzz-x", status: "down" },
      ],
      dns: [
        { id: "d2", name: host(2), content: "t2.cfargotunnel.com" },
        { id: "unrelated", name: host(2), content: "not-ours.example" },
      ],
    });
    const result = await provisionLaptopTunnel(ENV, labels, 4173, cf.fetchImpl);
    expect(result.hostname).toBe(labels.hostname);
    const ids = cf.tunnels.map((t) => t.id);
    expect(ids).not.toContain("t2"); // offline the longest
    expect(ids).toEqual(expect.arrayContaining(["t0", "t1", "t3", "t4", "someone-else"]));
    expect(cf.dns.map((r) => r.id)).not.toContain("d2");
    expect(cf.dns.map((r) => r.id)).toContain("unrelated");
  });

  test("counts the user's tunnels beyond the first page", async () => {
    const cf = fakeCloudflare({
      tunnels: [
        ...Array.from({ length: 1000 }, (_, i) => ({ id: `x${i}`, name: `pipper-other-${i}` })),
        ...Array.from({ length: MAX_TUNNELS_PER_USER }, (_, i) => ({
          id: `t${i}`,
          name: `${labels.userPrefix}other${i}`,
          status: "healthy",
        })),
      ],
    });
    await expect(provisionLaptopTunnel(ENV, labels, 4173, cf.fetchImpl)).rejects.toBeInstanceOf(
      TunnelLimitError,
    );
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
