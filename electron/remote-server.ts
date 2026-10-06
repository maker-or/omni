import http from "node:http";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { hostname as osHostname, networkInterfaces } from "node:os";
import { extname, join } from "node:path";
import type { AgentManager } from "./agent-connection-manager.ts";
import { listProjects, getProject } from "./projects.ts";
import { listRegisteredAgents } from "./agents/registry.ts";
import { buildSiriCatalog } from "./siri/siri-catalog.ts";
import { listAgentInstanceDescriptors } from "./agent-instances.ts";
import { getThread, listThreads } from "./threads.ts";
import { prepareIsolatedAgentTask } from "./isolated-agent-task.ts";
import {
  RemoteRequestError,
  RemoteTaskError,
  type RemoteRequestReceipt,
  type RemoteRequests,
  getRemoteRequests,
} from "./remote-requests.ts";
import { gitBinary, isLiveWorktree } from "./worktree-manager.ts";
import type {
  RemoteAgentModel,
  RemoteDevice,
  RemoteDevicesState,
  RemoteModel,
  RemoteLaptopIdentity,
  RemotePairingOffer,
  RemotePairPreviewResponse,
  RemotePairResponse,
  RemoteProject,
  RemoteReport,
  RemoteScope,
  RemoteThreadSummary,
} from "../contracts/remote.ts";
import type { RemoteDeviceStore } from "./remote-devices.ts";
import { PairingCodes, formatPairingCode } from "./remote-pairing.ts";
import { MAX_PROMPT_IMAGES, MAX_PROMPT_IMAGE_BYTES } from "../contracts/prompt-images.ts";
import {
  BASE_SECURITY_HEADERS,
  HttpError,
  REMOTE_PAGE_CSP,
  WindowLimiter,
  bearerToken,
  clientKey,
  base64Length,
  parseJsonObject,
  parsePromptImages,
  readBody,
  resolveWithin,
  sanitizeLogText,
} from "./remote-security.ts";

const execFileAsync = promisify(execFile);

export interface RemoteServerDeps {
  agentManager: () => AgentManager | null;
  getUserDataPath: () => string;
  getRendererDir: () => string;
  /** Paired devices; the only credentials the API accepts. */
  devices: RemoteDeviceStore;
  onRemoteActiveChanged?: (active: boolean) => void;
  /** A device was paired or revoked, or the pairing offer changed. */
  onDevicesChanged?: (state: RemoteDevicesState) => void;
  /**
   * Base URL phones should open (e.g. the tunnel's https URL). Defaults to
   * http://<tailnet host>:<port> when a Tailscale address is bound.
   */
  getPublicBaseUrl?: () => string | null;
  /**
   * Origins of the hosted phone app allowed to call the API cross-origin
   * (e.g. https://remote.pipper.dev). Requests carry a bearer token, never
   * cookies, so CORS here only decides which site's script may read replies.
   */
  getAllowedOrigins?: () => readonly string[];
  /**
   * Pairing link for a code. Defaults to <public URL>/remote#pair=CODE (the
   * laptop serves the phone app); overridden when a hosted app pairs with
   * this laptop by hostname instead.
   */
  buildPairingUrl?: (code: string) => string | null;
  /** pipper.dev's signed owner statement for this laptop's host, if any. */
  getLaptopAttestation?: () => string | null;
  /** Tailscale addresses to serve (tests); defaults to 100.x interfaces. */
  listTailscaleIps?: () => string[];
}

interface RouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  params: string[];
  device: RemoteDevice;
  am: AgentManager | null;
}

interface Route {
  method: "GET" | "POST" | "DELETE";
  pattern: RegExp;
  /** Scope the calling device must hold. */
  scope: RemoteScope;
  handle: (ctx: RouteContext) => Promise<void> | void;
}

function send(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  contentType = "application/json",
  headers: Record<string, string> = {},
): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { ...BASE_SECURITY_HEADERS, "Content-Type": contentType, ...headers });
  res.end(text);
}

/** API payloads (paths, transcripts) must never sit in a browser/proxy cache. */
function sendApi(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  send(res, status, body, "application/json", { "Cache-Control": "no-store", ...headers });
}

/**
 * Pre-device-pairing builds kept one shared bearer token here. Nothing reads
 * it any more; delete it so a stale credential isn't left on disk.
 */
function removeLegacySharedToken(userDataPath: string): void {
  try {
    rmSync(join(userDataPath, "remote-token.txt"), { force: true });
  } catch {
    // best effort
  }
}

/**
 * The phone's idempotency key. Phone apps older than request receipts send
 * none; give those a one-off id so they still work, just without retry dedup.
 */
function requestIdFrom(body: Record<string, unknown>): unknown {
  return body.requestId ?? `legacy-${randomUUID()}`;
}

async function filesTouched(cwd: string | null): Promise<string[]> {
  if (!cwd || !existsSync(cwd)) return [];
  try {
    const { stdout } = await execFileAsync(gitBinary(), ["status", "--porcelain=v1", "-z"], {
      cwd,
      maxBuffer: 1024 * 1024,
    });
    // -z: NUL-delimited records; rename/copy records carry the source path as
    // a second bare field (no XY prefix) right after the destination record.
    const out: string[] = [];
    const fields = String(stdout).split("\0");
    for (let i = 0; i < fields.length && out.length < 50; i++) {
      const field = fields[i] ?? "";
      if (!field) continue;
      const code = field.slice(0, 2);
      const path = field.slice(3);
      if (!path) continue;
      out.push(path);
      if (code.includes("R") || code.includes("C")) i++; // skip paired source path
    }
    return out;
  } catch {
    return [];
  }
}

/** True for loopback or Tailscale (100.64/10) hosts — the only cleartext-safe binds. */
function isTrustedRemoteHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "[::1]" ||
    /^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(h)
  );
}

/** How long after the last authed phone request an idle phone keeps standby. */
const REMOTE_LEASE_MS = 10 * 60_000;
const STATIC_TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
};
/** Pairing requests carry a code and a device name. */
const MAX_PAIR_BODY_BYTES = 4_096;
/** Largest accepted body for small requests (phone log lines). */
const MAX_BODY_BYTES = 512_000;
/** Prompt bodies may carry the full image allowance, base64-encoded. */
const MAX_PROMPT_BODY_BYTES =
  MAX_PROMPT_IMAGES * base64Length(MAX_PROMPT_IMAGE_BYTES) + MAX_BODY_BYTES;
/** Headers must arrive fast; bodies get long enough for a slow mobile upload. */
const HEADERS_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 120_000;

/** Building model catalogs spawns every selected agent and probes sessions,
 * so the phone shares one recent result instead of re-probing per request. */
const AGENT_MODELS_TTL_MS = 5 * 60_000;

export class RemoteServer {
  private servers: http.Server[] = [];
  /** Hosts with a live listener — the only ones safe to advertise. */
  private readonly boundHosts = new Map<http.Server, string>();
  /** Failed auth per client; valid tokens are never refused by it. */
  private readonly authFailures = new WindowLimiter({ limit: 10, windowMs: 60_000 });
  /**
   * New tasks and follow-ups each start an agent turn (new tasks also create
   * a worktree). Generous for a person typing on a phone; stops a runaway or
   * scripted client from spawning work without bound.
   */
  private readonly taskStarts = new WindowLimiter({ limit: 60, windowMs: 60_000 });
  private readonly pairing = new PairingCodes();
  readonly port: number;
  private readonly deps: RemoteServerDeps;
  private readonly requests: RemoteRequests;
  private agentModels: {
    at: number;
    value: Promise<Record<string, RemoteAgentModel[]>>;
  } | null = null;
  private readonly routes: Route[];
  private lastAuthedAt = 0;
  /** Set by start(): loopback-only means the public path is a tunnel. */
  private behindTunnel = false;
  /** Set by start(): serve only /api/remote/* (the phone app is hosted elsewhere). */
  private apiOnly = false;
  private lastBindError: string | null = null;
  /** Every listener, bound or still binding, with its host. */
  private readonly serverHosts = new Map<http.Server, string>();
  private started = false;

  constructor(deps: RemoteServerDeps, opts?: { port?: number }) {
    this.deps = deps;
    this.requests = getRemoteRequests(join(deps.getUserDataPath(), "remote-requests"));
    this.port = opts?.port ?? Number(process.env.PIPPER_REMOTE_PORT ?? 4173);
    this.routes = this.buildRoutes();
    removeLegacySharedToken(deps.getUserDataPath());
  }

  /**
   * Offer a one-time code for pairing a new device. Replaces any code still
   * pending; the phone redeems it via POST /api/remote/pair.
   */
  createPairingOffer(scopes: RemoteScope[]): RemotePairingOffer {
    this.pairing.create(scopes);
    const state = this.getDevicesState();
    this.deps.onDevicesChanged?.(state);
    return state.offer!;
  }

  cancelPairingOffer(): void {
    this.pairing.cancel();
    this.deps.onDevicesChanged?.(this.getDevicesState());
  }

  getDevicesState(): RemoteDevicesState {
    const live = this.pairing.active();
    const base = this.publicBaseUrl();
    return {
      devices: this.deps.devices.list(),
      offer: live
        ? {
            code: formatPairingCode(live.code),
            // The code rides in the fragment, which browsers never send to
            // the server (or to any proxy in front of it).
            pairingUrl: this.deps.buildPairingUrl
              ? this.deps.buildPairingUrl(live.code)
              : base
                ? `${base}/remote#pair=${live.code}`
                : null,
            expiresAt: live.expiresAt,
            scopes: live.scopes,
          }
        : null,
    };
  }

  private allowedOrigin(origin: string | undefined): string | null {
    if (!origin) return null;
    return (this.deps.getAllowedOrigins?.() ?? []).includes(origin) ? origin : null;
  }

  /** Push the current devices/offer state, e.g. after the public URL changed. */
  emitDevicesChanged(): void {
    this.deps.onDevicesChanged?.(this.getDevicesState());
  }

  /** Where phones reach this server, or null when nothing is reachable. */
  publicBaseUrl(): string | null {
    if (this.deps.getPublicBaseUrl) return this.deps.getPublicBaseUrl();
    const host = this.getAdvertisedHost();
    return host ? `http://${host}:${this.port}` : null;
  }

  /** Revoke a paired device; its token stops working immediately. */
  revokeDevice(id: string): boolean {
    const removed = this.deps.devices.revoke(id);
    if (removed) this.deps.onDevicesChanged?.(this.getDevicesState());
    return removed;
  }

  /** Local + Tailscale IPv4s for the terminal QR / log line. */
  getLanIps(): string[] {
    const ips = new Set<string>();
    for (const list of Object.values(networkInterfaces())) {
      for (const nic of list ?? []) {
        if (nic.family === "IPv4" && !nic.internal) ips.add(nic.address);
      }
    }
    return [...ips];
  }

  /** Tailscale IPv4s (100.x) — the only non-loopback interfaces we serve. */
  getTailscaleIps(): string[] {
    if (this.deps.listTailscaleIps) return this.deps.listTailscaleIps();
    return this.getLanIps().filter((ip) => ip.startsWith("100."));
  }

  /**
   * Address safe to advertise in QR/Settings: only a host with a live
   * listener. Tailscale addresses are bound once at start(), so an interface
   * that appears later is not advertised until the server restarts. Null
   * when no advertisable host is bound — callers must show "unavailable".
   */
  getAdvertisedHost(): string | null {
    // Behind a tunnel only loopback is bound; the tunnel URL is the address.
    if (this.behindTunnel) return null;
    const bound = [...this.boundHosts.values()];
    const override = process.env.PIPPER_REMOTE_HOST?.trim();
    if (override) return bound.includes(override) ? override : null;
    return bound.find((host) => host.startsWith("100.")) ?? null;
  }

  /** Last time an authed phone request arrived (0 = never). Drives standby. */
  getLastAuthedAt(): number {
    return this.lastAuthedAt;
  }

  /** True when an idle paired phone should still keep the laptop awake. */
  hasLiveLease(now = Date.now()): boolean {
    return this.lastAuthedAt > 0 && now - this.lastAuthedAt < REMOTE_LEASE_MS;
  }

  /**
   * Bind listeners; resolves once every bind has succeeded or failed.
   * `loopbackOnly` is for tunnel mode: the connector reaches us on 127.0.0.1
   * and nothing else on the network can.
   */
  async start(options: { loopbackOnly?: boolean; apiOnly?: boolean } = {}): Promise<void> {
    if (this.servers.length > 0) return;
    this.lastBindError = null;
    this.behindTunnel = options.loopbackOnly === true;
    this.apiOnly = options.apiOnly === true;
    this.started = true;
    await Promise.all(this.desiredHosts().map((host) => this.bind(host)));
  }

  /**
   * Hosts to listen on. Threat model: plain HTTP is intentional here.
   * Listeners bind loopback + Tailscale only, so bearer credentials traverse
   * either localhost or the WireGuard-encrypted tailnet — never LAN/Wi-Fi in
   * cleartext. TLS would add self-signed cert friction on the phone with no
   * transport gain. A PIPPER_REMOTE_HOST override is honored only for
   * loopback/Tailscale — a LAN address would leak the bearer token +
   * transcripts in cleartext. Behind a tunnel, loopback only.
   */
  private desiredHosts(): string[] {
    if (this.behindTunnel) return ["127.0.0.1"];
    const override = process.env.PIPPER_REMOTE_HOST?.trim();
    if (override && isTrustedRemoteHost(override)) return [override];
    if (override) console.warn(`[Remote] ignoring untrusted PIPPER_REMOTE_HOST=${override}`);
    return [...new Set(["127.0.0.1", ...this.getTailscaleIps()])];
  }

  /** Listen on one host; resolves once bound or failed (a failure is recorded, not thrown). */
  private bind(host: string): Promise<void> {
    const server = http.createServer((req, res) => void this.handle(req, res));
    server.headersTimeout = HEADERS_TIMEOUT_MS;
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    this.servers.push(server);
    this.serverHosts.set(server, host);
    return new Promise<void>((resolve) => {
      // A failed bind (port taken, interface gone) must not poison start():
      // drop it so a later start()/refreshBindings() can retry.
      server.once("error", (err) => {
        console.error(`[Remote] listen failed on ${host}:${this.port}:`, err);
        this.lastBindError =
          (err as NodeJS.ErrnoException).code === "EADDRINUSE"
            ? `Port ${this.port} is already in use — is another copy of Pipper running? Quit it, or set PIPPER_REMOTE_PORT.`
            : `Couldn't listen on ${host}:${this.port} (${(err as NodeJS.ErrnoException).code ?? err.message}).`;
        this.servers = this.servers.filter((s) => s !== server);
        this.serverHosts.delete(server);
        this.boundHosts.delete(server);
        resolve();
      });
      server.listen(this.port, host, () => {
        this.boundHosts.set(server, host);
        console.log(`[Remote] PWA server on http://${host}:${this.port}/remote`);
        resolve();
      });
    });
  }

  /**
   * Re-match listeners to the current interfaces after start(): Pipper often
   * launches before Tailscale connects, and a tailnet address can change.
   * Binds new addresses and closes ones that disappeared (never loopback).
   * Resolves true when the set of listeners changed.
   */
  async refreshBindings(): Promise<boolean> {
    if (!this.started || this.behindTunnel) return false;
    const desired = new Set(this.desiredHosts());
    const current = new Set(this.serverHosts.values());
    const added = [...desired].filter((host) => !current.has(host));
    const gone = [...this.serverHosts].filter(
      ([, host]) => host !== "127.0.0.1" && !desired.has(host),
    );
    for (const [server] of gone) {
      this.servers = this.servers.filter((s) => s !== server);
      this.serverHosts.delete(server);
      this.boundHosts.delete(server);
      server.close();
      server.closeAllConnections();
    }
    const before = this.boundHosts.size;
    await Promise.all(added.map((host) => this.bind(host)));
    return gone.length > 0 || this.boundHosts.size !== before;
  }

  stop(): Promise<void> {
    this.started = false;
    const closing = this.servers.splice(0);
    this.boundHosts.clear();
    this.serverHosts.clear();
    return Promise.all(
      closing.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
          }),
      ),
    ).then(() => undefined);
  }

  /** Why the last start() couldn't serve, for Settings; null when it bound. */
  bindError(): string | null {
    return this.isServing() ? null : this.lastBindError;
  }

  /** True when at least one listener is bound. Meaningful after start() resolves. */
  isServing(): boolean {
    return this.boundHosts.size > 0;
  }

  private assertTaskAllowance(): void {
    const wait = this.taskStarts.retryAfterSec("tasks");
    if (wait > 0) throw new HttpError(429, "Too many tasks", { "Retry-After": String(wait) });
  }

  private consumeTaskAllowance(): void {
    const wait = this.taskStarts.consume("tasks");
    if (wait > 0) throw new HttpError(429, "Too many tasks", { "Retry-After": String(wait) });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      await this.route(req, res);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof RemoteRequestError) {
        sendApi(res, error.status, { error: error.message });
        return;
      }
      if (error instanceof HttpError) {
        // An unread (oversize/aborted) body leaves the socket mid-request;
        // close it after the response instead of reusing it.
        sendApi(
          res,
          error.status,
          { error: error.message },
          {
            Connection: "close",
            ...error.headers,
          },
        );
        return;
      }
      // Details stay in the laptop log; the client only learns that it failed.
      console.error(`[Remote] ${req.method} ${req.url} failed:`, error);
      sendApi(res, 500, { error: "Internal error" });
    }
  }

  private async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    // HEAD (link previews, uptime checks) gets the same headers as GET; Node
    // drops the body for HEAD responses on its own.
    const readOnly = req.method === "GET" || req.method === "HEAD";
    const isApi = path.startsWith("/api/remote/");

    if (isApi) {
      // Set before any writeHead so every API reply — errors included — is
      // readable by the hosted phone app (it must see a 401 to unpair).
      const origin = this.allowedOrigin(req.headers.origin);
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Expose-Headers", "Retry-After");
        res.setHeader("Vary", "Origin");
      }
      if (req.method === "OPTIONS") {
        res.writeHead(origin ? 204 : 403, {
          ...BASE_SECURITY_HEADERS,
          ...(origin
            ? {
                "Access-Control-Allow-Methods": "GET, POST, DELETE",
                "Access-Control-Allow-Headers": "Authorization, Content-Type",
                "Access-Control-Max-Age": "600",
              }
            : {}),
        });
        res.end();
        return;
      }
    } else if (this.apiOnly) {
      // The phone app is served by its own trusted site; this host is API-only.
      send(res, 404, { error: "Not found" });
      return;
    }

    // Serve the PWA shell without auth so "Add to Home Screen" works; the
    // app stores its device token after pairing and sends it per request.
    if (readOnly && (path === "/remote" || path === "/remote/")) {
      return this.serveFile(res, "remote.html", "text/html", {
        "Content-Security-Policy": REMOTE_PAGE_CSP,
        "Cache-Control": "no-cache",
      });
    }
    // Built remote.html references ./assets/* (resolves to /assets/*).
    if (
      readOnly &&
      (path.startsWith("/assets/") ||
        path.startsWith("/remote-assets/") ||
        path === "/favicon.svg" ||
        path === "/icon.png")
    ) {
      return this.serveFile(res, path.slice(1), undefined);
    }
    // Installability metadata for "Add to Home Screen". No service worker:
    // plain HTTP on a tailnet IP is not a secure context, so a worker could
    // never activate — the manifest alone gives the standalone shell.
    if (readOnly && path === "/remote-manifest.json") {
      return send(res, 200, {
        name: "Omni Remote",
        short_name: "Omni",
        start_url: "/remote",
        scope: "/",
        display: "standalone",
        background_color: "#171717",
        theme_color: "#171717",
        icons: [
          { src: "/icon.png", sizes: "512x512", type: "image/png" },
          { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      });
    }
    if (!isApi) {
      send(res, 404, { error: "Not found" });
      return;
    }
    if (req.method === "POST" && path === "/api/remote/pair") {
      return this.pair(req, res);
    }
    if (req.method === "POST" && path === "/api/remote/pair/preview") {
      return this.pairPreview(req, res);
    }
    // Everything else under /api/remote/ needs a paired device's token —
    // including health and the phone's debug log, which would otherwise let
    // anyone who can reach the port confirm a live laptop or write its log.
    const client = clientKey(req, this.behindTunnel);
    const device = this.deps.devices.authenticate(bearerToken(req.headers.authorization));
    if (!device) {
      // Valid tokens are never refused by this limiter, so a flood of bad
      // guesses (all sharing 127.0.0.1 behind a tunnel) cannot lock out a
      // paired phone. 256-bit tokens make guessing infeasible; the limit
      // bounds how much work unauthenticated clients can cause.
      const wait = this.authFailures.retryAfterSec(client);
      if (wait > 0) {
        sendApi(res, 429, { error: "Too many attempts" }, { "Retry-After": String(wait) });
        return;
      }
      this.authFailures.record(client);
      sendApi(res, 401, { error: "Unauthorized" });
      return;
    }
    // Any authed call proves a live paired phone — renews the standby lease
    // so an idle phone keeps the laptop awake between tasks.
    this.lastAuthedAt = Date.now();
    this.deps.onRemoteActiveChanged?.(true);

    for (const route of this.routes) {
      const match = route.pattern.exec(path);
      if (!match || route.method !== req.method) continue;
      if (!device.scopes.includes(route.scope)) {
        sendApi(res, 403, {
          error:
            route.scope === "run"
              ? "This device is read-only. Pair it again with task access to start work."
              : "This device is not allowed to do that.",
        });
        return;
      }
      await route.handle({
        req,
        res,
        params: match.slice(1),
        device,
        am: this.deps.agentManager(),
      });
      return;
    }
    sendApi(res, 404, { error: "Not found" });
  }

  /** How this laptop introduces itself to a phone that is about to pair. */
  laptopIdentity(): RemoteLaptopIdentity {
    const base = this.publicBaseUrl();
    return {
      name: sanitizeLogText(osHostname().replace(/\.local$/i, ""), 60) || "Laptop",
      host: base ? new URL(base).host : null,
      attestation: this.deps.getLaptopAttestation?.() ?? null,
    };
  }

  /**
   * Describe this laptop to a phone holding a valid code, without using the
   * code up, so the phone can show who it is about to pair with and ask the
   * user first. Requires the code so an owner's identity isn't public.
   */
  private async pairPreview(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const client = clientKey(req, this.behindTunnel);
    const wait = this.authFailures.retryAfterSec(client);
    if (wait > 0) {
      sendApi(res, 429, { error: "Too many attempts" }, { "Retry-After": String(wait) });
      return;
    }
    const body = parseJsonObject(await readBody(req, MAX_PAIR_BODY_BYTES));
    if (!this.pairing.check(typeof body.code === "string" ? body.code : "")) {
      this.authFailures.record(client);
      this.deps.onDevicesChanged?.(this.getDevicesState());
      sendApi(res, 401, { error: "Invalid or expired pairing code" });
      return;
    }
    const response: RemotePairPreviewResponse = { laptop: this.laptopIdentity() };
    sendApi(res, 200, response);
  }

  /** Redeem a pairing code for a new device token. */
  private async pair(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const client = clientKey(req, this.behindTunnel);
    const wait = this.authFailures.retryAfterSec(client);
    if (wait > 0) {
      sendApi(res, 429, { error: "Too many attempts" }, { "Retry-After": String(wait) });
      return;
    }
    const body = parseJsonObject(await readBody(req, MAX_PAIR_BODY_BYTES));
    const scopes = this.pairing.redeem(typeof body.code === "string" ? body.code : "");
    if (!scopes) {
      this.authFailures.record(client);
      // The offer may have been discarded after too many wrong guesses.
      this.deps.onDevicesChanged?.(this.getDevicesState());
      sendApi(res, 401, { error: "Invalid or expired pairing code" });
      return;
    }
    const { device, token } = this.deps.devices.create({
      name: typeof body.deviceName === "string" ? body.deviceName : undefined,
      scopes,
    });
    console.log(`[Remote] paired device ${device.id} scopes=${device.scopes.join(",")}`);
    this.deps.onDevicesChanged?.(this.getDevicesState());
    const response: RemotePairResponse = { token, device, laptop: this.laptopIdentity() };
    sendApi(res, 201, response);
  }

  private buildRoutes(): Route[] {
    return [
      {
        method: "GET",
        pattern: /^\/api\/remote\/health$/,
        scope: "read",
        handle: ({ res }) => sendApi(res, 200, { ok: true }),
      },
      {
        method: "GET",
        pattern: /^\/api\/remote\/session$/,
        scope: "read",
        handle: ({ res, device }) => sendApi(res, 200, { device }),
      },
      {
        // The phone's "Unpair" also revokes it here, not just locally.
        method: "DELETE",
        pattern: /^\/api\/remote\/session$/,
        scope: "read",
        handle: ({ res, device }) => {
          this.revokeDevice(device.id);
          sendApi(res, 200, { ok: true });
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/remote\/debug-log$/,
        scope: "read",
        handle: async ({ req, res, device }) => {
          const body = await readBody(req, MAX_BODY_BYTES);
          console.log(`[Remote phone ${device.id}] ${sanitizeLogText(body)}`);
          sendApi(res, 200, { ok: true });
        },
      },
      {
        method: "GET",
        pattern: /^\/api\/remote\/projects$/,
        scope: "read",
        handle: ({ res }) => {
          const projects: RemoteProject[] = listProjects().map((p) => ({
            id: p.id,
            name: p.name,
            path: p.path,
          }));
          sendApi(res, 200, { projects });
        },
      },
      {
        method: "GET",
        pattern: /^\/api\/remote\/models$/,
        scope: "read",
        handle: ({ res }) => {
          // Offer provider instances (accounts), not just drivers, so a phone
          // can route a task to a specific account. Default instances reuse
          // the driver id, so single-account setups see exactly the same
          // list. `provider` groups accounts under their driver on the phone.
          const driverNames = new Map(
            listRegisteredAgents().map((driver) => [driver.id, driver.displayName ?? driver.name]),
          );
          const models: RemoteModel[] = listAgentInstanceDescriptors().map((a) => ({
            id: a.id,
            name: a.displayName ?? a.name ?? a.id,
            provider: driverNames.get(a.driverId ?? a.id) ?? a.driverId ?? a.id,
          }));
          sendApi(res, 200, { models });
        },
      },
      {
        // Models *inside* each agent instance (the ACP model option), keyed by
        // the same instance ids `/models` returns.
        method: "GET",
        pattern: /^\/api\/remote\/agent-models$/,
        scope: "read",
        handle: async ({ res, am }) => {
          if (!am) return sendApi(res, 503, { error: "Agent not ready" });
          sendApi(res, 200, { models: await this.loadAgentModels(am) });
        },
      },
      {
        // Same shape as siri-catalog.json on the laptop, so the iOS app's
        // Siri intents resolve projects/agents against an identical catalog
        // (selected agents only, with availability) without a network hop.
        method: "GET",
        pattern: /^\/api\/remote\/catalog$/,
        scope: "read",
        handle: ({ res }) => sendApi(res, 200, buildSiriCatalog()),
      },
      {
        method: "GET",
        pattern: /^\/api\/remote\/diagnostics$/,
        scope: "read",
        handle: ({ res, am }) => {
          const catalog = buildSiriCatalog();
          sendApi(res, 200, {
            paired: true,
            agentReady: am != null,
            availableAgents: catalog.agents.filter((a) => a.available).length,
            projects: catalog.projects.length,
          });
        },
      },
      {
        method: "GET",
        pattern: /^\/api\/remote\/threads$/,
        scope: "read",
        handle: ({ res, am }) => {
          const running = new Set(am?.getRunningThreadIds() ?? []);
          const summaries: RemoteThreadSummary[] = listThreads()
            .slice(0, 50)
            .map((t) => ({
              id: t.id,
              projectId: t.project_id,
              worktreePath: t.worktree_path ?? null,
              title: t.title,
              running: running.has(t.id),
              lastUsedAt: t.last_used_at,
            }));
          this.deps.onRemoteActiveChanged?.(running.size > 0 || this.hasLiveLease());
          sendApi(res, 200, { threads: summaries });
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/remote\/threads$/,
        scope: "run",
        handle: (ctx) => this.createTask(ctx),
      },
      {
        method: "GET",
        pattern: /^\/api\/remote\/requests\/([A-Za-z0-9-]{1,128})$/,
        scope: "read",
        handle: ({ res, params }) => {
          const receipt = this.requests.get(params[0]!);
          if (!receipt) return sendApi(res, 404, { error: "Request not found" });
          sendApi(res, 200, { request: this.requests.status(receipt) });
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/remote\/threads\/([^/]+)\/prompt$/,
        scope: "run",
        handle: (ctx) => this.sendFollowUp(ctx),
      },
      {
        method: "POST",
        pattern: /^\/api\/remote\/threads\/([^/]+)\/model$/,
        scope: "run",
        handle: async ({ req, res, params, am }) => {
          if (!am) return sendApi(res, 503, { error: "Agent not ready" });
          const threadId = params[0]!;
          if (!getThread(threadId)) return sendApi(res, 404, { error: "Thread not found" });
          const body = parseJsonObject(await readBody(req, MAX_BODY_BYTES));
          if (typeof body.model !== "string" || !body.model) {
            return sendApi(res, 400, { error: "model is required" });
          }
          const current = am.getThreadModel(threadId);
          if (!current) {
            return sendApi(res, 409, {
              error:
                "This thread can't change models right now. Open it on your Mac and try again.",
            });
          }
          if (!current.options.some((o) => o.id === body.model)) {
            return sendApi(res, 400, { error: "That model isn't offered by this thread's agent." });
          }
          await am.setThreadConfigOption(threadId, current.configId, body.model);
          const next = am.getThreadModel(threadId);
          sendApi(res, 200, {
            model: next ? { current: next.current, options: next.options } : null,
          });
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/remote\/threads\/([^/]+)\/stop$/,
        scope: "run",
        handle: async ({ res, params, am }) => {
          if (!am) return sendApi(res, 503, { error: "Agent not ready" });
          const threadId = params[0]!;
          if (!getThread(threadId)) return sendApi(res, 404, { error: "Thread not found" });
          await am.abortThread(threadId);
          sendApi(res, 200, { ok: true });
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/remote\/threads\/([^/]+)\/permission$/,
        scope: "run",
        handle: async ({ req, res, params, am }) => {
          if (!am) return sendApi(res, 503, { error: "Agent not ready" });
          const threadId = params[0]!;
          if (!getThread(threadId)) return sendApi(res, 404, { error: "Thread not found" });
          const body = parseJsonObject(await readBody(req, MAX_BODY_BYTES));
          if (
            typeof body.decisionId !== "string" ||
            (body.optionId != null && typeof body.optionId !== "string") ||
            (body.cancelled != null && typeof body.cancelled !== "boolean")
          ) {
            return sendApi(res, 400, { error: "A valid decision and option are required" });
          }
          const answered = await am.respondToRemotePermission(
            threadId,
            body.decisionId,
            (body.optionId as string | null | undefined) ?? undefined,
            body.cancelled === true,
          );
          if (!answered) {
            return sendApi(res, 409, {
              error: "This decision expired or was already answered. Refresh the thread.",
            });
          }
          sendApi(res, 200, { ok: true });
        },
      },
      {
        method: "GET",
        pattern: /^\/api\/remote\/threads\/([^/]+)\/report$/,
        scope: "read",
        handle: async ({ res, params, am }) => {
          const thread = getThread(params[0]!);
          if (!thread) return sendApi(res, 404, { error: "Thread not found" });
          const running = (am?.getRunningThreadIds() ?? []).includes(thread.id);
          const cwd = thread.worktree_path ?? getProject(thread.project_id)?.path ?? null;
          const transcript = am?.getThreadTranscript(thread.id) ?? {
            finalText: null,
            messages: [],
          };
          const report: RemoteReport = {
            threadId: thread.id,
            running,
            summary: thread.title,
            finalText: transcript.finalText,
            messages: transcript.messages,
            projectName: getProject(thread.project_id)?.name ?? thread.project_id,
            filesTouched: await filesTouched(cwd),
            worktreePath: thread.worktree_path ?? null,
            isolated: Boolean(thread.worktree_path),
            isolationNote: null,
            permissions: am?.getRemotePermissions(thread.id) ?? [],
            request: this.requests.latestForThread(thread.id),
            model: (() => {
              const m = am?.getThreadModel(thread.id);
              return m ? { current: m.current, options: m.options } : null;
            })(),
          };
          sendApi(res, 200, { report });
        },
      },
    ];
  }

  /**
   * New phone chat = fresh isolated worktree + fresh background thread +
   * first turn. Dispatched at most once per requestId, so a phone retrying
   * after a dropped reply gets the original thread instead of a duplicate.
   */
  private async createTask({ req, res, am }: RouteContext): Promise<void> {
    // Refuse before reading: a prompt body can be tens of MB of images.
    this.assertTaskAllowance();
    const body = parseJsonObject(await readBody(req, MAX_PROMPT_BODY_BYTES));
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (
      !projectId ||
      !prompt ||
      (body.modelId != null && typeof body.modelId !== "string") ||
      (body.model != null && typeof body.model !== "string")
    ) {
      return sendApi(res, 400, { error: "projectId and prompt are required" });
    }
    const agentId = (body.modelId as string | null | undefined) ?? null;
    const model = (body.model as string | null | undefined) || null;
    const images = parsePromptImages(body.images);
    this.consumeTaskAllowance();
    const receipt = await this.requests.submit(
      requestIdFrom(body),
      // `model` and `images` join the fingerprint only when set, so receipts
      // written before they existed still match their retries.
      {
        kind: "create",
        projectId,
        agentId,
        ...(model ? { model } : {}),
        prompt,
        ...(images.length ? { images } : {}),
      },
      async () => {
        if (!am)
          throw new RemoteTaskError("Pipper is still starting on your Mac. No task was started.");
        console.log(
          `[Remote] new phone thread project=${projectId} promptLen=${prompt.length} images=${images.length}`,
        );
        return prepareIsolatedAgentTask(am, projectId, agentId, prompt, model, images);
      },
    );
    this.sendReceipt(res, receipt);
  }

  /** Follow-up turn on an existing phone thread, bound to its live worktree. */
  private async sendFollowUp({ req, res, params }: RouteContext): Promise<void> {
    const threadId = params[0]!;
    if (!getThread(threadId)) return sendApi(res, 404, { error: "Thread not found" });
    // Refuse before reading: a prompt body can be tens of MB of images.
    this.assertTaskAllowance();
    const body = parseJsonObject(await readBody(req, MAX_PROMPT_BODY_BYTES));
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return sendApi(res, 400, { error: "prompt is required" });
    const images = parsePromptImages(body.images);
    this.consumeTaskAllowance();
    const receipt = await this.requests.submit(
      requestIdFrom(body),
      { kind: "prompt", threadId, prompt, ...(images.length ? { images } : {}) },
      async () => {
        const am = this.deps.agentManager();
        if (!am) throw new RemoteTaskError("Pipper is still starting on your Mac.");
        const thread = getThread(threadId);
        const project = thread ? getProject(thread.project_id) : null;
        if (
          !thread?.worktree_path ||
          !project ||
          !isLiveWorktree(thread.worktree_path, project.path)
        ) {
          throw new RemoteTaskError(
            "This thread has no live isolated workspace. Restore its worktree on your Mac, or start a new thread.",
          );
        }
        return {
          threadId,
          result: { ok: true },
          execute: () =>
            am.sendPrompt(
              { threadId, message: prompt, images },
              { background: true, requireWorktree: true },
            ),
        };
      },
    );
    this.sendReceipt(res, receipt);
  }

  /** 202 once accepted (the turn runs in the background); 409 while unsettled or failed. */
  private sendReceipt(res: http.ServerResponse, receipt: RemoteRequestReceipt): void {
    sendApi(res, receipt.result ? 202 : 409, {
      ...receipt.result,
      request: this.requests.status(receipt),
      ...(receipt.result
        ? {}
        : {
            error: receipt.error ?? "Request is still being prepared.",
            retryable: receipt.state === "failed",
          }),
    });
  }

  private loadAgentModels(am: AgentManager): Promise<Record<string, RemoteAgentModel[]>> {
    const cached = this.agentModels;
    if (cached && Date.now() - cached.at < AGENT_MODELS_TTL_MS) return cached.value;
    const value = am
      .getModelCatalogs()
      .then((catalogs) =>
        Object.fromEntries(
          Object.entries(catalogs).map(([agentId, models]) => [
            agentId,
            models.map((m) => ({ id: m.modelId, name: m.name })),
          ]),
        ),
      );
    this.agentModels = { at: Date.now(), value };
    // A failed probe must not be served for the whole TTL.
    value.catch(() => {
      if (this.agentModels?.value === value) this.agentModels = null;
    });
    return value;
  }

  private serveFile(
    res: http.ServerResponse,
    rel: string,
    contentType?: string,
    headers: Record<string, string> = {},
  ): void {
    try {
      // URL parsing already collapses `..`, but the static root must hold
      // even for encodings it doesn't normalize.
      const file = resolveWithin(this.deps.getRendererDir(), rel);
      if (!file || !existsSync(file)) return send(res, 404, { error: "Not found" });
      const data = readFileSync(file);
      const type =
        contentType ?? STATIC_TYPES[extname(rel).toLowerCase()] ?? "application/octet-stream";
      res.writeHead(200, { ...BASE_SECURITY_HEADERS, "Content-Type": type, ...headers });
      res.end(data);
    } catch (error) {
      console.error(`[Remote] failed to serve ${rel}:`, error);
      send(res, 500, { error: "Internal error" });
    }
  }
}
