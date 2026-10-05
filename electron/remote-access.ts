import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RemoteServerInfo, RemoteTransport } from "../contracts/remote.ts";
import { CloudflaredBinary } from "./cloudflared-binary.ts";
import { CloudflaredTunnel } from "./cloudflared-tunnel.ts";
import { RemoteServer, type RemoteServerDeps } from "./remote-server.ts";

const TRANSPORTS: readonly RemoteTransport[] = ["tailscale", "cloudflare-quick"];

export interface RemoteAccessOptions {
  userDataPath: string;
  serverDeps: Omit<RemoteServerDeps, "getPublicBaseUrl">;
  port?: number;
  /** cloudflared resolution; see CloudflaredBinary for the lookup order. */
  cloudflared?: { overridePath?: string | null; bundledPath?: string | null };
  onInfoChanged?: (info: RemoteServerInfo) => void;
}

function isTransport(value: unknown): value is RemoteTransport {
  return typeof value === "string" && (TRANSPORTS as readonly string[]).includes(value);
}

/**
 * Owns how phones reach this laptop: the RemoteServer, the chosen transport,
 * and (for Cloudflare) the tunnel connector. In tunnel mode the server binds
 * loopback only, so the tunnel is the sole network path in.
 */
export class RemoteAccessController {
  readonly server: RemoteServer;
  private readonly options: RemoteAccessOptions;
  private readonly settingsPath: string;
  private readonly toolsDir: string;
  private readonly binary: CloudflaredBinary;
  private transport: RemoteTransport;
  private tunnel: CloudflaredTunnel | null = null;
  /** Serializes start/stop/switch so a fast toggle can't interleave binds. */
  private queue: Promise<void> = Promise.resolve();

  constructor(options: RemoteAccessOptions) {
    this.options = options;
    this.settingsPath = join(options.userDataPath, "remote-access.json");
    this.toolsDir = join(options.userDataPath, "tools", "cloudflared");
    this.transport = this.readTransport();
    this.binary = new CloudflaredBinary({
      installRoot: this.toolsDir,
      overridePath: options.cloudflared?.overridePath,
      bundledPath: options.cloudflared?.bundledPath,
    });
    this.server = new RemoteServer(
      { ...options.serverDeps, getPublicBaseUrl: () => this.publicUrl() },
      { port: options.port },
    );
  }

  private readTransport(): RemoteTransport {
    const env = process.env.PIPPER_REMOTE_TRANSPORT?.trim();
    if (isTransport(env)) return env;
    try {
      const saved = JSON.parse(readFileSync(this.settingsPath, "utf8")) as { transport?: unknown };
      if (isTransport(saved.transport)) return saved.transport;
    } catch {
      // No settings yet.
    }
    return "tailscale";
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(work, work);
    return this.queue;
  }

  start(): Promise<void> {
    return this.enqueue(() => this.startNow());
  }

  private async startNow(): Promise<void> {
    const viaTunnel = this.transport !== "tailscale";
    await this.server.start({ loopbackOnly: viaTunnel });
    if (viaTunnel && this.server.isServing()) this.startTunnel();
    this.emit();
  }

  private startTunnel(): void {
    mkdirSync(this.toolsDir, { recursive: true });
    const configPath = join(this.toolsDir, "tunnel-config.yml");
    writeFileSync(
      configPath,
      // Isolates Omni's tunnel from ~/.cloudflared. Not empty on purpose:
      // cloudflared logs an empty config file as an error.
      "# Omni tunnel config\nno-autoupdate: true\n",
    );
    this.tunnel = new CloudflaredTunnel({
      binary: () => this.binary.resolve(),
      mode: { kind: "quick", originUrl: `http://127.0.0.1:${this.server.port}` },
      configPath,
      onStatus: () => {
        // The public URL feeds the pairing QR, so refresh both views.
        this.emit();
        this.server.emitDevicesChanged();
      },
    });
    this.tunnel.start();
  }

  private async stopNow(): Promise<void> {
    const tunnel = this.tunnel;
    this.tunnel = null;
    await tunnel?.stop();
    await this.server.stop();
  }

  /** Switch transports; persists the choice and rebinds from scratch. */
  setTransport(transport: RemoteTransport): Promise<void> {
    if (!isTransport(transport)) return Promise.reject(new Error("Unknown transport"));
    return this.enqueue(async () => {
      if (transport === this.transport) return;
      try {
        mkdirSync(this.options.userDataPath, { recursive: true });
        writeFileSync(this.settingsPath, JSON.stringify({ transport }, null, 2));
      } catch (error) {
        console.warn("[Remote] failed to save transport setting:", error);
      }
      // A pending code's QR points at the old address; don't leave it live.
      this.server.cancelPairingOffer();
      await this.stopNow();
      this.transport = transport;
      await this.startNow();
    });
  }

  publicUrl(): string | null {
    if (this.transport !== "tailscale") return this.tunnel?.url ?? null;
    const host = this.server.getAdvertisedHost();
    return host ? `http://${host}:${this.server.port}` : null;
  }

  getInfo(): RemoteServerInfo {
    const serving = this.server.isServing();
    return {
      enabled: true,
      serving,
      transport: this.transport,
      publicUrl: serving ? this.publicUrl() : null,
      tunnel: this.tunnel?.status ?? { state: "stopped" },
      host: serving && this.transport === "tailscale" ? this.server.getAdvertisedHost() : null,
      port: serving ? this.server.port : null,
    };
  }

  /** After sleep, don't sit out a long backoff before reconnecting. */
  onResume(): void {
    this.tunnel?.retryNow();
  }

  dispose(): Promise<void> {
    return this.enqueue(() => this.stopNow());
  }

  private emit(): void {
    this.options.onInfoChanged?.(this.getInfo());
  }
}
