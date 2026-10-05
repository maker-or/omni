import type { APIRoute } from "astro";
import {
  CloudflareApiError,
  TunnelLimitError,
  provisionLaptopTunnel,
  tunnelEnv,
  tunnelLabels,
} from "../../../lib/cloudflare-tunnels";
import { laptopCredentialSecret, verifyLaptopCredential } from "../../../lib/desktop-auth";

export const prerender = false;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    // The response carries a connector token: never cache it anywhere.
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function env(key: string): string | undefined {
  return (import.meta.env[key] as string | undefined) || process.env[key];
}

/**
 * POST /api/remote/tunnel — the signed-in laptop asks for its named tunnel.
 * Auth: `Authorization: Bearer <laptop credential>` from desktop sign-in.
 * Body: { port } — the laptop's loopback port for the remote server.
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = laptopCredentialSecret(env("PIPPER_LAPTOP_CREDENTIAL_SECRET"));
  const config = tunnelEnv({
    CLOUDFLARE_API_TOKEN: env("CLOUDFLARE_API_TOKEN"),
    CLOUDFLARE_ACCOUNT_ID: env("CLOUDFLARE_ACCOUNT_ID"),
    CLOUDFLARE_ZONE_ID: env("CLOUDFLARE_ZONE_ID"),
    REMOTE_TUNNEL_DOMAIN: env("REMOTE_TUNNEL_DOMAIN"),
  });
  if (!secret || !config) {
    console.error("[remote-tunnel] missing server configuration");
    return json(503, { error: "Remote tunnels are not available right now." });
  }

  const header = request.headers.get("authorization") ?? "";
  const credential = /^Bearer (\S+)$/.exec(header)?.[1] ?? "";
  const claims = credential ? verifyLaptopCredential(credential, secret) : null;
  if (!claims) return json(401, { error: "Sign in to Pipper again on this laptop." });

  let port: unknown;
  try {
    port = ((await request.json()) as { port?: unknown }).port;
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1024 || port > 65535) {
    return json(400, { error: "port must be an integer between 1024 and 65535" });
  }

  try {
    const labels = tunnelLabels(secret, claims.sub, claims.lid, config.domain);
    const tunnel = await provisionLaptopTunnel(config, labels, port);
    return json(200, { hostname: tunnel.hostname, token: tunnel.token });
  } catch (error) {
    if (error instanceof TunnelLimitError) return json(409, { error: error.message });
    // Details (which may name account resources) stay in the server log.
    console.error("[remote-tunnel] provisioning failed:", error);
    const status = error instanceof CloudflareApiError && error.status === 429 ? 429 : 502;
    return json(status, { error: "Couldn't set up the tunnel. Try again shortly." });
  }
};
