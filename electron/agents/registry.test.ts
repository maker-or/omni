import { describe, expect, test } from "vitest";
import {
  BUILTIN_ACP_AGENTS,
  listRegisteredAgents,
  probeAgentAvailability,
  resolveAgentSpawn,
} from "./registry.ts";

describe("ACP agent registry", () => {
  test("catalog includes Cursor, Codex, and Claude adapters", () => {
    const ids = BUILTIN_ACP_AGENTS.map((a) => a.id);
    expect(ids).toContain("cursor-acp");
    expect(ids).toContain("codex-acp");
    expect(ids).toContain("claude-agent-acp");

    const cursor = BUILTIN_ACP_AGENTS.find((a) => a.id === "cursor-acp")!;
    expect(cursor.command).toBe("agent");
    expect(cursor.args).toEqual(["acp"]);
    expect(cursor.docsUrl).toContain("cursor.com/docs/cli/acp");

    const codex = BUILTIN_ACP_AGENTS.find((a) => a.id === "codex-acp")!;
    expect(codex.npmPackage).toBe("@agentclientprotocol/codex-acp");
    expect(codex.docsUrl).toContain("codex-acp");

    const claude = BUILTIN_ACP_AGENTS.find((a) => a.id === "claude-agent-acp")!;
    expect(claude.npmPackage).toBe("@agentclientprotocol/claude-agent-acp");
    expect(claude.docsUrl).toContain("claude-agent-acp");
  });

  test("listRegisteredAgents probes availability without throwing", () => {
    const agents = listRegisteredAgents();
    expect(agents.length).toBeGreaterThanOrEqual(3);
    for (const agent of agents) {
      expect(typeof agent.available).toBe("boolean");
      expect(agent.displayName.length).toBeGreaterThan(0);
    }
    const mock = agents.find((a) => a.id === "pipper-mock");
    expect(mock?.available).toBe(true);
  });

  test("probeAgentAvailability marks mock as always available", () => {
    const mock = BUILTIN_ACP_AGENTS.find((a) => a.id === "pipper-mock")!;
    const probed = probeAgentAvailability(mock);
    expect(probed.available).toBe(true);
  });

  test("resolveAgentSpawn for mock returns node + mock-agent.mjs", () => {
    const mock = listRegisteredAgents().find((a) => a.id === "pipper-mock")!;
    const spawn = resolveAgentSpawn(mock);
    expect(spawn.args.some((a) => a.includes("mock-agent.mjs"))).toBe(true);
  });

  test("resolveAgentSpawn for missing binary agent throws with install hint", () => {
    const fake: (typeof BUILTIN_ACP_AGENTS)[number] = {
      id: "missing-binary-agent",
      name: "missing",
      displayName: "Missing Binary",
      command: "definitely-not-a-real-acp-binary-xyz",
      args: ["acp"],
      installKind: "binary",
      detectCommands: ["definitely-not-a-real-acp-binary-xyz"],
      installHint: "Install the missing binary first.",
    };
    expect(() => resolveAgentSpawn(fake)).toThrow(/Install the missing binary first/);
  });
});
