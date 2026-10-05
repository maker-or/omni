import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteServerInfo } from "../contracts/remote.ts";
import { writeFakeCloudflared } from "./cloudflared-test-fixtures.ts";

vi.mock("./projects.ts", () => ({ listProjects: () => [], getProject: () => undefined }));
vi.mock("./agents/registry.ts", () => ({ listRegisteredAgents: () => [] }));
vi.mock("./threads.ts", () => ({ listThreads: () => [], getThread: () => undefined }));
vi.mock("./worktree-manager.ts", () => ({
  createWorktree: () => {
    throw new Error("unused");
  },
  gitBinary: () => "git",
  removeWorktreeBestEffort: () => undefined,
}));

const { RemoteAccessController } = await import("./remote-access.ts");
const { RemoteDeviceStore } = await import("./remote-devices.ts");

const TUNNEL_URL = "https://quiet-fox-1234.trycloudflare.com";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as net.AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

describe.skipIf(process.platform === "win32")("remote access controller", () => {
  let dir: string;
  let fake: string;
  let infos: RemoteServerInfo[];
  const controllers: Array<InstanceType<typeof RemoteAccessController>> = [];

  beforeEach(() => {
    vi.stubEnv("PIPPER_REMOTE_HOST", "127.0.0.1");
    vi.stubEnv("PIPPER_REMOTE_TRANSPORT", "");
    dir = mkdtempSync(join(tmpdir(), "remote-access-"));
    fake = writeFakeCloudflared(mkdtempSync(join(dir, "bin-")));
    infos = [];
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(controllers.splice(0).map((c) => c.dispose()));
    rmSync(dir, { recursive: true, force: true });
  });

  async function make() {
    const controller = new RemoteAccessController({
      userDataPath: dir,
      port: await freePort(),
      serverDeps: {
        agentManager: () => null,
        getUserDataPath: () => dir,
        getRendererDir: () => dir,
        devices: new RemoteDeviceStore(new DatabaseSync(":memory:")),
      },
      cloudflared: { overridePath: fake },
      onInfoChanged: (info) => infos.push(info),
    });
    controllers.push(controller);
    return controller;
  }

  it("serves over Tailscale by default", async () => {
    const access = await make();
    await access.start();
    const info = access.getInfo();
    expect(info.transport).toBe("tailscale");
    expect(info.publicUrl).toBe(`http://127.0.0.1:${info.port}`);
    expect(info.tunnel).toEqual({ state: "stopped" });
  });

  it("switches to a Cloudflare tunnel, remembers it, and pairs over https", async () => {
    const access = await make();
    await access.start();
    await access.setTransport("cloudflare-quick");
    await vi.waitFor(() => expect(access.getInfo().publicUrl).toBe(TUNNEL_URL));
    expect(access.getInfo().tunnel).toEqual({ state: "connected", url: TUNNEL_URL });
    expect(infos.at(-1)?.publicUrl).toBe(TUNNEL_URL);
    // Loopback only: no tailnet address is advertised in tunnel mode.
    expect(access.server.getAdvertisedHost()).toBeNull();
    const offer = access.server.createPairingOffer(["read", "run"]);
    expect(offer.pairingUrl).toMatch(
      new RegExp(`^${TUNNEL_URL.replace(/\./g, "\\.")}/remote#pair=[0-9A-Z]{10}$`),
    );
    expect(JSON.parse(readFileSync(join(dir, "remote-access.json"), "utf8"))).toEqual({
      transport: "cloudflare-quick",
    });
    await access.dispose();

    const relaunched = await make();
    await relaunched.start();
    expect(relaunched.getInfo().transport).toBe("cloudflare-quick");
  });

  it("stops the tunnel and cancels a pending code when switching back", async () => {
    const access = await make();
    await access.start();
    await access.setTransport("cloudflare-quick");
    await vi.waitFor(() => expect(access.getInfo().publicUrl).toBe(TUNNEL_URL));
    access.server.createPairingOffer(["read"]);
    await access.setTransport("tailscale");
    expect(access.getInfo().tunnel).toEqual({ state: "stopped" });
    expect(access.server.getDevicesState().offer).toBeNull();
    expect(access.getInfo().publicUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });

  it("rate-limits failed auth per Cloudflare client, not for everyone behind the tunnel", async () => {
    const access = await make();
    await access.start();
    await access.setTransport("cloudflare-quick");
    const url = `http://127.0.0.1:${access.getInfo().port}/api/remote/projects`;
    const hit = (ip: string) =>
      fetch(url, { headers: { Authorization: "Bearer nope", "CF-Connecting-IP": ip } });
    for (let i = 0; i < 10; i++) expect((await hit("203.0.113.7")).status).toBe(401);
    expect((await hit("203.0.113.7")).status).toBe(429);
    expect((await hit("198.51.100.4")).status).toBe(401);
  });
});
