/**
 * Asks pipper.dev for this laptop's named Cloudflare tunnel. pipper.dev holds
 * the Cloudflare API token; the laptop only ever receives its own connector
 * token, after proving who it is with the laptop credential from sign-in.
 */

export const DEFAULT_PIPPER_API_BASE = "https://www.pipper.dev";

/** Tunnel setup failure. `fatal` ones need the user (sign in, free a slot), so don't retry. */
export class TunnelSetupError extends Error {
  readonly fatal: boolean;
  constructor(message: string, fatal: boolean) {
    super(message);
    this.fatal = fatal;
  }
}

export interface NamedTunnel {
  hostname: string;
  token: string;
}

const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export async function requestNamedTunnel(options: {
  credential: string | null;
  port: number;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}): Promise<NamedTunnel> {
  if (!options.credential) {
    throw new TunnelSetupError("Sign in to Pipper to use the Cloudflare tunnel.", true);
  }
  const base = options.apiBase ?? DEFAULT_PIPPER_API_BASE;
  let res: Response;
  try {
    res = await (options.fetchImpl ?? fetch)(`${base}/api/remote/tunnel`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.credential}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ port: options.port }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new TunnelSetupError(
      `Couldn't reach pipper.dev: ${error instanceof Error ? error.message : String(error)}`,
      false,
    );
  }
  const body = (await res.json().catch(() => null)) as {
    hostname?: unknown;
    token?: unknown;
    error?: unknown;
  } | null;
  if (!res.ok) {
    const message =
      typeof body?.error === "string" ? body.error : `pipper.dev returned ${res.status}`;
    // 401: credential expired/revoked; 409: laptop limit; 503: not set up.
    // Retrying can't fix those. 429/5xx and network errors can.
    throw new TunnelSetupError(
      message,
      res.status === 401 || res.status === 409 || res.status === 503,
    );
  }
  const hostname = typeof body?.hostname === "string" ? body.hostname.toLowerCase() : "";
  const token = typeof body?.token === "string" ? body.token : "";
  if (!HOSTNAME_RE.test(hostname) || !token) {
    throw new TunnelSetupError("pipper.dev returned an invalid tunnel.", false);
  }
  return { hostname, token };
}
