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
import { createWorktree } from "./worktree-manager.ts";
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
): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": contentType });
  res.end(text);
}

function loadOrCreateToken(deps: RemoteServerDeps): string {
  try {
    const dir = deps.getUserDataPath();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "remote-token.txt");
    if (existsSync(file)) {
      const saved = readFileSync(file, "utf8").trim();
      if (saved) return saved;
    }
    const fresh = randomBytes(24).toString("hex");
    writeFileSync(file, `${fresh}\n`, { mode: 0o600 });
    return fresh;
  } catch {
    return randomBytes(24).toString("hex");
  }
}

async function filesTouched(cwd: string | null): Promise<string[]> {
  if (!cwd || !existsSync(cwd)) return [];
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-z"], {
      cwd,
      maxBuffer: 1024 * 1024,
    });
    return String(stdout)
      .split("\0")
      .map((r) => r.slice(3).trim())
      .filter(Boolean)
      .slice(0, 50);
  } catch {
    return [];
  }
}

export class RemoteServer {
  private server: http.Server | null = null;
  private token: string;
  readonly port: number;
  private readonly deps: RemoteServerDeps;
  private readonly isolationNotes = new Map<string, string>();

  constructor(deps: RemoteServerDeps, opts?: { port?: number; token?: string }) {
    this.deps = deps;
    this.port = opts?.port ?? Number(process.env.PIPPER_REMOTE_PORT ?? 4173);
    // Stable pairing token: env override, else persisted per userData dir so a
    // relaunch doesn't invalidate the phone's saved token.
    this.token = opts?.token ?? process.env.PIPPER_REMOTE_TOKEN ?? loadOrCreateToken(deps);
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

  /** Pairing URL baked into the QR: phone auto-saves the token from the hash. */
  pairingUrl(host: string): string {
    return `http://${host}:${this.port}/remote#token=${this.token}`;
  }

  start(): void {
    if (this.server) return;
    this.server = http.createServer((req, res) => void this.handle(req, res));
    // Bind loopback + Tailscale interface: 0.0.0.0 would expose to LAN, so we
    // listen on all but rely on token auth; Tailscale Serve can front it.
    this.server.listen(this.port, "0.0.0.0", () => {
      console.log(`[Remote] PWA server on :${this.port}`);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
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
    if (req.method === "GET" && (path.startsWith("/assets/") || path === "/favicon.svg")) {
      return this.serveFile(res, path.slice(1), undefined);
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
        this.deps.onRemoteActiveChanged?.(running.size > 0);
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
        let isolationNote: string | null = null;
        try {
          const base =
            `phone-${body.prompt
              .slice(0, 24)
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "")}`.slice(0, 36) || "phone-task";
          // Unique per request: same prompt sent twice must not collide.
          const slug = `${base}-${Date.now().toString(36)}`;
          worktreePath = createWorktree({
            projectPath: project.path,
            projectId: project.id,
            name: slug,
          }).path;
          console.log(`[Remote] worktree created: ${worktreePath}`);
        } catch (err) {
          isolationNote = err instanceof Error ? err.message : String(err);
          console.warn(`[Remote] worktree fallback to project root: ${isolationNote}`);
        }
        console.log(
          `[Remote] new phone thread project=${project.id} worktree=${worktreePath ?? "<root>"} prompt=${body.prompt.slice(0, 120)}`,
        );
        // modelId from the phone is an *agent* id (listRegisteredAgents).
        // Use it to pick the connection, but never as a model name — the
        // agent's own default model applies (e.g. antigravity has no implicit
        // default; the user's desktop default is used).
        const thread = await am.createThread(
          project.id,
          body.prompt.slice(0, 80),
          null,
          body.modelId ?? null,
          worktreePath,
          null,
        );
        await am.sendPrompt({ threadId: thread.id, message: body.prompt });
        if (isolationNote) this.isolationNotes.set(thread.id, isolationNote);
        console.log(`[Remote] prompt sent thread=${thread.id}`);
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
      }
      const promptMatch = path.match(/^\/api\/remote\/threads\/([^/]+)\/prompt$/);
      if (req.method === "POST" && promptMatch) {
        if (!am) return send(res, 503, { error: "Agent not ready" });
        const thread = getThread(promptMatch[1]!);
        if (!thread) return send(res, 404, { error: "Thread not found" });
        const body = JSON.parse((await readBody(req)) || "{}") as { prompt?: string };
        if (!body.prompt?.trim()) return send(res, 400, { error: "prompt is required" });
        await am.sendPrompt({ threadId: thread.id, message: body.prompt });
        return send(res, 200, { ok: true });
      }
      const reportMatch = path.match(/^\/api\/remote\/threads\/([^/]+)\/report$/);
      if (req.method === "GET" && reportMatch) {
        const thread = getThread(reportMatch[1]!);
        if (!thread) return send(res, 404, { error: "Thread not found" });
        const running = (am?.getRunningThreadIds() ?? []).includes(thread.id);
        const cwd = thread.worktree_path ?? getProject(thread.project_id)?.path ?? null;
        const report: RemoteReport = {
          threadId: thread.id,
          running,
          summary: thread.title,
          filesTouched: await filesTouched(cwd),
          worktreePath: thread.worktree_path ?? null,
          isolated: Boolean(thread.worktree_path),
          isolationNote: this.isolationNotes.get(thread.id) ?? null,
        };
        return send(res, 200, { report });
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
