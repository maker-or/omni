import { spawn, type ChildProcess } from "node:child_process";
import type { RemoteTunnelStatus } from "../contracts/remote.ts";
import { terminateChildProcess } from "./child-process.ts";

export type TunnelMode =
  /** Account-less trycloudflare.com tunnel; its hostname changes on every start. */
  | { kind: "quick"; originUrl: string }
  /** Named tunnel provisioned elsewhere; the connector token stays out of argv. */
  | { kind: "token"; token: string; hostname: string };

export interface CloudflaredTunnelOptions {
  /** Resolves to a validated cloudflared binary (may download on first use). */
  binary: () => Promise<string>;
  /**
   * The tunnel to run, or a function resolving it on every (re)launch — e.g.
   * asking pipper.dev for a named tunnel. A rejection with `fatal: true`
   * stops retrying (the user must act); any other rejection retries.
   */
  mode: TunnelMode | (() => Promise<TunnelMode>);
  /**
   * A minimal config file passed as --config, so a personal
   * ~/.cloudflared/config.yml (ingress rules, other tunnels) never leaks into
   * this tunnel or blocks quick-tunnel mode.
   */
  configPath: string;
  onStatus?: (status: RemoteTunnelStatus) => void;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /** A run lasting this long counts as healthy and resets the backoff. */
  stableAfterMs?: number;
  spawnImpl?: typeof spawn;
}

const QUICK_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const CONNECTED_RE = /Registered tunnel connection/i;
/** cloudflared logs "<time> ERR <message>". */
const ERROR_LINE_RE = /\s(ERR|FTL)\s+(.*)$/;

/**
 * Supervises one cloudflared connector process. It exposes the loopback
 * origin through Cloudflare and reports where phones can reach it. A crashed
 * or disconnected connector is restarted with exponential backoff; stop()
 * tears it down and no restart follows.
 */
export class CloudflaredTunnel {
  private readonly options: CloudflaredTunnelOptions;
  private child: ChildProcess | null = null;
  private wanted = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private current: RemoteTunnelStatus = { state: "stopped" };
  /** Bumped on every start/stop so stale async work can tell it lost. */
  private generation = 0;

  constructor(options: CloudflaredTunnelOptions) {
    this.options = options;
  }

  get status(): RemoteTunnelStatus {
    return this.current;
  }

  /** Public base URL while connected, else null. */
  get url(): string | null {
    return this.current.state === "connected" ? this.current.url : null;
  }

  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    this.attempt = 0;
    void this.launch(++this.generation);
  }

  async stop(): Promise<void> {
    this.wanted = false;
    this.generation++;
    this.clearRetry();
    const child = this.child;
    this.child = null;
    if (child) await terminateChildProcess(child);
    this.setStatus({ state: "stopped" });
  }

  /** Skip a pending backoff wait (e.g. after the laptop wakes up). */
  retryNow(): void {
    if (!this.wanted || this.child || !this.retryTimer) return;
    this.clearRetry();
    void this.launch(++this.generation);
  }

  private setStatus(status: RemoteTunnelStatus): void {
    this.current = status;
    this.options.onStatus?.(status);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private scheduleRetry(generation: number, lastError: string | null): void {
    if (!this.wanted || generation !== this.generation) return;
    this.attempt += 1;
    const initial = this.options.initialBackoffMs ?? 1_000;
    const max = this.options.maxBackoffMs ?? 5 * 60_000;
    const delay = Math.min(max, initial * 2 ** (this.attempt - 1));
    this.setStatus({
      state: "reconnecting",
      attempt: this.attempt,
      retryAt: Date.now() + delay,
      lastError,
    });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.wanted && generation === this.generation) {
        void this.launch(++this.generation);
      }
    }, delay);
    this.retryTimer.unref?.();
  }

  private args(mode: TunnelMode): string[] {
    const { configPath } = this.options;
    const common = ["tunnel", "--no-autoupdate", "--config", configPath];
    return mode.kind === "quick" ? [...common, "--url", mode.originUrl] : [...common, "run"];
  }

  private async launch(generation: number): Promise<void> {
    this.setStatus({ state: "installing" });
    let bin: string;
    let mode: TunnelMode;
    try {
      bin = await this.options.binary();
      mode =
        typeof this.options.mode === "function" ? await this.options.mode() : this.options.mode;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Tunnel] setup failed:", message);
      if (!this.wanted || generation !== this.generation) return;
      const setup = error as { fatal?: unknown; signInRequired?: unknown };
      if (setup.fatal === true) {
        this.setStatus(
          setup.signInRequired === true
            ? { state: "error", message, signInRequired: true }
            : { state: "error", message },
        );
        return;
      }
      this.scheduleRetry(generation, message);
      return;
    }
    if (!this.wanted || generation !== this.generation) return;

    this.setStatus({ state: "starting" });
    const env: NodeJS.ProcessEnv = { ...process.env };
    // Token via env, never argv: argv is visible to every local user via ps.
    if (mode.kind === "token") env.TUNNEL_TOKEN = mode.token;
    else delete env.TUNNEL_TOKEN;
    const child = (this.options.spawnImpl ?? spawn)(bin, this.args(mode), {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    const startedAt = Date.now();
    let quickUrl: string | null = null;
    let lastError: string | null = null;
    let buffered = "";

    const onLine = (line: string): void => {
      if (generation !== this.generation) return;
      const errorMatch = ERROR_LINE_RE.exec(line);
      if (errorMatch) {
        lastError = errorMatch[2]!.trim();
        console.warn(`[Tunnel] ${lastError}`);
      }
      if (mode.kind === "quick" && !quickUrl) quickUrl = QUICK_URL_RE.exec(line)?.[0] ?? null;
      if (CONNECTED_RE.test(line) && this.current.state !== "connected") {
        const url = mode.kind === "quick" ? quickUrl : `https://${mode.hostname}`;
        if (url) {
          console.log(`[Tunnel] connected: ${url}`);
          this.setStatus({ state: "connected", url });
        }
      }
    };
    const onData = (chunk: Buffer): void => {
      buffered += chunk.toString("utf8");
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      if (buffered.length > 16_384) buffered = buffered.slice(-16_384);
      for (const line of lines) onLine(line);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.once("error", (error) => {
      lastError = error.message;
    });
    child.once("close", (code, signal) => {
      if (this.child === child) this.child = null;
      if (!this.wanted || generation !== this.generation) return;
      console.warn(`[Tunnel] cloudflared exited code=${code} signal=${signal}`);
      if (Date.now() - startedAt >= (this.options.stableAfterMs ?? 60_000)) this.attempt = 0;
      this.scheduleRetry(generation, lastError ?? `cloudflared exited (${code ?? signal})`);
    });
  }
}
