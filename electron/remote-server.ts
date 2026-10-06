import http from "node:http";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import type { AgentManager } from "./agent-connection-manager.ts";
import { listProjects, getProject } from "./projects.ts";
import { listRegisteredAgents } from "./agents/registry.ts";
import { buildSiriCatalog } from "./siri/siri-catalog.ts";
import { listAgentInstanceDescriptors } from "./agent-instances.ts";
import { getThread, listThreads } from "./threads.ts";
import { prepareIsolatedAgentTask } from "./isolated-agent-task.ts";
import { RemoteRequestError, RemoteRequests, getRemoteRequests } from "./remote-requests.ts";
import { gitBinary, isLiveWorktree } from "./worktree-manager.ts";
import type {
  RemoteAgentModel,
  RemoteModel,
  RemoteProject,
  RemoteReport,
  RemoteThreadSummary,
} from "../contracts/remote.ts";

const execFileAsync = promisify(execFile);

export interface RemoteServerDeps {
  agentManager: () => AgentManager | null;
  getUserDataPath: () => string;
  getRendererDir: () => string;
  onRemoteActiveChanged?: (active: boolean) => void;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 512_000) req.destroy();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function send(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  contentType = "application/json",
  headers: Record<string, string> = {},
): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": contentType, ...headers });
  res.end(text);
}

/** Transcripts must never sit in a browser/proxy cache: always no-store. */
function sendReport(res: http.ServerResponse, body: unknown): void {
  send(res, 200, body, "application/json", { "Cache-Control": "no-store" });
}

function loadOrCreateToken(deps: RemoteServerDeps): string {
  // Precedence: persisted file (incl. rotated via regenerateToken) > env >
  // fresh. The file wins over the env so a rotation is never undone by a
  // restart while PIPPER_REMOTE_TOKEN is still set.
  try {
    const dir = deps.getUserDataPath();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "remote-token.txt");
    if (existsSync(file)) {
      const saved = readFileSync(file, "utf8").trim();
      if (saved) return saved;
    }
    if (process.env.PIPPER_REMOTE_TOKEN?.trim()) {
      return process.env.PIPPER_REMOTE_TOKEN.trim();
    }
    const fresh = randomBytes(24).toString("hex");
    writeFileSync(file, `${fresh}\n`, { mode: 0o600 });
    return fresh;
  } catch {
    return process.env.PIPPER_REMOTE_TOKEN?.trim() || randomBytes(24).toString("hex");
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

/** Building model catalogs spawns every selected agent and probes sessions,
 * so the phone shares one recent result instead of re-probing per request. */
const AGENT_MODELS_TTL_MS = 5 * 60_000;

export class RemoteServer {
  private servers: http.Server[] = [];
  private token: string;
  readonly port: number;
  private readonly deps: RemoteServerDeps;
  private readonly requests: RemoteRequests;
  private lastAuthedAt = 0;
  private agentModels: {
    at: number;
    value: Promise<Record<string, RemoteAgentModel[]>>;
  } | null = null;

  constructor(deps: RemoteServerDeps, opts?: { port?: number; token?: string }) {
    this.deps = deps;
    this.requests = getRemoteRequests(join(deps.getUserDataPath(), "remote-requests"));
    this.port = opts?.port ?? Number(process.env.PIPPER_REMOTE_PORT ?? 4173);
    // Stable pairing token: env override, else persisted per userData dir so a
    // relaunch doesn't invalidate the phone's saved token.
    this.token = opts?.token ?? loadOrCreateToken(deps);
  }

  getPairingToken(): string {
    return this.token;
  }

  /** Mint a fresh token (invalidates paired phones) and persist it. */
  regenerateToken(): string {
    this.token = randomBytes(24).toString("hex");
    try {
      const dir = this.deps.getUserDataPath();
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "remote-token.txt"), `${this.token}\n`, { mode: 0o600 });
    } catch (err) {
      console.warn("[Remote] token persist failed:", err);
    }
    return this.token;
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
   * Address safe to advertise in QR/Settings: only what start() actually
   * binds. Null when Tailscale is down — callers must show "unavailable"
   * instead of a LAN address we don't serve.
   */
  getAdvertisedHost(): string | null {
    const override = process.env.PIPPER_REMOTE_HOST?.trim();
    if (override) return isTrustedRemoteHost(override) ? override : null;
    return this.getTailscaleIps()[0] ?? null;
  }

  /** Pairing URL baked into the QR: phone auto-saves the token from the hash. */
  pairingUrl(host: string): string {
    return `http://${host}:${this.port}/remote#token=${this.token}`;
  }

  /** Last time an authed phone request arrived (0 = never). Drives standby. */
  getLastAuthedAt(): number {
    return this.lastAuthedAt;
  }

  /** True when an idle paired phone should still keep the laptop awake. */
  hasLiveLease(now = Date.now()): boolean {
    return this.lastAuthedAt > 0 && now - this.lastAuthedAt < REMOTE_LEASE_MS;
  }

  start(): void {
    if (this.servers.length > 0) return;
    const handler = (req: http.IncomingMessage, res: http.ServerResponse) =>
      void this.handle(req, res);
    // Threat model: plain HTTP is intentional here. Listeners bind loopback +
    // Tailscale only, so bearer credentials traverse either localhost or the
    // WireGuard-encrypted tailnet — never LAN/Wi-Fi in cleartext. TLS would
    // add self-signed cert friction on the phone with no transport gain.
    // A PIPPER_REMOTE_HOST override is honored only for loopback/Tailscale —
    // a LAN address would leak the bearer token + transcripts in cleartext.
    const override = process.env.PIPPER_REMOTE_HOST?.trim();
    const hosts = override
      ? isTrustedRemoteHost(override)
        ? [override]
        : (() => {
            console.warn(`[Remote] ignoring untrusted PIPPER_REMOTE_HOST=${override}`);
            return ["127.0.0.1", ...this.getTailscaleIps()];
          })()
      : ["127.0.0.1", ...this.getTailscaleIps()];
    for (const host of new Set(hosts)) {
      const server = http.createServer(handler);
      // A failed bind (port taken, interface gone) must not poison start():
      // drop it so a later start() can retry.
      server.on("error", (err) => {
        console.error(`[Remote] listen failed on ${host}:${this.port}:`, err);
        this.servers = this.servers.filter((s) => s !== server);
      });
      server.listen(this.port, host, () => {
        console.log(`[Remote] PWA server on http://${host}:${this.port}/remote`);
      });
      this.servers.push(server);
    }
  }

  stop(): Promise<void> {
    const closing = this.servers.splice(0);
    return Promise.all(
      closing.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    ).then(() => undefined);
  }

  /** True when at least one listener survived startup (bind may have failed). */
  isServing(): boolean {
    return this.servers.length > 0;
  }

  /** True when a thread row already binds this worktree (keep it for retry). */

  private authed(req: http.IncomingMessage): boolean {
    const header = req.headers.authorization ?? "";
    return header === `Bearer ${this.token}`;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    // Serve the PWA shell without auth so "Add to Home Screen" works; the
    // app itself stores the token after QR pairing and sends it per request.
    if (req.method === "GET" && (path === "/remote" || path === "/remote/")) {
      return this.serveFile(res, "remote.html", "text/html");
    }
    // Built remote.html references ./assets/* (resolves to /assets/*).
    if (
      req.method === "GET" &&
      (path.startsWith("/assets/") || path === "/favicon.svg" || path === "/icon.png")
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
    if (req.method === "GET" && path === "/api/remote/health") {
      return send(res, 200, { ok: true, time: Date.now() });
    }
    if (req.method === "GET" && path.startsWith("/remote-assets/")) {
      return this.serveFile(res, path.slice(1), undefined);
    }
    if (req.method === "GET" && path === "/api/remote/debug-log") {
      return send(res, 200, { hint: "POST {message} to log from phone" });
    }
    if (req.method === "POST" && path === "/api/remote/debug-log") {
      const body = await readBody(req);
      console.log(`[Remote phone] ${body.slice(0, 2000)}`);
      return send(res, 200, { ok: true });
    }
    if (!path.startsWith("/api/remote/")) {
      send(res, 404, { error: "Not found" });
      return;
    }
    if (!this.authed(req)) {
      send(res, 401, { error: "Unauthorized" });
      return;
    }
    // Any authed call proves a live paired phone — renews the standby lease
    // so an idle phone keeps the laptop awake between tasks.
    this.lastAuthedAt = Date.now();
    this.deps.onRemoteActiveChanged?.(true);

    const am = this.deps.agentManager();
    try {
      if (req.method === "GET" && path === "/api/remote/projects") {
        const projects: RemoteProject[] = listProjects().map((p) => ({
          id: p.id,
          name: p.name,
          path: p.path,
        }));
        return send(res, 200, { projects });
      }
      if (req.method === "GET" && path === "/api/remote/models") {
        // Offer provider instances (accounts), not just drivers, so a phone can
        // route a task to a specific account. Default instances reuse the
        // driver id, so single-account setups see exactly the same list.
        // `provider` groups accounts under their driver on the phone.
        const driverNames = new Map(
          listRegisteredAgents().map((driver) => [driver.id, driver.displayName ?? driver.name]),
        );
        const models: RemoteModel[] = listAgentInstanceDescriptors().map((a) => ({
          id: a.id,
          name: a.displayName ?? a.name ?? a.id,
          provider: driverNames.get(a.driverId ?? a.id) ?? a.driverId ?? a.id,
        }));
        return send(res, 200, { models });
      }
      if (req.method === "GET" && path === "/api/remote/agent-models") {
        // Models *inside* each agent instance (the ACP model option), keyed by
        // the same instance ids `/models` returns.
        if (!am) return send(res, 503, { error: "Agent not ready" });
        return send(res, 200, { models: await this.loadAgentModels(am) });
      }
      if (req.method === "GET" && path === "/api/remote/catalog") {
        // Same shape as siri-catalog.json on the laptop, so the iOS app's
        // Siri intents resolve projects/agents against an identical catalog
        // (selected agents only, with availability) without a network hop.
        return send(res, 200, buildSiriCatalog(), "application/json", {
          "Cache-Control": "no-store",
        });
      }
      if (req.method === "GET" && path === "/api/remote/threads") {
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
        return send(res, 200, { threads: summaries });
      }
      if (req.method === "GET" && path === "/api/remote/diagnostics") {
        const catalog = buildSiriCatalog();
        return sendReport(res, {
          paired: true,
          agentReady: am != null,
          availableAgents: catalog.agents.filter((a) => a.available).length,
          projects: catalog.projects.length,
        });
      }
      const requestMatch = path.match(/^\/api\/remote\/requests\/([A-Za-z0-9-]{1,128})$/);
      if (req.method === "GET" && requestMatch) {
        const receipt = this.requests.get(requestMatch[1]!);
        return receipt
          ? sendReport(res, { request: this.requests.status(receipt) })
          : send(res, 404, { error: "Request not found" });
      }
      if (req.method === "POST" && path === "/api/remote/threads") {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          requestId?: string;
          projectId?: string;
          modelId?: string | null;
          model?: string | null;
          prompt?: string;
        };
        if (
          typeof body.projectId !== "string" ||
          typeof body.prompt !== "string" ||
          !body.prompt.trim() ||
          (body.modelId != null && typeof body.modelId !== "string") ||
          (body.model != null && typeof body.model !== "string")
        ) {
          return send(res, 400, { error: "projectId and prompt are required" });
        }
        const { projectId } = body;
        const prompt = body.prompt.trim();
        const model = body.model ?? null;
        const receipt = await this.requests.submit(
          body.requestId,
          // `model` joins the fingerprint only when set, so receipts written
          // before model choice existed still match their retries.
          {
            kind: "create",
            projectId,
            agentId: body.modelId ?? null,
            ...(model ? { model } : {}),
            prompt,
          },
          async () => {
            if (!am) throw new Error("Pipper is still starting on your Mac. No task was started.");
            return prepareIsolatedAgentTask(am, projectId, body.modelId, prompt, model);
          },
        );
        return send(res, receipt.result ? 202 : 409, {
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
      const promptMatch = path.match(/^\/api\/remote\/threads\/([^/]+)\/prompt$/);
      if (req.method === "POST" && promptMatch) {
        const threadId = promptMatch[1]!;
        const body = JSON.parse((await readBody(req)) || "{}") as {
          requestId?: string;
          prompt?: string;
        };
        if (typeof body.prompt !== "string" || !body.prompt.trim())
          return send(res, 400, { error: "prompt is required" });
        const prompt = body.prompt.trim();
        const receipt = await this.requests.submit(
          body.requestId,
          { kind: "prompt", threadId, prompt },
          async () => {
            if (!am) throw new Error("Pipper is still starting on your Mac.");
            const thread = getThread(threadId);
            const project = thread ? getProject(thread.project_id) : null;
            if (
              !thread?.worktree_path ||
              !project ||
              !isLiveWorktree(thread.worktree_path, project.path)
            ) {
              throw new Error(
                "This thread has no live isolated workspace. Restore its worktree on your Mac, or start a new thread.",
              );
            }
            return {
              threadId,
              result: { ok: true },
              execute: () =>
                am.sendPrompt(
                  { threadId, message: prompt },
                  { background: true, requireWorktree: true },
                ),
            };
          },
        );
        return send(res, receipt.result ? 202 : 409, {
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
      const modelMatch = path.match(/^\/api\/remote\/threads\/([^/]+)\/model$/);
      if (req.method === "POST" && modelMatch) {
        if (!am) return send(res, 503, { error: "Agent not ready" });
        const threadId = modelMatch[1]!;
        if (!getThread(threadId)) return send(res, 404, { error: "Thread not found" });
        const body = JSON.parse((await readBody(req)) || "{}") as { model?: string };
        if (typeof body.model !== "string" || !body.model) {
          return send(res, 400, { error: "model is required" });
        }
        const current = am.getThreadModel(threadId);
        if (!current) {
          return send(res, 409, {
            error: "This thread can't change models right now. Open it on your Mac and try again.",
          });
        }
        if (!current.options.some((o) => o.id === body.model)) {
          return send(res, 400, { error: "That model isn't offered by this thread's agent." });
        }
        await am.setThreadConfigOption(threadId, current.configId, body.model);
        const next = am.getThreadModel(threadId);
        return send(res, 200, {
          model: next ? { current: next.current, options: next.options } : null,
        });
      }
      const controlMatch = path.match(/^\/api\/remote\/threads\/([^/]+)\/(stop|permission)$/);
      if (req.method === "POST" && controlMatch) {
        if (!am) return send(res, 503, { error: "Agent not ready" });
        const threadId = controlMatch[1]!;
        if (!getThread(threadId)) return send(res, 404, { error: "Thread not found" });
        if (controlMatch[2] === "stop") {
          await am.abortThread(threadId);
        } else {
          const body = JSON.parse((await readBody(req)) || "{}") as {
            decisionId?: string;
            optionId?: string;
            cancelled?: boolean;
          };
          if (
            typeof body.decisionId !== "string" ||
            (body.optionId != null && typeof body.optionId !== "string") ||
            (body.cancelled != null && typeof body.cancelled !== "boolean")
          ) {
            return send(res, 400, { error: "A valid decision and option are required" });
          }
          const answered = await am.respondToRemotePermission(
            threadId,
            body.decisionId,
            body.optionId,
            body.cancelled === true,
          );
          if (!answered)
            return send(res, 409, {
              error: "This decision expired or was already answered. Refresh the thread.",
            });
        }
        return send(res, 200, { ok: true });
      }
      const reportMatch = path.match(/^\/api\/remote\/threads\/([^/]+)\/report$/);
      if (req.method === "GET" && reportMatch) {
        const thread = getThread(reportMatch[1]!);
        if (!thread) return send(res, 404, { error: "Thread not found" });
        const running = (am?.getRunningThreadIds() ?? []).includes(thread.id);
        const cwd = thread.worktree_path ?? getProject(thread.project_id)?.path ?? null;
        const transcript = am?.getThreadTranscript(thread.id) ?? { finalText: null, messages: [] };
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
        return sendReport(res, { report });
      }
      send(res, 404, { error: "Not found" });
    } catch (error) {
      console.error(`[Remote] ${req.method} ${path} failed:`, error);
      send(
        res,
        error instanceof RemoteRequestError
          ? error.status
          : error instanceof SyntaxError
            ? 400
            : 500,
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
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

  private serveFile(res: http.ServerResponse, rel: string, contentType?: string): void {
    try {
      const file = join(this.deps.getRendererDir(), rel);
      if (!existsSync(file)) return send(res, 404, { error: "PWA not built yet" });
      const data = readFileSync(file);
      const type =
        contentType ??
        (rel.endsWith(".js")
          ? "text/javascript"
          : rel.endsWith(".css")
            ? "text/css"
            : rel.endsWith(".svg")
              ? "image/svg+xml"
              : "application/octet-stream");
      res.writeHead(200, { "Content-Type": type });
      res.end(data);
    } catch {
      send(res, 500, { error: "Failed to serve PWA" });
    }
  }
}
