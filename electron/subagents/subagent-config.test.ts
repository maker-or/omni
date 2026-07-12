import { describe, expect, test, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  app: { getPath: () => "/nonexistent-userdata" },
}));

import {
  DEFAULT_SUBAGENT_CONFIG,
  readSubagentConfig,
  sanitizeSubagentConfig,
  writeSubagentConfig,
} from "./subagent-config.ts";

describe("subagent config", () => {
  test("missing file yields defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "subagent-config-"));
    expect(await readSubagentConfig(dir)).toEqual(DEFAULT_SUBAGENT_CONFIG);
  });

  test("partial writes merge over current config and round-trip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "subagent-config-"));
    const written = await writeSubagentConfig(
      { allowedAgents: ["claude-agent-acp"], maxConcurrent: 2 },
      dir,
    );
    expect(written.allowedAgents).toEqual(["claude-agent-acp"]);
    expect(written.maxConcurrent).toBe(2);
    expect(written.enabled).toBe(DEFAULT_SUBAGENT_CONFIG.enabled);

    const readBack = await readSubagentConfig(dir);
    expect(readBack).toEqual(written);
  });

  test("junk values are clamped or replaced with defaults", () => {
    const config = sanitizeSubagentConfig({
      enabled: "yes",
      allowedAgents: [1, "codex-acp", null],
      maxConcurrent: 999,
      maxDepth: -3,
      runTimeoutMs: 5,
      autoApprovePermissions: 1,
    });
    expect(config.enabled).toBe(DEFAULT_SUBAGENT_CONFIG.enabled);
    expect(config.allowedAgents).toEqual(["codex-acp"]);
    expect(config.maxConcurrent).toBeLessThanOrEqual(8);
    expect(config.maxDepth).toBeGreaterThanOrEqual(1);
    expect(config.runTimeoutMs).toBeGreaterThanOrEqual(30_000);
    expect(config.autoApprovePermissions).toBe(DEFAULT_SUBAGENT_CONFIG.autoApprovePermissions);
  });

  test("corrupt json yields defaults instead of throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "subagent-config-"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "subagents.json"), "{not json", "utf-8");
    expect(await readSubagentConfig(dir)).toEqual(DEFAULT_SUBAGENT_CONFIG);
  });
});
