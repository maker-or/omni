import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

const mocks = vi.hoisted(() => ({
  threads: new Map<
    string,
    {
      id: string;
      project_id: string;
      worktree_path: string | null;
      title: string;
      last_used_at: number;
    }
  >(),
  createWorktree: vi.fn(),
  removeWorktreeBestEffort: vi.fn(),
  isLiveWorktree: vi.fn(),
}));
let manager: Record<string, ReturnType<typeof vi.fn>> | null = null;

vi.mock("./siri/siri-catalog.ts", () => ({ buildSiriCatalog: () => catalog }));
vi.mock("./projects.ts", () => ({
  listProjects: () => catalog.projects,
  getProject: (id: string) => catalog.projects.find((p) => p.id === id) ?? null,
}));
vi.mock("./agents/registry.ts", () => ({
  listRegisteredAgents: () => catalog.agents.map((a) => ({ id: a.id, displayName: a.displayName })),
}));
vi.mock("./threads.ts", () => ({
  listThreads: () => [...mocks.threads.values()],
  getThread: (id: string) => mocks.threads.get(id) ?? null,
}));
vi.mock("./worktree-manager.ts", () => ({
  createWorktree: mocks.createWorktree,
  removeWorktreeBestEffort: mocks.removeWorktreeBestEffort,
  isLiveWorktree: mocks.isLiveWorktree,
  gitBinary: () => "git",
}));
vi.mock("./agent-instances.ts", () => ({
  listAgentInstanceDescriptors: () =>
    catalog.agents
      .filter((a) => a.available)
      .map((a) => ({ id: a.id, displayName: a.displayName })),
}));

import { RemoteServer } from "./remote-server.ts";
import { RemoteDeviceStore } from "./remote-devices.ts";
import type { RemoteReport, RemoteThreadSummary } from "../contracts/remote.ts";
function responseBody(response: Response): Promise<{
  thread: RemoteThreadSummary;
  report: RemoteReport;
  ok: boolean;
  error: string;
  retryable: boolean;
}> {
  return response.json() as ReturnType<typeof responseBody>;
}

let userData: string;
let server: RemoteServer;
let base: string;
let token: string;

/** Bind loopback on an ephemeral port and return the real address. */
async function startServer(s: RemoteServer): Promise<string> {
  await s.start();
  const h = (s as unknown as { servers: import("node:http").Server[] }).servers[0]!;
  return `http://127.0.0.1:${(h.address() as { port: number }).port}`;
}

/** Pair a device through the real one-time-code flow; returns its token. */
async function pairDevice(s: RemoteServer, at: string): Promise<string> {
  const offer = s.createPairingOffer(["read", "run"]);
  const res = await fetch(`${at}/api/remote/pair`, {
    method: "POST",
    body: JSON.stringify({ code: offer.code, deviceName: "Test phone" }),
  });
  return ((await res.json()) as { token: string }).token;
}

beforeEach(async () => {
  manager = null;
  mocks.threads.clear();
  mocks.createWorktree
    .mockReset()
    .mockReturnValue({ path: "/tmp/isolated-test", branch: "phone-test" });
  mocks.removeWorktreeBestEffort.mockReset();
  mocks.isLiveWorktree.mockReset().mockReturnValue(true);
  userData = mkdtempSync(join(tmpdir(), "pipper-remote-test-"));
  process.env.PIPPER_REMOTE_HOST = "127.0.0.1";
  server = new RemoteServer(
    {
      agentManager: () =>
        manager as unknown as import("./agent-connection-manager.ts").AgentManager | null,
      getUserDataPath: () => userData,
      getRendererDir: () => userData,
      devices: new RemoteDeviceStore(new DatabaseSync(":memory:")),
    },
    { port: 0 },
  );
  base = await startServer(server);
  token = await pairDevice(server, base);
});

afterEach(async () => {
  delete process.env.PIPPER_REMOTE_HOST;
  await server.stop();
  rmSync(userData, { recursive: true, force: true });
});

describe("GET /api/remote/catalog", () => {
  it("requires a paired device", async () => {
    const res = await fetch(`${base}/api/remote/catalog`);
    expect(res.status).toBe(401);
  });

  it("returns the same catalog Siri reads on the Mac, uncached", async () => {
    const res = await fetch(`${base}/api/remote/catalog`, {
      headers: { Authorization: `Bearer ${token}` },
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
        devices: new RemoteDeviceStore(new DatabaseSync(":memory:")),
        onRemoteActiveChanged: (active) => seen.push(active),
      },
      { port: 0 },
    );
    const at = await startServer(s);
    try {
      const t2 = await pairDevice(s, at);
      expect(seen).not.toContain(true);
      await fetch(`${at}/api/remote/catalog`, {
        headers: { Authorization: `Bearer ${t2}` },
      });
      expect(seen).toContain(true);
      expect(s.hasLiveLease()).toBe(true);
    } finally {
      await s.stop();
    }
  });
});

function installAgent() {
  manager = {
    createThread: vi.fn(async (_project, title, _after, _agent, path) => {
      const thread = {
        id: `t${mocks.threads.size + 1}`,
        project_id: "p1",
        worktree_path: path,
        title,
        last_used_at: Date.now(),
      };
      mocks.threads.set(thread.id, thread);
      return thread;
    }),
    sendPrompt: vi.fn(async () => {}),
    abortThread: vi.fn(async () => {}),
    getRunningThreadIds: vi.fn(() => []),
    getThreadTranscript: vi.fn(() => ({ finalText: null, messages: [] })),
    getRemotePermissions: vi.fn(() => []),
    respondToRemotePermission: vi.fn(async () => true),
    getThreadModel: vi.fn(
      (): {
        configId: string;
        current: string | null;
        options: Array<{ id: string; name: string }>;
      } | null => null,
    ),
    setThreadConfigOption: vi.fn(async () => []),
    getModelCatalogs: vi.fn(async () => ({
      "codex-acp": [{ modelId: "gpt-5", name: "GPT-5" }],
    })),
  };
  return manager;
}

const input = {
  requestId: "request-1",
  projectId: "p1",
  modelId: "codex-acp",
  prompt: "Fix login",
};
function post(path: string, body: unknown, auth = token) {
  return fetch(`${base}/api/remote/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

it("deduplicates concurrent creation and returns the original thread on retry", async () => {
  const am = installAgent();
  const responses = await Promise.all([post("threads", input), post("threads", input)]);
  expect(responses.map((r) => r.status)).toEqual([202, 202]);
  const bodies = await Promise.all(responses.map(responseBody));
  expect(bodies[0].thread.id).toBe(bodies[1].thread.id);
  const retry = await responseBody(await post("threads", input));
  expect(retry.thread.id).toBe(bodies[0].thread.id);
  expect(am.createThread).toHaveBeenCalledTimes(1);
  expect(am.sendPrompt).toHaveBeenCalledTimes(1);
  expect(mocks.createWorktree).toHaveBeenCalledTimes(1);
});

it("rejects malformed or conflicting IDs without side effects", async () => {
  const am = installAgent();
  expect((await post("threads", { ...input, requestId: "not/valid" })).status).toBe(400);
  await post("threads", input);
  expect((await post("threads", { ...input, prompt: "Different task" })).status).toBe(409);
  expect(am.sendPrompt).toHaveBeenCalledTimes(1);
});

it("still accepts phone apps that predate request IDs, without deduplicating them", async () => {
  const am = installAgent();
  const legacy = { ...input, requestId: undefined };
  expect((await post("threads", legacy)).status).toBe(202);
  expect((await post("threads", legacy)).status).toBe(202);
  expect(am.createThread).toHaveBeenCalledTimes(2);
});

it("tells the phone why a task failed only with user-facing text", async () => {
  const am = installAgent();
  am.createThread.mockRejectedValue(new Error("/Users/secret/path exploded"));
  const response = await post("threads", input);
  expect(response.status).toBe(409);
  const text = await response.text();
  expect(text).not.toContain("/Users/secret");
  expect(text).toContain("nothing was started");
});

it("never runs in the project root when worktree creation fails", async () => {
  const am = installAgent();
  mocks.createWorktree.mockImplementation(() => {
    throw new Error("no commits");
  });
  const response = await post("threads", input);
  expect(response.status).toBe(409);
  const rejection = await responseBody(response);
  expect(rejection.error).toContain("No task was started");
  expect(rejection.retryable).toBe(true);
  expect(am.createThread).not.toHaveBeenCalled();
  expect(am.sendPrompt).not.toHaveBeenCalled();
});

it("permits a new attempt after a confirmed pre-dispatch rejection, while preserving the old receipt", async () => {
  const am = installAgent();
  mocks.createWorktree.mockImplementationOnce(() => {
    throw new Error("no commits");
  });
  expect((await post("threads", input)).status).toBe(409);
  // A lost failure response followed by retry never changes the old outcome.
  expect((await post("threads", input)).status).toBe(409);
  expect(am.sendPrompt).not.toHaveBeenCalled();
  expect((await post("threads", { ...input, requestId: "new-attempt" })).status).toBe(202);
  expect(am.sendPrompt).toHaveBeenCalledTimes(1);
});

it("does not dispatch if the agent fails to bind the requested worktree", async () => {
  const am = installAgent();
  am.createThread.mockResolvedValue({ id: "bad", project_id: "p1", worktree_path: null });
  expect((await post("threads", input)).status).toBe(409);
  expect(am.sendPrompt).not.toHaveBeenCalled();
});

it("acknowledges follow-ups before the turn completes and records asynchronous failure", async () => {
  const am = installAgent();
  await post("threads", input);
  let rejectTurn!: (error: Error) => void;
  am.sendPrompt.mockImplementation(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectTurn = reject;
      }),
  );
  const response = await post("threads/t1/prompt", { requestId: "followup-1", prompt: "Continue" });
  expect(response.status).toBe(202);
  expect((await responseBody(response)).ok).toBe(true);
  await post("threads/t1/prompt", { requestId: "followup-1", prompt: "Continue" });
  expect(am.sendPrompt).toHaveBeenCalledTimes(2); // initial + one follow-up
  rejectTurn(new Error("Agent disconnected"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const report = await fetch(`${base}/api/remote/threads/t1/report`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect((await responseBody(report)).report.request?.error).toBe("Agent disconnected");
});

it("refuses follow-ups after the worktree disappears", async () => {
  const am = installAgent();
  await post("threads", input);
  mocks.isLiveWorktree.mockReturnValue(false);
  expect(
    (await post("threads/t1/prompt", { requestId: "followup-1", prompt: "Continue" })).status,
  ).toBe(409);
  expect(am.sendPrompt).toHaveBeenCalledTimes(1);
});

it("authenticates controls and scopes answers and cancellation to the named thread", async () => {
  const am = installAgent();
  await post("threads", input);
  expect((await post("threads/t1/stop", {}, "wrong-token")).status).toBe(401);
  expect(am.abortThread).not.toHaveBeenCalled();
  expect((await post("threads/t1/stop", {})).status).toBe(200);
  expect(am.abortThread).toHaveBeenCalledWith("t1");
  expect((await post("threads/t1/permission", { decisionId: "d1", optionId: "deny" })).status).toBe(
    200,
  );
  expect(am.respondToRemotePermission).toHaveBeenCalledWith("t1", "d1", "deny", false);
  am.respondToRemotePermission.mockResolvedValue(false);
  expect(
    (await post("threads/t1/permission", { decisionId: "expired", optionId: "allow" })).status,
  ).toBe(409);
});

it("checks authentication and agent availability separately from public health", async () => {
  const unauthorized = await fetch(`${base}/api/remote/diagnostics`);
  expect(unauthorized.status).toBe(401);
  const response = await fetch(`${base}/api/remote/diagnostics`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(await response.json()).toEqual({
    paired: true,
    agentReady: false,
    availableAgents: 1,
    projects: 1,
  });
});

it("seeds the chosen model on the new thread and keeps old fingerprints stable", async () => {
  const am = installAgent();
  await post("threads", { ...input, model: "gpt-5" });
  expect(am.createThread).toHaveBeenCalledWith(
    "p1",
    "Fix login",
    null,
    "codex-acp",
    expect.any(String),
    "gpt-5",
    { background: true, requireWorktree: true },
  );
  // Same request id with a different model is a different task.
  expect((await post("threads", { ...input, model: "o3" })).status).toBe(409);
  await post("threads", { ...input, requestId: "request-2" });
  expect(am.createThread).toHaveBeenLastCalledWith(
    "p1",
    "Fix login",
    null,
    "codex-acp",
    expect.any(String),
    null,
    { background: true, requireWorktree: true },
  );
});

it("lists models per agent and caches the probe", async () => {
  const am = installAgent();
  const get = () =>
    fetch(`${base}/api/remote/agent-models`, { headers: { Authorization: `Bearer ${token}` } });
  expect(await (await get()).json()).toEqual({
    models: { "codex-acp": [{ id: "gpt-5", name: "GPT-5" }] },
  });
  await get();
  expect(am.getModelCatalogs).toHaveBeenCalledTimes(1);
});

it("switches a thread's model only to an offered option", async () => {
  const am = installAgent();
  await post("threads", input);
  expect((await post("threads/t1/model", { model: "gpt-5" })).status).toBe(409);
  am.getThreadModel.mockReturnValue({
    configId: "model",
    current: "gpt-5",
    options: [
      { id: "gpt-5", name: "GPT-5" },
      { id: "o3", name: "o3" },
    ],
  });
  expect((await post("threads/t1/model", { model: "nope" })).status).toBe(400);
  expect((await post("threads/t1/model", { model: "o3" })).status).toBe(200);
  expect(am.setThreadConfigOption).toHaveBeenCalledWith("t1", "model", "o3");
  const report = await fetch(`${base}/api/remote/threads/t1/report`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect((await responseBody(report)).report.model?.options).toHaveLength(2);
});
