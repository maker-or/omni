import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { RemoteDevicesState } from "../contracts/remote.ts";

vi.mock("./projects.ts", () => ({
  listProjects: () => [{ id: "p1", name: "Demo", path: "/work/demo" }],
  getProject: (id: string) =>
    id === "p1" ? { id: "p1", name: "Demo", path: "/work/demo" } : undefined,
}));
const listRegisteredAgents = vi.fn((): unknown[] => []);
// New tasks are validated against live agent instances.
const DEFAULT_INSTANCES = [{ id: "codex-acp", name: "codex", displayName: "Codex" }];
const listAgentInstanceDescriptors = vi.fn((): unknown[] => DEFAULT_INSTANCES);
vi.mock("./agents/registry.ts", () => ({ listRegisteredAgents: () => listRegisteredAgents() }));
vi.mock("./agent-instances.ts", () => ({
  listAgentInstanceDescriptors: () => listAgentInstanceDescriptors(),
}));
vi.mock("./threads.ts", () => ({ listThreads: () => [], getThread: () => undefined }));
vi.mock("./worktree-manager.ts", () => ({
  createWorktree: () => ({ path: "/work/demo-wt", branch: "phone-test" }),
  gitBinary: () => "git",
  isLiveWorktree: () => true,
  removeWorktreeBestEffort: () => undefined,
}));
vi.mock("./siri/siri-catalog.ts", () => ({
  buildSiriCatalog: () => ({ defaultAgentId: "codex-acp", projects: [], agents: [] }),
}));

const { RemoteServer } = await import("./remote-server.ts");
const { RemoteDeviceStore } = await import("./remote-devices.ts");
/** Smallest valid PNG header + padding: enough for content sniffing. */
const PNG_BASE64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]).toString("base64");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

describe("RemoteServer security", () => {
  let dir: string;
  let server: InstanceType<typeof RemoteServer>;
  let base: string;
  let agent: { createThread: ReturnType<typeof vi.fn>; sendPrompt: ReturnType<typeof vi.fn> };
  let devicesChanged: Mock<(state: RemoteDevicesState) => void>;
  let TOKEN: string;
  let authed: Record<string, string>;

  /** Pair a device through the real code flow and return its token. */
  async function pair(scopes: Array<"read" | "run">, deviceName = "Test phone") {
    const offer = server.createPairingOffer(scopes);
    const res = await fetch(`${base}/api/remote/pair`, {
      method: "POST",
      body: JSON.stringify({ code: offer.code, deviceName }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { token: string }).token;
  }

  beforeEach(async () => {
    vi.stubEnv("PIPPER_REMOTE_HOST", "127.0.0.1");
    dir = mkdtempSync(join(tmpdir(), "remote-server-"));
    const rendererDir = join(dir, "renderer");
    mkdirSync(join(rendererDir, "assets"), { recursive: true });
    writeFileSync(join(rendererDir, "remote.html"), "<!doctype html><title>Remote</title>");
    writeFileSync(join(rendererDir, "assets", "app.js"), "console.log('ok')");
    writeFileSync(join(dir, "secret.txt"), "do not serve");
    agent = {
      createThread: vi.fn(async () => ({
        id: "t1",
        project_id: "p1",
        worktree_path: "/work/demo-wt",
        title: "task",
        last_used_at: 0,
      })),
      sendPrompt: vi.fn(async () => undefined),
    };
    const port = await freePort();
    devicesChanged = vi.fn<(state: RemoteDevicesState) => void>();
    server = new RemoteServer(
      {
        agentManager: () =>
          ({
            ...agent,
            getRunningThreadIds: () => [],
            getThreadTranscript: () => ({ finalText: null, messages: [] }),
          }) as never,
        getUserDataPath: () => dir,
        getRendererDir: () => rendererDir,
        devices: new RemoteDeviceStore(new DatabaseSync(":memory:")),
        onDevicesChanged: devicesChanged,
      },
      { port },
    );
    await server.start();
    base = `http://127.0.0.1:${port}`;
    TOKEN = await pair(["read", "run"]);
    authed = { Authorization: `Bearer ${TOKEN}` };
  });

  afterEach(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("pairs with a one-time code that cannot be reused", async () => {
    const offer = server.createPairingOffer(["read", "run"]);
    expect(offer.code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    // The code rides in the URL fragment, never in a path or query.
    expect(offer.pairingUrl).toContain(`/remote#pair=${offer.code.replace("-", "")}`);
    const first = await fetch(`${base}/api/remote/pair`, {
      method: "POST",
      body: JSON.stringify({ code: offer.code.toLowerCase(), deviceName: "Pixel" }),
    });
    expect(first.status).toBe(201);
    const { token, device } = (await first.json()) as {
      token: string;
      device: { name: string; scopes: string[] };
    };
    expect(device).toMatchObject({ name: "Pixel", scopes: ["read", "run"] });
    const reuse = await fetch(`${base}/api/remote/pair`, {
      method: "POST",
      body: JSON.stringify({ code: offer.code }),
    });
    expect(reuse.status).toBe(401);
    const session = await fetch(`${base}/api/remote/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(session.status).toBe(200);
    expect(server.getDevicesState().devices.map((d) => d.name)).toContain("Pixel");
    expect(devicesChanged).toHaveBeenCalled();
  });

  it("describes the laptop for a valid code without using the code up", async () => {
    const offer = server.createPairingOffer(["read", "run"]);
    const preview = await fetch(`${base}/api/remote/pair/preview`, {
      method: "POST",
      body: JSON.stringify({ code: offer.code }),
    });
    expect(preview.status).toBe(200);
    const { laptop } = (await preview.json()) as {
      laptop: { name: string; host: string | null; attestation: string | null };
    };
    expect(laptop.name.length).toBeGreaterThan(0);
    expect(laptop.attestation).toBeNull();
    // Still redeemable afterwards, and the pairing reply names the laptop too.
    const pair = await fetch(`${base}/api/remote/pair`, {
      method: "POST",
      body: JSON.stringify({ code: offer.code }),
    });
    expect(pair.status).toBe(201);
    expect(((await pair.json()) as { laptop: unknown }).laptop).toEqual(laptop);
  });

  it("won't describe the laptop without a valid code", async () => {
    server.createPairingOffer(["read"]);
    const res = await fetch(`${base}/api/remote/pair/preview`, {
      method: "POST",
      body: JSON.stringify({ code: "WRONG-CODE0" }),
    });
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("attestation");
  });

  it("offers each provider account to the phone, grouped by provider", async () => {
    listRegisteredAgents.mockReturnValue([
      { id: "codex-acp", name: "codex", displayName: "Codex" },
    ]);
    listAgentInstanceDescriptors.mockReturnValue([
      { id: "codex-acp", name: "codex", displayName: "Codex", driverId: "codex-acp" },
      { id: "codex-acp:work", name: "codex", displayName: "Codex (work)", driverId: "codex-acp" },
    ]);
    const res = await fetch(`${base}/api/remote/models`, { headers: authed });
    expect(await res.json()).toEqual({
      models: [
        { id: "codex-acp", name: "Codex", provider: "Codex" },
        { id: "codex-acp:work", name: "Codex (work)", provider: "Codex" },
      ],
    });
  });

  it("revokes one device without affecting the others", async () => {
    const other = await pair(["read", "run"], "Second phone");
    const secondId = server.getDevicesState().devices.find((d) => d.name === "Second phone")!.id;
    expect(server.revokeDevice(secondId)).toBe(true);
    const revoked = await fetch(`${base}/api/remote/projects`, {
      headers: { Authorization: `Bearer ${other}` },
    });
    expect(revoked.status).toBe(401);
    expect((await fetch(`${base}/api/remote/projects`, { headers: authed })).status).toBe(200);
  });

  it("lets a phone unpair itself", async () => {
    const res = await fetch(`${base}/api/remote/session`, { method: "DELETE", headers: authed });
    expect(res.status).toBe(200);
    expect((await fetch(`${base}/api/remote/projects`, { headers: authed })).status).toBe(401);
  });

  it("keeps read-only devices away from starting work", async () => {
    const reader = { Authorization: `Bearer ${await pair(["read"], "Reader")}` };
    expect((await fetch(`${base}/api/remote/threads`, { headers: reader })).status).toBe(200);
    const start = await fetch(`${base}/api/remote/threads`, {
      method: "POST",
      headers: reader,
      body: JSON.stringify({ projectId: "p1", prompt: "do it" }),
    });
    expect(start.status).toBe(403);
    expect(agent.createThread).not.toHaveBeenCalled();
  });

  it("stops a client that keeps guessing pairing codes", async () => {
    const offer = server.createPairingOffer(["read", "run"]);
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${base}/api/remote/pair`, {
        method: "POST",
        body: JSON.stringify({ code: "WRONG-CODE0" }),
      });
      expect(res.status).toBe(401);
    }
    // Past the limit even the right code is refused, so guessing can't continue.
    const limited = await fetch(`${base}/api/remote/pair`, {
      method: "POST",
      body: JSON.stringify({ code: offer.code }),
    });
    expect(limited.status).toBe(429);
  });

  it("reports serving and advertises only a bound host once start resolves", () => {
    expect(server.isServing()).toBe(true);
    expect(server.getAdvertisedHost()).toBe("127.0.0.1");
  });

  it("rejects missing, wrong, and near-miss tokens", async () => {
    for (const header of [undefined, "Bearer wrong", `Bearer ${TOKEN}x`, `Basic ${TOKEN}`]) {
      const res = await fetch(`${base}/api/remote/projects`, {
        headers: header ? { Authorization: header } : {},
      });
      expect(res.status).toBe(401);
    }
    const ok = await fetch(`${base}/api/remote/projects`, { headers: authed });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });

  it("requires the token for health and the phone debug log", async () => {
    expect((await fetch(`${base}/api/remote/health`)).status).toBe(401);
    const log = await fetch(`${base}/api/remote/debug-log`, { method: "POST", body: "hi" });
    expect(log.status).toBe(401);
    expect((await fetch(`${base}/api/remote/health`, { headers: authed })).status).toBe(200);
  });

  it("throttles repeated bad tokens without locking out the paired phone", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${base}/api/remote/projects`, {
        headers: { Authorization: "Bearer guess" },
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10).every((s) => s === 429)).toBe(true);
    const phone = await fetch(`${base}/api/remote/projects`, { headers: authed });
    expect(phone.status).toBe(200);
  });

  it("rejects oversized and malformed bodies with client errors", async () => {
    const big = await fetch(`${base}/api/remote/debug-log`, {
      method: "POST",
      headers: authed,
      body: "x".repeat(600_000),
    });
    expect(big.status).toBe(413);
    const bad = await fetch(`${base}/api/remote/threads`, {
      method: "POST",
      headers: authed,
      body: "{not json",
    });
    expect(bad.status).toBe(400);
  });

  it("returns a generic error instead of internal details", async () => {
    agent.createThread.mockRejectedValueOnce(new Error("/Users/secret/path exploded"));
    const res = await fetch(`${base}/api/remote/threads`, {
      method: "POST",
      headers: authed,
      body: JSON.stringify({ projectId: "p1", prompt: "do it" }),
    });
    expect(res.ok).toBe(false);
    const text = await res.text();
    expect(text).not.toContain("/Users/secret");
  });

  it("forwards validated images with the prompt", async () => {
    const res = await fetch(`${base}/api/remote/threads`, {
      method: "POST",
      headers: authed,
      body: JSON.stringify({
        projectId: "p1",
        prompt: "what is wrong here?",
        images: [{ data: PNG_BASE64, mimeType: "image/png" }],
      }),
    });
    expect(res.status).toBe(202);
    await vi.waitFor(() => expect(agent.sendPrompt).toHaveBeenCalled());
    expect(agent.sendPrompt.mock.calls[0]?.[0]).toMatchObject({
      threadId: "t1",
      message: "what is wrong here?",
      images: [{ data: PNG_BASE64, mimeType: "image/png" }],
    });
  });

  it("rejects non-images, disguised files, and too many images before any work starts", async () => {
    const disguised = Buffer.from("#!/bin/sh\nrm -rf ~\n").toString("base64");
    const png = { data: PNG_BASE64, mimeType: "image/png" };
    for (const images of [
      [{ data: disguised, mimeType: "image/png" }],
      [{ data: PNG_BASE64, mimeType: "application/pdf" }],
      [{ data: PNG_BASE64, mimeType: "image/jpeg" }],
      [{ data: "not base64!", mimeType: "image/png" }],
      Array.from({ length: 6 }, () => png),
    ]) {
      const res = await fetch(`${base}/api/remote/threads`, {
        method: "POST",
        headers: authed,
        body: JSON.stringify({ projectId: "p1", prompt: "look", images }),
      });
      expect(res.status).toBe(400);
    }
    expect(agent.createThread).not.toHaveBeenCalled();
  });

  it("accepts image-sized prompt bodies", async () => {
    const big = Buffer.alloc(3 * 1024 * 1024);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(big);
    const res = await fetch(`${base}/api/remote/threads`, {
      method: "POST",
      headers: authed,
      body: JSON.stringify({
        projectId: "p1",
        prompt: "screenshot",
        images: [{ data: big.toString("base64"), mimeType: "image/png" }],
      }),
    });
    expect(res.status).toBe(202);
  });

  it("caps how fast tasks can start", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      const res = await fetch(`${base}/api/remote/threads`, {
        method: "POST",
        headers: authed,
        body: JSON.stringify({ projectId: "p1", prompt: `task ${i}` }),
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 60).every((s) => s === 202)).toBe(true);
    expect(statuses[60]).toBe(429);
    expect(agent.createThread).toHaveBeenCalledTimes(60);
  });

  it("serves the PWA with a CSP and never serves files outside the renderer dir", async () => {
    const page = await fetch(`${base}/remote`);
    expect(page.status).toBe(200);
    const head = await fetch(`${base}/remote`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect((await fetch(`${base}/assets/app.js`)).status).toBe(200);
    for (const path of ["/assets/../../secret.txt", "/assets/%2e%2e/%2e%2e/secret.txt"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("do not serve");
    }
  });
});
