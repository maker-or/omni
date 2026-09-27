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

beforeEach(async () => {
  manager = null;
  mocks.threads.clear();
  mocks.createWorktree
    .mockReset()
    .mockReturnValue({ path: "/tmp/isolated-test", branch: "phone-test" });
  mocks.removeWorktreeBestEffort.mockReset();
  mocks.isLiveWorktree.mockReset().mockReturnValue(true);
  userData = mkdtempSync(join(tmpdir(), "pipper-remote-test-"));
  server = new RemoteServer(
    {
      agentManager: () =>
        manager as unknown as import("./agent-connection-manager.ts").AgentManager | null,
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
  };
  return manager;
}

const input = {
  requestId: "request-1",
  projectId: "p1",
  modelId: "codex-acp",
  prompt: "Fix login",
};
function post(path: string, body: unknown, token = "test-token") {
  return fetch(`${base}/api/remote/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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

it("rejects missing or conflicting IDs without side effects", async () => {
  const am = installAgent();
  expect((await post("threads", { ...input, requestId: undefined })).status).toBe(400);
  await post("threads", input);
  expect((await post("threads", { ...input, prompt: "Different task" })).status).toBe(409);
  expect(am.sendPrompt).toHaveBeenCalledTimes(1);
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
    headers: { Authorization: "Bearer test-token" },
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
    headers: { Authorization: "Bearer test-token" },
  });
  expect(await response.json()).toEqual({
    paired: true,
    agentReady: false,
    availableAgents: 1,
    projects: 1,
  });
});
