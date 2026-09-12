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
import { getThread, listThreads } from "./threads.ts";
import { createWorktree, gitBinary, removeWorktreeBestEffort } from "./worktree-manager.ts";
import type {
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

export class RemoteServer {
  private servers: http.Server[] = [];
  private token: string;
  readonly port: number;
  private readonly deps: RemoteServerDeps;
  private readonly isolationNotes = new Map<string, string>();
  private lastAuthedAt = 0;

  constructor(deps: RemoteServerDeps, opts?: { port?: number; token?: string }) {
    this.deps = deps;
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
  private threadExistsForWorktree(worktreePath: string): boolean {
    try {
      return listThreads().some((t) => t.worktree_path === worktreePath);
    } catch {
      return true;
    }
  }

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
        const models: RemoteModel[] = listRegisteredAgents().map((a) => ({
          id: a.id,
          name: a.displayName ?? a.name ?? a.id,
        }));
        return send(res, 200, { models });
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
      if (req.method === "POST" && path === "/api/remote/threads") {
        if (!am) return send(res, 503, { error: "Agent not ready" });
        const body = JSON.parse((await readBody(req)) || "{}") as {
          projectId?: string;
          modelId?: string | null;
          prompt?: string;
        };
        if (!body.projectId || !body.prompt?.trim()) {
          return send(res, 400, { error: "projectId and prompt are required" });
        }
        const project = getProject(body.projectId);
        if (!project) return send(res, 404, { error: "Project not found" });
        // Every new phone chat = fresh worktree + fresh thread, invisible to user.
        // If the repo can't take a worktree (e.g. no commits yet), fall back
        // to the project root so the task still runs.
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
          `[Remote] new phone thread project=${project.id} worktree=${worktreePath ?? "<root>"} promptLen=${body.prompt.length}`,
        );
        // modelId from the phone is an *agent* id (listRegisteredAgents).
        // Use it to pick the connection, but never as a model name — the
        // agent's own default model applies (e.g. antigravity has no implicit
        // default; the user's desktop default is used).
        try {
          const thread = await am.createThread(
            project.id,
            body.prompt.slice(0, 80),
            null,
            body.modelId ?? null,
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
          // Respond before the turn runs so the phone shows progress
          // immediately; the turn streams into the thread in the background
          // and the report poll picks it up. A prompt failure is logged
          // server-side — the phone sees an idle thread with no reply.
          const prompt = body.prompt;
          void am
            .sendPrompt({ threadId: thread.id, message: prompt }, { background: true })
            .then(() => console.log(`[Remote] turn completed thread=${thread.id}`))
            .catch((promptError) => {
              console.error(`[Remote] prompt failed, keeping thread=${thread.id}:`, promptError);
            });
          return send(res, 201, {
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
      const promptMatch = path.match(/^\/api\/remote\/threads\/([^/]+)\/prompt$/);
      if (req.method === "POST" && promptMatch) {
        if (!am) return send(res, 503, { error: "Agent not ready" });
        const thread = getThread(promptMatch[1]!);
        if (!thread) return send(res, 404, { error: "Thread not found" });
        const body = JSON.parse((await readBody(req)) || "{}") as { prompt?: string };
        if (!body.prompt?.trim()) return send(res, 400, { error: "prompt is required" });
        await am.sendPrompt({ threadId: thread.id, message: body.prompt }, { background: true });
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
          isolationNote: this.isolationNotes.get(thread.id) ?? null,
        };
        return sendReport(res, { report });
      }
      send(res, 404, { error: "Not found" });
    } catch (error) {
      console.error(`[Remote] ${req.method} ${path} failed:`, error);
      send(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
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
