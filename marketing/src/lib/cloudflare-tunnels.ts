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

/**
 * Laptop tunnels one account may hold. Offline ones are reclaimed to make
 * room (see reclaimSlot), so this caps laptops *online* at the same time.
 */
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

interface CfEnvelope<T> {
  success?: boolean;
  result?: T;
  result_info?: { page?: number; per_page?: number; count?: number; total_count?: number };
  errors?: Array<{ code?: number; message?: string }>;
}

async function cfRaw<T>(
  env: TunnelEnv,
  fetchImpl: Fetch,
  method: string,
  path: string,
  body?: unknown,
): Promise<CfEnvelope<T>> {
  const res = await fetchImpl(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.apiToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as CfEnvelope<T> | null;
  if (!res.ok || !json?.success) {
    const detail = json?.errors?.map((e) => `${e.code ?? ""} ${e.message ?? ""}`.trim()).join("; ");
    throw new CloudflareApiError(res.status, `${method} ${path} failed: ${detail || res.status}`);
  }
  return json;
}

async function cf<T>(
  env: TunnelEnv,
  fetchImpl: Fetch,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return (await cfRaw<T>(env, fetchImpl, method, path, body)).result as T;
}

/** Every live tunnel in the account, across pages (the first 1,000 isn't all). */
async function listAllTunnels(env: TunnelEnv, fetchImpl: Fetch, account: string) {
  const perPage = 1000;
  const all: TunnelRecord[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await cfRaw<TunnelRecord[]>(
      env,
      fetchImpl,
      "GET",
      `${account}/cfd_tunnel?is_deleted=false&per_page=${perPage}&page=${page}`,
    );
    const batch = res.result ?? [];
    all.push(...batch);
    const total = res.result_info?.total_count;
    if (batch.length < perPage || (total !== undefined && all.length >= total)) break;
  }
  return all;
}

/** When a tunnel last had connections (or was made, if it never ran). */
function lastActive(tunnel: TunnelRecord): number {
  const at = tunnel.conns_inactive_at ?? tunnel.conns_active_at ?? tunnel.created_at;
  const time = at ? Date.parse(at) : 0;
  return Number.isFinite(time) ? time : 0;
}

/**
 * Make room for one more laptop under the per-account cap by deleting this
 * user's longest-offline tunnels (and their DNS records). Without this, a
 * reinstall or data reset — which mints a new laptop id — leaves its old
 * tunnel holding a slot forever, and after a few the account is locked out.
 * Only tunnels with no connections ("inactive"/"down") are eligible, which
 * is also all Cloudflare allows deleting. An evicted laptop that comes back
 * just re-provisions: its tunnel name and hostname are deterministic.
 */
async function reclaimSlot(
  env: TunnelEnv,
  fetchImpl: Fetch,
  account: string,
  labels: TunnelLabels,
): Promise<void> {
  const mine = (await listAllTunnels(env, fetchImpl, account)).filter((t) =>
    t.name.startsWith(labels.userPrefix),
  );
  let excess = mine.length - (MAX_TUNNELS_PER_USER - 1);
  if (excess <= 0) return;
  const offline = mine
    .filter((t) => t.status === "inactive" || t.status === "down")
    .sort((a, b) => lastActive(a) - lastActive(b));
  const zone = `/zones/${encodeURIComponent(env.zoneId)}`;
  for (const tunnel of offline) {
    if (excess <= 0) break;
    const hostname = `${LAPTOP_HOST_PREFIX}${tunnel.name.slice(labels.userPrefix.length)}.${env.domain}`;
    const records = await cf<DnsRecord[]>(
      env,
      fetchImpl,
      "GET",
      `${zone}/dns_records?type=CNAME&name.exact=${encodeURIComponent(hostname)}`,
    );
    for (const record of records) {
      if (record.content === `${tunnel.id}.cfargotunnel.com`) {
        await cf(env, fetchImpl, "DELETE", `${zone}/dns_records/${record.id}`);
      }
    }
    await cf(env, fetchImpl, "DELETE", `${account}/cfd_tunnel/${tunnel.id}`);
    excess -= 1;
  }
  if (excess > 0) {
    throw new TunnelLimitError(
      `This account already has ${MAX_TUNNELS_PER_USER} laptops online. Turn one off and try again.`,
    );
  }
}

interface TunnelRecord {
  id: string;
  name: string;
  /** "inactive" (never ran), "healthy", "degraded", or "down" (no connections). */
  status?: string;
  created_at?: string;
  conns_active_at?: string | null;
  conns_inactive_at?: string | null;
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
    await reclaimSlot(env, fetchImpl, account, labels);
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
