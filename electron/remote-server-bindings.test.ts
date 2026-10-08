import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const { RemoteServer } = await import("./remote-server.ts");
const { RemoteDeviceStore } = await import("./remote-devices.ts");

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

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
}

describe("remote server listeners follow the network", () => {
  const dir = mkdtempSync(join(tmpdir(), "remote-bind-"));
  let server: InstanceType<typeof RemoteServer> | null = null;

  afterEach(async () => {
    await server?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves a tailnet address that appears after launch, and drops it when it goes", async () => {
    // "::1" stands in for a tailnet address: a real 100.x can't be bound here.
    let tailnet: string[] = [];
    const port = await freePort();
    server = new RemoteServer(
      {
        agentManager: () => null,
        getUserDataPath: () => dir,
        getRendererDir: () => dir,
        devices: new RemoteDeviceStore(new DatabaseSync(":memory:")),
        listTailscaleIps: () => tailnet,
      },
      { port },
    );
    await server.start();
    const viaTailnet = `http://[::1]:${port}/api/remote/health`;
    expect(await reachable(viaTailnet)).toBe(false);
    expect(await server.refreshBindings()).toBe(false);

    tailnet = ["::1"];
    expect(await server.refreshBindings()).toBe(true);
    expect(await reachable(viaTailnet)).toBe(true);
    expect(await server.refreshBindings()).toBe(false); // idempotent

    tailnet = [];
    expect(await server.refreshBindings()).toBe(true);
    expect(await reachable(viaTailnet)).toBe(false);
    // Loopback is never dropped.
    expect(await reachable(`http://127.0.0.1:${port}/api/remote/health`)).toBe(true);
  });
});
