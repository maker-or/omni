import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as acp from "@agentclientprotocol/sdk";

vi.mock("electron", () => ({
  app: { getPath: () => "/nonexistent-userdata" },
}));

import type { AcpAgentDescriptor, AcpBridgeEvent } from "../../contracts/acp.ts";
import { SubagentManager, type SubagentConnection } from "./subagent-manager.ts";

const AGENTS: AcpAgentDescriptor[] = [
  {
    id: "agent-a",
    name: "a",
    displayName: "Agent A",
    command: "a",
    args: [],
    available: true,
    installKind: "binary",
    description: "test agent",
  },
  {
    id: "agent-off",
    name: "off",
    displayName: "Not Installed",
    command: "off",
    args: [],
    available: false,
    installKind: "binary",
  },
];

interface FakeAgent {
  connection: SubagentConnection;
  cancelled: string[];
  closed: string[];
}

/**
 * Scripted ACP agent: session/new mints ids, session/prompt runs the provided
 * behavior (which can stream updates into the manager), session/cancel is
 * recorded and surfaced so tests can simulate an agent honoring cancellation.
 */
function makeFakeAgent(options: {
  onPrompt: (sessionId: string) => Promise<void> | void;
  onCancel?: (sessionId: string) => void;
  httpCapable?: boolean;
}): FakeAgent {
  let counter = 0;
  const cancelled: string[] = [];
  const closed: string[] = [];
  const connection: SubagentConnection = {
    agentId: "agent-a",
    agentCapabilities: options.httpCapable === false ? {} : { mcpCapabilities: { http: true } },
    agent: {
      request: async (method: unknown, params: any) => {
        if (method === acp.methods.agent.session.new) {
          counter++;
          return { sessionId: `sub-session-${counter}` };
        }
        if (method === acp.methods.agent.session.prompt) {
          await options.onPrompt(params.sessionId);
          return { stopReason: "end_turn" };
        }
        if (method === acp.methods.agent.session.close) {
          closed.push(params.sessionId);
          return {};
        }
        return {};
      },
      notify: async (_method: unknown, params: any) => {
        cancelled.push(params.sessionId);
        options.onCancel?.(params.sessionId);
      },
    },
  };
  return { connection, cancelled, closed };
}

async function makeManager(fake: FakeAgent) {
  const events: AcpBridgeEvent[] = [];
  const baseDir = await mkdtemp(join(tmpdir(), "subagents-"));
  const manager = new SubagentManager({
    host: {
      acquireConnection: async () => fake.connection,
      baseMcpServers: () => [],
      emitEvent: (event) => events.push(event),
    },
    listAgents: () => AGENTS,
    baseDir,
  });
  await manager.init();
  return { manager, events, baseDir };
}

/** Pull the subagent MCP endpoint URL out of an attached server list. */
function endpointUrl(servers: Array<Record<string, unknown>>): string {
  const entry = servers.find((s) => s.name === "pipper-subagents");
  if (!entry) throw new Error("subagent server entry missing");
  return (entry.url ?? (entry.args as string[])[1]) as string;
}

async function callSpawn(url: string, args: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "spawn_subagent", arguments: args },
    }),
  });
  return ((await res.json()) as any).result as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
}

describe("subagent runs", () => {
  let manager: SubagentManager | null = null;

  afterEach(() => {
    manager?.dispose();
    manager = null;
  });

  test("an orchestrator session spawns a subagent over MCP and gets its final text back", async () => {
    const fake = makeFakeAgent({
      onPrompt: (sessionId) => {
        // Stream two chunks the way a real agent would, routed through the
        // same entry point the connection manager uses.
        manager!.handleSessionUpdate(sessionId, {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Report: " },
        } as never);
        manager!.handleSessionUpdate(sessionId, {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "refactor complete" },
        } as never);
      },
    });
    const made = await makeManager(fake);
    manager = made.manager;

    const attached = await manager.attachMcpServers(
      [],
      { mcpCapabilities: { http: true } },
      {
        cwd: "/repo",
        depth: 0,
      },
    );
    expect(attached.token).not.toBeNull();
    manager.bindSession(attached.token!, "orchestrator-session");

    const result = await callSpawn(endpointUrl(attached.servers), {
      agent_id: "agent-a",
      task: "refactor the thing",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("Report: refactor complete");
    // Session is closed after the run and the run is attributable to its parent.
    expect(fake.closed).toEqual(["sub-session-1"]);
    const finished = manager.getRunSnapshots().find((r) => r.status === "finished");
    expect(finished?.parentSessionId).toBe("orchestrator-session");
    expect(finished?.agentId).toBe("agent-a");
    expect(finished?.resultPreview).toContain("Report");
    // Renderer got activity events.
    expect(made.events.some((e) => e.type === "subagent-runs")).toBe(true);
  });

  test("agents without http MCP capability get a stdio proxy entry pointing at the same endpoint", async () => {
    const fake = makeFakeAgent({ onPrompt: () => {}, httpCapable: false });
    const made = await makeManager(fake);
    manager = made.manager;

    const attached = await manager.attachMcpServers([], {}, { cwd: "/repo", depth: 0 });
    const entry = attached.servers.find((s) => s.name === "pipper-subagents")!;
    expect(entry.type).toBe("stdio");
    expect(entry.command).toBe(process.execPath);
    const args = entry.args as string[];
    expect(args[0].endsWith("subagent-stdio-proxy.mjs")).toBe(true);
    expect(args[1]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\//);
    expect(existsSync(args[0])).toBe(true);
  });

  test("depth limit: sessions at maxDepth get no subagent tool", async () => {
    const fake = makeFakeAgent({ onPrompt: () => {} });
    const made = await makeManager(fake);
    manager = made.manager;
    await manager.setConfig({ maxDepth: 2 });

    const atLimit = await manager.attachMcpServers([], {}, { cwd: "/repo", depth: 2 });
    expect(atLimit.token).toBeNull();
    expect(atLimit.servers).toEqual([]);

    const below = await manager.attachMcpServers([], {}, { cwd: "/repo", depth: 1 });
    expect(below.token).not.toBeNull();
  });

  test("disabled config and unknown agent ids are rejected", async () => {
    const fake = makeFakeAgent({ onPrompt: () => {} });
    const made = await makeManager(fake);
    manager = made.manager;

    const attached = await manager.attachMcpServers([], {}, { cwd: "/repo", depth: 0 });
    const url = endpointUrl(attached.servers);

    const unknown = await callSpawn(url, { agent_id: "agent-off", task: "do it" });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0].text).toContain("agent-off");
    expect(unknown.content[0].text).toContain("agent-a");

    await manager.setConfig({ enabled: false });
    const disabled = await manager.attachMcpServers([], {}, { cwd: "/repo", depth: 0 });
    expect(disabled.token).toBeNull();
  });

  test("runs beyond maxConcurrent queue until a slot frees", async () => {
    const release = new Map<string, () => void>();
    const fake = makeFakeAgent({
      onPrompt: (sessionId) =>
        new Promise<void>((resolve) => {
          release.set(sessionId, resolve);
        }),
    });
    const made = await makeManager(fake);
    manager = made.manager;
    await manager.setConfig({ maxConcurrent: 1 });

    const attached = await manager.attachMcpServers([], {}, { cwd: "/repo", depth: 0 });
    const url = endpointUrl(attached.servers);

    const first = callSpawn(url, { agent_id: "agent-a", task: "one" });
    const second = callSpawn(url, { agent_id: "agent-a", task: "two" });

    await vi.waitFor(() => {
      const statuses = manager!.getRunSnapshots().map((r) => r.status);
      expect(statuses.filter((s) => s === "running")).toHaveLength(1);
      expect(statuses.filter((s) => s === "queued")).toHaveLength(1);
    });

    release.get("sub-session-1")!();
    await first;
    await vi.waitFor(() => expect(release.has("sub-session-2")).toBe(true));
    release.get("sub-session-2")!();
    await second;

    expect(manager.getRunSnapshots().every((r) => r.status === "finished")).toBe(true);
  });

  test("aborting the orchestrator cancels its in-flight subagent runs", async () => {
    const release = new Map<string, () => void>();
    const fake = makeFakeAgent({
      onPrompt: (sessionId) =>
        new Promise<void>((resolve) => {
          release.set(sessionId, resolve);
        }),
      // Agent honors session/cancel by ending the prompt turn.
      onCancel: (sessionId) => release.get(sessionId)?.(),
    });
    const made = await makeManager(fake);
    manager = made.manager;

    const attached = await manager.attachMcpServers([], {}, { cwd: "/repo", depth: 0 });
    manager.bindSession(attached.token!, "orchestrator-session");
    const url = endpointUrl(attached.servers);

    const pending = callSpawn(url, { agent_id: "agent-a", task: "long job" });
    await vi.waitFor(() => expect(release.size).toBe(1));

    manager.cancelRunsForParent("orchestrator-session");
    const result = await pending;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("cancelled");
    expect(fake.cancelled).toEqual(["sub-session-1"]);
    expect(manager.getRunSnapshots()[0].status).toBe("cancelled");
  });

  test("permission requests from subagent sessions auto-approve; others go to the user", async () => {
    let observed: ReturnType<SubagentManager["autoPermissionResponse"]> = null;
    const fake = makeFakeAgent({
      onPrompt: (sessionId) => {
        observed = manager!.autoPermissionResponse({
          sessionId,
          toolCall: { toolCallId: "t1", title: "write file" },
          options: [
            { optionId: "reject", name: "Reject", kind: "reject_once" },
            { optionId: "ok", name: "Allow", kind: "allow_once" },
          ],
        } as never);
      },
    });
    const made = await makeManager(fake);
    manager = made.manager;

    const attached = await manager.attachMcpServers([], {}, { cwd: "/repo", depth: 0 });
    await callSpawn(endpointUrl(attached.servers), { agent_id: "agent-a", task: "x" });

    expect(observed).toEqual({ outcome: { outcome: "selected", optionId: "ok" } });
    // A user-facing session is never auto-answered.
    expect(
      manager.autoPermissionResponse({
        sessionId: "some-thread-session",
        toolCall: { toolCallId: "t2", title: "x" },
        options: [],
      } as never),
    ).toBeNull();
  });

  test("updates for unknown sessions are not swallowed", async () => {
    const fake = makeFakeAgent({ onPrompt: () => {} });
    const made = await makeManager(fake);
    manager = made.manager;
    expect(
      manager.handleSessionUpdate("thread-session", {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hi" },
      } as never),
    ).toBe(false);
  });
});
