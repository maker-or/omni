import { afterAll, describe, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as acp from "@agentclientprotocol/sdk";

vi.mock("electron", () => ({
  app: {
    getPath: () => process.env.PIPPER_LIBRARY_PATH ?? process.env.TMPDIR ?? "/tmp",
    connect: vi.fn(),
  },
}));

import { AgentConnectionManager } from "./agent-connection-manager.ts";
import { ActivationSupersededError } from "./activation.ts";
import { createProject } from "./projects.ts";
import { createThread } from "./threads.ts";
import { listRegisteredAgents } from "./agents/registry.ts";
import type { LiveConnection } from "./connection-lifecycle.ts";
import type { AcpBridgeEvent } from "../contracts/acp.ts";

// One library root for the file: db.ts caches its handle on first use.
const root = mkdtempSync(join(tmpdir(), "pipper-provider-activation-"));
process.env.PIPPER_LIBRARY_PATH = root;
process.env.PIPPER_THREAD_SNAPSHOTS = "0";

afterAll(async () => {
  const { closeDb } = await import("./db.ts");
  closeDb();
  delete process.env.PIPPER_LIBRARY_PATH;
  delete process.env.PIPPER_THREAD_SNAPSHOTS;
  rmSync(root, { recursive: true, force: true });
});

const [FAST, SLOW] = listRegisteredAgents().map((agent) => agent.id);

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface FakeProvider {
  requests: Array<{ method: string; params: Record<string, unknown> }>;
  /** When set, session/load waits for it. */
  loadGate: Promise<void> | null;
}

/**
 * A manager whose providers are scripted in-process: no processes are
 * spawned. `initializeGates` delays a provider's acquisition the way a slow
 * `initialize` handshake would.
 */
function makeManager(options: { initializeGates?: Record<string, Promise<void>> } = {}) {
  const events: AcpBridgeEvent[] = [];
  const manager = new AgentConnectionManager({
    sendToRenderer: (event: AcpBridgeEvent) => events.push(event),
    setWindowTitle: () => {},
    catalogPath: join(mkdtempSync(join(root, "catalog-")), "provider-catalogs.json"),
  });
  const providers = new Map<string, FakeProvider>();
  const lives = new Map<string, LiveConnection>();
  let sessionCounter = 0;
  const providerFor = (agentId: string): FakeProvider => {
    let provider = providers.get(agentId);
    if (!provider) {
      provider = { requests: [], loadGate: null };
      providers.set(agentId, provider);
    }
    return provider;
  };
  const acquire = vi.fn(async (agentId: string) => {
    await options.initializeGates?.[agentId];
    let live = lives.get(agentId);
    if (live) return live;
    const provider = providerFor(agentId);
    live = {
      agentId,
      driverId: agentId,
      agentInfoName: agentId,
      agentCapabilities: {},
      authMethods: [],
      authRequiredMessage: null,
      modelState: null,
      agent: {
        request: async (method: string, params: Record<string, unknown>) => {
          provider.requests.push({ method, params });
          if (method === acp.methods.agent.session.new) {
            return {
              sessionId: `${agentId}-session-${++sessionCounter}`,
              configOptions: [
                {
                  id: "model",
                  name: "Model",
                  category: "model",
                  type: "select",
                  currentValue: "m1",
                  options: [{ value: "m1", name: "Model 1" }],
                },
              ],
            };
          }
          if (method === acp.methods.agent.session.load) {
            await provider.loadGate;
            return {};
          }
          return {};
        },
        notify: async () => undefined,
      },
    } as unknown as LiveConnection;
    lives.set(agentId, live);
    // Register like ConnectionLifecycle would, so ownership lookups work.
    (
      manager as unknown as { lifecycle: { connections: Map<string, LiveConnection> } }
    ).lifecycle.connections.set(agentId, live);
    return live;
  });
  vi.spyOn(manager, "acquireConnection").mockImplementation(acquire);
  const counts = () => manager.getLifecycleResourceCounts();
  return { manager, events, acquire, providerFor, counts };
}

function project(name: string) {
  return createProject({ name, path: join(root, name), icon: "folder" });
}

describe("activation without a global queue (R02)", () => {
  test("a resident switch completes while another provider's initialize is blocked", async () => {
    const slowInitialize = deferred();
    const { manager, acquire } = makeManager({
      initializeGates: { [SLOW]: slowInitialize.promise },
    });
    const p = project("resident-switch");
    const a = await manager.createThread(p.id, "A", null, FAST);
    const b = await manager.createThread(p.id, "B", null, FAST);
    expect(manager.getState().threadId).toBe(b.id);

    // A new thread on a provider whose initialize never answers...
    const slowCreate = manager.createThread(p.id, "Slow", null, SLOW);
    await tick();
    expect(acquire).toHaveBeenCalledWith(SLOW);

    // ...must not delay switching between resident threads.
    const switched = await Promise.race([
      manager.switchThread(a.id).then(() => "switched"),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 1_000)),
    ]);
    expect(switched).toBe("switched");
    expect(manager.getState().threadId).toBe(a.id);

    // The create is durable: it completes once the provider answers, but the
    // user's later switch keeps the selection.
    slowInitialize.resolve();
    const created = await slowCreate;
    expect(manager.getState().threadId).toBe(a.id);
    expect(manager.getLifecycleResourceCounts().sessions).toBe(3);
    expect(created.agent_id).toBe(SLOW);
  });

  test("rapid A→B→A selection picks A and shares one session/load", async () => {
    const { manager, providerFor } = makeManager();
    const p = project("rapid");
    const resident = await manager.createThread(p.id, "B", null, FAST);
    // A exists on disk but is not resident: activating it needs session/load.
    const cold = createThread(p.id, "A", FAST, "persisted-session-a");
    const loadGate = deferred();
    providerFor(FAST).loadGate = loadGate.promise;

    const first = manager.switchThread(cold.id);
    const firstSuperseded = expect(first).rejects.toBeInstanceOf(ActivationSupersededError);
    await tick();
    const second = manager.switchThread(resident.id);
    const secondSuperseded = expect(second).rejects.toBeInstanceOf(ActivationSupersededError);
    const third = manager.switchThread(cold.id);

    await firstSuperseded;
    await secondSuperseded;
    loadGate.resolve();
    await third;

    expect(manager.getState().threadId).toBe(cold.id);
    const loads = providerFor(FAST).requests.filter(
      (request) => request.method === acp.methods.agent.session.load,
    );
    expect(loads).toHaveLength(1);
  });

  test("a superseded load is adopted, and deleting the thread waits for it and cleans up", async () => {
    const { manager, providerFor, counts } = makeManager();
    const p = project("late-load");
    const other = await manager.createThread(p.id, "Other", null, FAST);
    const baseline = counts();
    const cold = createThread(p.id, "Late", FAST, "persisted-session-late");
    const loadGate = deferred();
    providerFor(FAST).loadGate = loadGate.promise;

    const switching = manager.switchThread(cold.id);
    const superseded = expect(switching).rejects.toBeInstanceOf(ActivationSupersededError);
    await tick();
    await manager.switchThread(other.id);
    await superseded;

    // The load answers after its caller gave up: the runtime adopts it.
    const deleting = manager.deleteThread(cold.id);
    loadGate.resolve();
    await deleting;

    const requests = providerFor(FAST).requests.map((request) => request.method);
    expect(requests).toContain(acp.methods.agent.session.delete);
    expect(manager.getState().threadId).toBe(other.id);
    await tick();
    expect(counts()).toEqual(baseline);
  });

  test("create/close/delete cycles return lifecycle maps to their baseline (R07)", async () => {
    const { manager, counts } = makeManager();
    const p = project("cycles");
    const keep = await manager.createThread(p.id, "Keep", null, FAST);
    const baseline = counts();
    for (let i = 0; i < 5; i++) {
      const thread = await manager.createThread(p.id, `T${i}`, null, FAST);
      await manager.abortThread(thread.id);
      if (i % 2 === 0) await manager.closeThreadSession(thread.id);
      await manager.deleteThread(thread.id);
    }
    await manager.switchThread(keep.id);
    await tick();
    expect(counts()).toEqual(baseline);
  });
});

describe("provider catalogs (R01)", () => {
  test("a cached catalog lookup starts no provider", async () => {
    const catalogPath = join(mkdtempSync(join(root, "cached-")), "provider-catalogs.json");
    writeFileSync(
      catalogPath,
      JSON.stringify({
        version: 1,
        providers: {
          [SLOW]: { models: [{ modelId: "cached", name: "Cached" }], refreshedAt: Date.now() },
        },
      }),
    );
    const manager = new AgentConnectionManager({
      sendToRenderer: () => {},
      setWindowTitle: () => {},
      catalogPath,
    });
    const acquire = vi.spyOn(manager, "acquireConnection");
    const lifecycleAcquire = vi.spyOn(
      (manager as unknown as { lifecycle: { acquire: () => Promise<unknown> } }).lifecycle,
      "acquire",
    );

    const catalogs = await manager.getModelCatalogs();

    expect(catalogs[SLOW]).toEqual([{ modelId: "cached", name: "Cached" }]);
    expect(acquire).not.toHaveBeenCalled();
    expect(lifecycleAcquire).not.toHaveBeenCalled();
  });

  test("concurrent explicit refreshes start the provider once", async () => {
    const { manager, acquire, providerFor } = makeManager();
    const [first, second] = await Promise.all([
      manager.getModelCatalogs({ refresh: [SLOW] }),
      manager.getModelCatalogs({ refresh: [SLOW] }),
    ]);
    expect(acquire).toHaveBeenCalledTimes(1);
    const probes = providerFor(SLOW).requests.filter(
      (request) => request.method === acp.methods.agent.session.new,
    );
    expect(probes).toHaveLength(1);
    expect(first[SLOW]).toEqual([{ modelId: "m1", name: "Model 1" }]);
    expect(second[SLOW]).toEqual(first[SLOW]);
  });

  test("an established session records its catalog for later lookups", async () => {
    const { manager, acquire } = makeManager();
    const p = project("catalog-record");
    await manager.createThread(p.id, "T", null, FAST);
    acquire.mockClear();
    const catalogs = await manager.getModelCatalogs();
    expect(catalogs[FAST]).toEqual([{ modelId: "m1", name: "Model 1" }]);
    expect(acquire).not.toHaveBeenCalled();
  });
});
