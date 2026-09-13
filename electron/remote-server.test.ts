import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The remote server reaches into SQLite-backed modules; stub them so the test
// exercises the HTTP contract the phone apps depend on, not the database.
const catalog = {
  version: 1 as const,
  updatedAt: "2026-09-13T00:00:00.000Z",
  defaultAgentId: "codex-acp",
  projects: [{ id: "p1", name: "FolkLore", path: "/tmp/folklore" }],
  agents: [
    { id: "codex-acp", displayName: "Codex", available: true },
    { id: "opencode-acp", displayName: "opencode", available: false },
  ],
};

vi.mock("./siri/siri-catalog.ts", () => ({ buildSiriCatalog: () => catalog }));
vi.mock("./projects.ts", () => ({
  listProjects: () => catalog.projects,
  getProject: (id: string) => catalog.projects.find((p) => p.id === id) ?? null,
}));
vi.mock("./agents/registry.ts", () => ({
  listRegisteredAgents: () => catalog.agents.map((a) => ({ id: a.id, displayName: a.displayName })),
}));
vi.mock("./threads.ts", () => ({ listThreads: () => [], getThread: () => null }));
vi.mock("./worktree-manager.ts", () => ({
  createWorktree: () => {
    throw new Error("not in test");
  },
  removeWorktree: () => {},
  gitBinary: () => "git",
}));

import { RemoteServer } from "./remote-server.ts";

let userData: string;
let server: RemoteServer;
let base: string;

beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), "pipper-remote-test-"));
  server = new RemoteServer(
    {
      agentManager: () => null,
      getUserDataPath: () => userData,
      getRendererDir: () => userData,
    },
    { port: 0, token: "test-token" },
  );
  // Bind loopback on an ephemeral port; read the real port back from the socket.
  process.env.PIPPER_REMOTE_HOST = "127.0.0.1";
  server.start();
  const bound = await new Promise<number>((resolve) => {
    const s = (server as unknown as { servers: import("node:http").Server[] }).servers[0]!;
    s.once("listening", () => resolve((s.address() as { port: number }).port));
  });
  base = `http://127.0.0.1:${bound}`;
});

afterEach(async () => {
  delete process.env.PIPPER_REMOTE_HOST;
  await server.stop();
  rmSync(userData, { recursive: true, force: true });
});

describe("GET /api/remote/catalog", () => {
  it("requires the pairing token", async () => {
    const res = await fetch(`${base}/api/remote/catalog`);
    expect(res.status).toBe(401);
  });

  it("returns the same catalog Siri reads on the Mac, uncached", async () => {
    const res = await fetch(`${base}/api/remote/catalog`, {
      headers: { Authorization: "Bearer test-token" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual(catalog);
  });

  it("is a live paired-phone signal for standby", async () => {
    const seen: boolean[] = [];
    const s = new RemoteServer(
      {
        agentManager: () => null,
        getUserDataPath: () => userData,
        getRendererDir: () => userData,
        onRemoteActiveChanged: (active) => seen.push(active),
      },
      { port: 0, token: "t2" },
    );
    s.start();
    const port = await new Promise<number>((resolve) => {
      const h = (s as unknown as { servers: import("node:http").Server[] }).servers[0]!;
      h.once("listening", () => resolve((h.address() as { port: number }).port));
    });
    try {
      await fetch(`http://127.0.0.1:${port}/api/remote/catalog`, {
        headers: { Authorization: "Bearer t2" },
      });
      expect(seen).toContain(true);
      expect(s.hasLiveLease()).toBe(true);
    } finally {
      await s.stop();
    }
  });
});
