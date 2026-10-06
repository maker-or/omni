import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteServerInfo } from "../contracts/remote.ts";
import { writeFakeCloudflared } from "./cloudflared-test-fixtures.ts";

vi.mock("./projects.ts", () => ({ listProjects: () => [], getProject: () => undefined }));
vi.mock("./agents/registry.ts", () => ({ listRegisteredAgents: () => [] }));
vi.mock("./agent-instances.ts", () => ({ listAgentInstanceDescriptors: () => [] }));
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
    // A real page, so a 404 for /remote can only mean "API-only".
    writeFileSync(join(dir, "remote.html"), "<!doctype html><title>Remote</title>");
    infos = [];
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(controllers.splice(0).map((c) => c.dispose()));
    rmSync(dir, { recursive: true, force: true });
  });

  async function make(
    extra: Partial<ConstructorParameters<typeof RemoteAccessController>[0]> = {},
  ) {
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
      ...extra,
    });
    controllers.push(controller);
    return controller;
  }

  it("says why it can't serve when another app holds the port", async () => {
    const port = await freePort();
    const squatter = net.createServer();
    await new Promise<void>((r) => squatter.listen(port, "127.0.0.1", () => r()));
    try {
      const access = new RemoteAccessController({
        userDataPath: dir,
        port,
        serverDeps: {
          agentManager: () => null,
          getUserDataPath: () => dir,
          getRendererDir: () => dir,
          devices: new RemoteDeviceStore(new DatabaseSync(":memory:")),
        },
      });
      controllers.push(access);
      await access.start();
      const info = access.getInfo();
      expect(info.serving).toBe(false);
      expect(info.error).toMatch(new RegExp(`Port ${port} is already in use`));
    } finally {
      await new Promise<void>((r) => squatter.close(() => r()));
    }
  });

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
    await vi.waitFor(() => expect(access.getInfo().publicUrl).toBe(TUNNEL_URL), { timeout: 5_000 });
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
    await vi.waitFor(() => expect(access.getInfo().publicUrl).toBe(TUNNEL_URL), { timeout: 5_000 });
    access.server.createPairingOffer(["read"]);
    await access.setTransport("tailscale");
    expect(access.getInfo().tunnel).toEqual({ state: "stopped" });
    expect(access.server.getDevicesState().offer).toBeNull();
    expect(access.getInfo().publicUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });

  it("runs this laptop's named tunnel from pipper.dev at a fixed https address", async () => {
    const requests: Array<{ auth: string | undefined; body: string }> = [];
    const pipper = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        requests.push({ auth: req.headers.authorization, body });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ hostname: "labc123.pipper-remote.dev", token: "connector-token" }),
        );
      });
    });
    await new Promise<void>((r) => pipper.listen(0, "127.0.0.1", () => r()));
    const argsFile = join(dir, "args.txt");
    vi.stubEnv("FAKE_CF_ARGS", argsFile);
    try {
      let credential: string | null = null;
      const access = await make({
        getLaptopCredential: () => credential,
        pipperApiBase: `http://127.0.0.1:${(pipper.address() as net.AddressInfo).port}`,
      });
      await access.start();
      await access.setTransport("cloudflare");
      // Signed out: the tunnel waits for sign-in instead of retrying forever.
      await vi.waitFor(() =>
        expect(access.getInfo().tunnel).toEqual({
          state: "error",
          message: "Sign in to Pipper to use the Cloudflare tunnel.",
        }),
      );
      expect(requests).toHaveLength(0);

      credential = "pl1.laptop.credential";
      await access.onCredentialChanged();
      await vi.waitFor(() =>
        expect(access.getInfo().publicUrl).toBe("https://labc123.pipper-remote.dev"),
      );
      expect(requests[0]).toEqual({
        auth: "Bearer pl1.laptop.credential",
        body: JSON.stringify({ port: access.getInfo().port }),
      });
      const offer = access.server.createPairingOffer(["read"]);
      // Named tunnels pair through the hosted app, which then calls this host.
      expect(offer.pairingUrl).toMatch(
        /^https:\/\/remote\.pipper\.dev\/#pair=[0-9A-Z]{10}&host=labc123\.pipper-remote\.dev$/,
      );
      const args = readFileSync(argsFile, "utf8");
      expect(args).toContain("tunnel --no-autoupdate --config");
      expect(args.split("\n")[0]).toMatch(/ run$/);
      expect(args.split("\n")[0]).not.toContain("connector-token");
      expect(args).toContain("token=connector-token");
    } finally {
      await new Promise<void>((r) => pipper.close(() => r()));
    }
  });

  it("runs a developer-supplied tunnel without asking pipper.dev", async () => {
    const access = await make({
      getLaptopCredential: () => null,
      pipperApiBase: "http://127.0.0.1:9", // must never be contacted
      devTunnel: { token: "dev-connector-token", hostname: "remote.example.dev" },
    });
    await access.start();
    await access.setTransport("cloudflare");
    await vi.waitFor(() => expect(access.getInfo().publicUrl).toBe("https://remote.example.dev"), {
      timeout: 5_000,
    });
  });

  it("locks a named-tunnel laptop to the API and the hosted app's origin", async () => {
    const access = await make({
      devTunnel: { token: "dev-connector-token", hostname: "lt-dev.example.dev" },
      remoteAppUrl: "https://remote.example.dev/",
    });
    await access.start();
    await access.setTransport("cloudflare");
    const base = `http://127.0.0.1:${access.getInfo().port}`;
    const app = "https://remote.example.dev";

    // API-only: the phone app is never served from a laptop hostname.
    expect((await fetch(`${base}/remote`)).status).toBe(404);

    // Preflight: allowed for the hosted app, refused for anyone else.
    const preflight = await fetch(`${base}/api/remote/session`, {
      method: "OPTIONS",
      headers: { Origin: app, "Access-Control-Request-Method": "GET" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(app);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("Authorization");
    const foreign = await fetch(`${base}/api/remote/session`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" },
    });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();

    // Errors stay readable by the hosted app, so it can notice it was unpaired.
    const unauthorized = await fetch(`${base}/api/remote/session`, { headers: { Origin: app } });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("access-control-allow-origin")).toBe(app);
    const other = await fetch(`${base}/api/remote/session`, {
      headers: { Origin: "https://evil.example" },
    });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("keeps serving the app itself (and no CORS) over Tailscale", async () => {
    const access = await make({ remoteAppUrl: "https://remote.example.dev" });
    await access.start();
    const base = `http://127.0.0.1:${access.getInfo().port}`;
    expect((await fetch(`${base}/remote`)).status).toBe(200);
    const res = await fetch(`${base}/api/remote/session`, {
      headers: { Origin: "https://remote.example.dev" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(access.server.createPairingOffer(["read"]).pairingUrl).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/remote#pair=/,
    );
  });

  it("starting twice runs one connector, and dispose stops it", async () => {
    const pidsFile = join(dir, "pids.txt");
    vi.stubEnv("FAKE_CF_PIDS", pidsFile);
    vi.stubEnv("PIPPER_REMOTE_TRANSPORT", "cloudflare-quick");
    const access = await make();
    await Promise.all([access.start(), access.start()]);
    await access.start();
    await vi.waitFor(() => expect(access.getInfo().publicUrl).toBe(TUNNEL_URL), {
      timeout: 5_000,
    });
    const pids = readFileSync(pidsFile, "utf8").trim().split("\n").map(Number);
    expect(pids).toHaveLength(1);
    await access.dispose();
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    await vi.waitFor(() => expect(pids.filter(alive)).toEqual([]), { timeout: 5_000 });
    // And it stays down: nothing is left to restart it.
    await new Promise((r) => setTimeout(r, 300));
    expect(readFileSync(pidsFile, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("restarts a connected tunnel when another account signs in", async () => {
    const pidsFile = join(dir, "switch-pids.txt");
    vi.stubEnv("FAKE_CF_PIDS", pidsFile);
    const access = await make({
      devTunnel: { token: "dev-connector-token", hostname: "lt-dev.example.dev" },
    });
    await access.start();
    await access.setTransport("cloudflare");
    await vi.waitFor(() => expect(access.getInfo().tunnel.state).toBe("connected"), {
      timeout: 5_000,
    });
    await access.onCredentialChanged();
    await vi.waitFor(
      () => {
        expect(readFileSync(pidsFile, "utf8").trim().split("\n")).toHaveLength(2);
        expect(access.getInfo().tunnel.state).toBe("connected");
      },
      { timeout: 5_000 },
    );
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
