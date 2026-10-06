import { createHmac } from "node:crypto";

/**
 * One named Cloudflare tunnel per (user, laptop), provisioned with the
 * account's API token, which never leaves this server. Names and hostnames
 * are derived from an HMAC of the ids, so no database is needed: Cloudflare
 * holds the record, repeated calls are idempotent, and outsiders who learn a
 * user id still can't compute that user's hostname.
 */

export interface TunnelEnv {
  apiToken: string;
  accountId: string;
  zoneId: string;
  /** Zone the laptop hostnames live under, e.g. "pipper-remote.dev". */
  domain: string;
}

export interface TunnelLabels {
  name: string;
  hostname: string;
  /** Prefix shared by every tunnel of this user (for the per-user cap). */
  userPrefix: string;
}

export interface ProvisionedTunnel {
  tunnelId: string;
  hostname: string;
  /** Connector token for `cloudflared tunnel run`; treat as a secret. */
  token: string;
}

/** Reserved hostname prefix for laptop tunnels (matched by the zone's lockdown rules). */
export const LAPTOP_HOST_PREFIX = "lt-";

/** Laptops one account may connect at a time. */
export const MAX_TUNNELS_PER_USER = 5;
const API = "https://api.cloudflare.com/client/v4";

export class TunnelLimitError extends Error {}

export class CloudflareApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function tunnelEnv(source: Record<string, string | undefined>): TunnelEnv | null {
  const apiToken = source.CLOUDFLARE_API_TOKEN;
  const accountId = source.CLOUDFLARE_ACCOUNT_ID;
  const zoneId = source.CLOUDFLARE_ZONE_ID;
  const domain = source.REMOTE_TUNNEL_DOMAIN?.toLowerCase();
  if (!apiToken || !accountId || !zoneId || !domain) return null;
  return { apiToken, accountId, zoneId, domain };
}

export function tunnelLabels(secret: string, userId: string, laptopId: string, domain: string) {
  const digest = (input: string) => createHmac("sha256", secret).update(input).digest("hex");
  const user = digest(`user:${userId}`).slice(0, 10);
  const laptop = digest(`laptop:${userId}:${laptopId}`).slice(0, 20);
  const userPrefix = `pipper-${user}-`;
  // One DNS label under the zone: Cloudflare's free certificate covers
  // *.<zone>, not deeper levels. The reserved `lt-` prefix is what the zone's
  // lockdown rules match (`lt-*.<zone>`): API-only, no cookies, inert
  // responses — see docs/remote-access.md. Never use `lt-` for anything else.
  return {
    name: `${userPrefix}${laptop}`,
    hostname: `${LAPTOP_HOST_PREFIX}${laptop}.${domain}`,
    userPrefix,
  };
}

type Fetch = typeof fetch;

async function cf<T>(
  env: TunnelEnv,
  fetchImpl: Fetch,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetchImpl(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.apiToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as {
    success?: boolean;
    result?: T;
    errors?: Array<{ code?: number; message?: string }>;
  } | null;
  if (!res.ok || !json?.success) {
    const detail = json?.errors?.map((e) => `${e.code ?? ""} ${e.message ?? ""}`.trim()).join("; ");
    throw new CloudflareApiError(res.status, `${method} ${path} failed: ${detail || res.status}`);
  }
  return json.result as T;
}

interface TunnelRecord {
  id: string;
  name: string;
}

interface DnsRecord {
  id: string;
  content: string;
  proxied?: boolean;
}

/**
 * Find or create the laptop's tunnel, route its hostname to the laptop's
 * loopback port, make sure DNS points at it, and return a connector token.
 */
export async function provisionLaptopTunnel(
  env: TunnelEnv,
  labels: TunnelLabels,
  port: number,
  fetchImpl: Fetch = fetch,
): Promise<ProvisionedTunnel> {
  const account = `/accounts/${encodeURIComponent(env.accountId)}`;
  const existing = await cf<TunnelRecord[]>(
    env,
    fetchImpl,
    "GET",
    `${account}/cfd_tunnel?is_deleted=false&name=${encodeURIComponent(labels.name)}`,
  );
  let tunnel = existing.find((t) => t.name === labels.name);
  if (!tunnel) {
    const all = await cf<TunnelRecord[]>(
      env,
      fetchImpl,
      "GET",
      `${account}/cfd_tunnel?is_deleted=false&per_page=1000`,
    );
    if (all.filter((t) => t.name.startsWith(labels.userPrefix)).length >= MAX_TUNNELS_PER_USER) {
      throw new TunnelLimitError(
        `This account already has ${MAX_TUNNELS_PER_USER} laptops connected.`,
      );
    }
    // Remotely managed: ingress lives in Cloudflare, so the connector only
    // needs its token and can't be pointed elsewhere by local config.
    tunnel = await cf<TunnelRecord>(env, fetchImpl, "POST", `${account}/cfd_tunnel`, {
      name: labels.name,
      config_src: "cloudflare",
    });
  }

  await cf(env, fetchImpl, "PUT", `${account}/cfd_tunnel/${tunnel.id}/configurations`, {
    config: {
      ingress: [
        { hostname: labels.hostname, service: `http://127.0.0.1:${port}` },
        { service: "http_status:404" },
      ],
    },
  });

  const zone = `/zones/${encodeURIComponent(env.zoneId)}`;
  const target = `${tunnel.id}.cfargotunnel.com`;
  const records = await cf<DnsRecord[]>(
    env,
    fetchImpl,
    "GET",
    `${zone}/dns_records?type=CNAME&name.exact=${encodeURIComponent(labels.hostname)}`,
  );
  const record = records[0];
  const dns = { type: "CNAME", name: labels.hostname, content: target, proxied: true, ttl: 1 };
  if (!record) {
    await cf(env, fetchImpl, "POST", `${zone}/dns_records`, {
      ...dns,
      comment: "Pipper laptop tunnel",
    });
  } else if (record.content !== target || record.proxied === false) {
    await cf(env, fetchImpl, "PATCH", `${zone}/dns_records/${record.id}`, dns);
  }

  const token = await cf<string>(env, fetchImpl, "GET", `${account}/cfd_tunnel/${tunnel.id}/token`);
  return { tunnelId: tunnel.id, hostname: labels.hostname, token };
}
