import http from "node:http";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { extname, join } from "node:path";
import type { AgentManager } from "./agent-connection-manager.ts";
import { listProjects, getProject } from "./projects.ts";
import { listRegisteredAgents } from "./agents/registry.ts";
import { getThread, listThreads } from "./threads.ts";
import { createWorktree, gitBinary, removeWorktreeBestEffort } from "./worktree-manager.ts";
import type {
  RemoteDevice,
  RemoteDevicesState,
  RemoteModel,
  RemotePairingOffer,
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
  private readonly isolationNotes = new Map<string, string>();
  private readonly routes: Route[];
  private lastAuthedAt = 0;
  /** Set by start(): loopback-only means the public path is a tunnel. */
  private behindTunnel = false;

  constructor(deps: RemoteServerDeps, opts?: { port?: number }) {
    this.deps = deps;
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
            pairingUrl: base ? `${base}/remote#pair=${live.code}` : null,
            expiresAt: live.expiresAt,
            scopes: live.scopes,
          }
        : null,
    };
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
  async start(options: { loopbackOnly?: boolean } = {}): Promise<void> {
    if (this.servers.length > 0) return;
    this.behindTunnel = options.loopbackOnly === true;
    const handler = (req: http.IncomingMessage, res: http.ServerResponse) =>
      void this.handle(req, res);
    // Threat model: plain HTTP is intentional here. Listeners bind loopback +
    // Tailscale only, so bearer credentials traverse either localhost or the
    // WireGuard-encrypted tailnet — never LAN/Wi-Fi in cleartext. TLS would
    // add self-signed cert friction on the phone with no transport gain.
    // A PIPPER_REMOTE_HOST override is honored only for loopback/Tailscale —
    // a LAN address would leak the bearer token + transcripts in cleartext.
    const override = process.env.PIPPER_REMOTE_HOST?.trim();
    const hosts = this.behindTunnel
      ? ["127.0.0.1"]
      : override
        ? isTrustedRemoteHost(override)
          ? [override]
          : (() => {
              console.warn(`[Remote] ignoring untrusted PIPPER_REMOTE_HOST=${override}`);
              return ["127.0.0.1", ...this.getTailscaleIps()];
            })()
        : ["127.0.0.1", ...this.getTailscaleIps()];
    const binds: Promise<void>[] = [];
    for (const host of new Set(hosts)) {
      const server = http.createServer(handler);
      server.headersTimeout = HEADERS_TIMEOUT_MS;
      server.requestTimeout = REQUEST_TIMEOUT_MS;
      this.servers.push(server);
      binds.push(
        new Promise<void>((resolve) => {
          // A failed bind (port taken, interface gone) must not poison
          // start(): drop it so a later start() can retry.
          server.once("error", (err) => {
            console.error(`[Remote] listen failed on ${host}:${this.port}:`, err);
            this.servers = this.servers.filter((s) => s !== server);
            this.boundHosts.delete(server);
            resolve();
          });
          server.listen(this.port, host, () => {
            this.boundHosts.set(server, host);
            console.log(`[Remote] PWA server on http://${host}:${this.port}/remote`);
            resolve();
          });
        }),
      );
    }
    await Promise.all(binds);
  }

  stop(): Promise<void> {
    const closing = this.servers.splice(0);
    this.boundHosts.clear();
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

  /** True when at least one listener is bound. Meaningful after start() resolves. */
  isServing(): boolean {
    return this.boundHosts.size > 0;
  }

  /** True when a thread row already binds this worktree (keep it for retry). */
  private threadExistsForWorktree(worktreePath: string): boolean {
    try {
      return listThreads().some((t) => t.worktree_path === worktreePath);
    } catch {
      return true;
    }
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

    // Serve the PWA shell without auth so "Add to Home Screen" works; the
    // app stores its device token after pairing and sends it per request.
    if (req.method === "GET" && (path === "/remote" || path === "/remote/")) {
      return this.serveFile(res, "remote.html", "text/html", {
        "Content-Security-Policy": REMOTE_PAGE_CSP,
        "Cache-Control": "no-cache",
      });
    }
    // Built remote.html references ./assets/* (resolves to /assets/*).
    if (
      req.method === "GET" &&
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
    if (req.method === "GET" && path === "/remote-manifest.json") {
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
    if (!path.startsWith("/api/remote/")) {
      send(res, 404, { error: "Not found" });
      return;
    }
    if (req.method === "POST" && path === "/api/remote/pair") {
      return this.pair(req, res);
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
    const response: RemotePairResponse = { token, device };
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
          const models: RemoteModel[] = listRegisteredAgents().map((a) => ({
            id: a.id,
            name: a.displayName ?? a.name ?? a.id,
          }));
          sendApi(res, 200, { models });
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
        method: "POST",
        pattern: /^\/api\/remote\/threads\/([^/]+)\/prompt$/,
        scope: "run",
        handle: async ({ req, res, params, am }) => {
          if (!am) return sendApi(res, 503, { error: "Agent not ready" });
          const thread = getThread(params[0]!);
          if (!thread) return sendApi(res, 404, { error: "Thread not found" });
          // Refuse before reading: a prompt body can be tens of MB of images.
          this.assertTaskAllowance();
          const body = parseJsonObject(await readBody(req, MAX_PROMPT_BODY_BYTES));
          const prompt = typeof body.prompt === "string" ? body.prompt : "";
          if (!prompt.trim()) return sendApi(res, 400, { error: "prompt is required" });
          const images = parsePromptImages(body.images);
          this.consumeTaskAllowance();
          await am.sendPrompt(
            { threadId: thread.id, message: prompt, images },
            { background: true },
          );
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
            isolationNote: this.isolationNotes.get(thread.id) ?? null,
          };
          sendApi(res, 200, { report });
        },
      },
    ];
  }

  /** New phone chat = fresh worktree + fresh background thread + first turn. */
  private async createTask({ req, res, am }: RouteContext): Promise<void> {
    if (!am) return sendApi(res, 503, { error: "Agent not ready" });
    // Refuse before reading: a prompt body can be tens of MB of images.
    this.assertTaskAllowance();
    const body = parseJsonObject(await readBody(req, MAX_PROMPT_BODY_BYTES));
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    const modelId = typeof body.modelId === "string" ? body.modelId : null;
    const images = parsePromptImages(body.images);
    if (!projectId || !prompt.trim()) {
      return sendApi(res, 400, { error: "projectId and prompt are required" });
    }
    const project = getProject(projectId);
    if (!project) return sendApi(res, 404, { error: "Project not found" });
    this.consumeTaskAllowance();
    // If the repo can't take a worktree (e.g. no commits yet), fall back to
    // the project root so the task still runs.
    let worktreePath: string | null = null;
    let worktreeBranch: string | null = null;
    let isolationNote: string | null = null;
    try {
      // Fixed-length random name: never derived from the prompt text, so
      // long/unicode/identical prompts can't produce ugly, colliding, or
      // confusing worktree + branch names. `phone-` prefix keeps the
      // origin identifiable in `git worktree list`.
      let created = null;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 5 && !created; attempt++) {
        const slug = `phone-${randomBytes(4).toString("hex")}`;
        try {
          created = createWorktree({
            projectPath: project.path,
            projectId: project.id,
            name: slug,
          });
        } catch (err) {
          lastError = err;
        }
      }
      if (!created) throw lastError ?? new Error("worktree creation failed");
      worktreePath = created.path;
      worktreeBranch = created.branch;
      console.log(`[Remote] worktree created: ${worktreePath}`);
    } catch (err) {
      isolationNote = err instanceof Error ? err.message : String(err);
      console.warn(`[Remote] worktree fallback to project root: ${isolationNote}`);
    }
    console.log(
      `[Remote] new phone thread project=${project.id} worktree=${worktreePath ?? "<root>"} promptLen=${prompt.length} images=${images.length}`,
    );
    // modelId from the phone is an *agent* id (listRegisteredAgents). Use it
    // to pick the connection, but never as a model name — the agent's own
    // default model applies (e.g. antigravity has no implicit default; the
    // user's desktop default is used).
    try {
      const thread = await am.createThread(
        project.id,
        prompt.slice(0, 80),
        null,
        modelId,
        worktreePath,
        null,
        { background: true },
      );
      if (isolationNote) this.isolationNotes.set(thread.id, isolationNote);
      console.log(
        `[Remote] prompt accepted thread=${thread.id} boundWorktree=${thread.worktree_path ?? "<root-fallback>"}`,
      );
      if (!thread.worktree_path) {
        console.warn(
          `[Remote] thread=${thread.id} running on PROJECT ROOT (no isolated workspace). ` +
            `requested=${worktreePath ?? "<none: create failed>"} reason=${isolationNote ?? "worktree rejected as not-live"}`,
        );
      }
      // Respond before the turn runs so the phone shows progress immediately;
      // the turn streams into the thread in the background and the report
      // poll picks it up. A prompt failure is logged server-side — the phone
      // sees an idle thread with no reply.
      void am
        .sendPrompt({ threadId: thread.id, message: prompt, images }, { background: true })
        .then(() => console.log(`[Remote] turn completed thread=${thread.id}`))
        .catch((promptError) => {
          console.error(`[Remote] prompt failed, keeping thread=${thread.id}:`, promptError);
        });
      sendApi(res, 201, {
        thread: {
          id: thread.id,
          projectId: thread.project_id,
          worktreePath: thread.worktree_path ?? null,
          title: thread.title,
          running: true,
          lastUsedAt: thread.last_used_at,
        },
      });
    } catch (error) {
      // Roll back the worktree only when thread creation itself failed —
      // once the thread row exists the worktree is retained for retry.
      if (worktreePath && !this.threadExistsForWorktree(worktreePath)) {
        console.warn(`[Remote] rolling back worktree: ${worktreePath}`);
        removeWorktreeBestEffort(project.path, worktreePath, worktreeBranch);
      }
      throw error;
    }
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
