import { beforeEach, describe, expect, test, vi } from "vitest";

describe("model-catalog-store", () => {
  beforeEach(() => {
    vi.resetModules();
    // Fresh storage per test so persistence does not leak across cases.
    const memory = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    });
  });

  test("remember stores models per agent and does not wipe on empty", async () => {
    const { useModelCatalogStore } = await import("./model-catalog-store");
    useModelCatalogStore.setState({ byAgentId: {} });

    useModelCatalogStore.getState().remember("claude-agent-acp", [
      { modelId: "sonnet", name: "Sonnet" },
      { modelId: "opus", name: "Opus" },
    ]);
    useModelCatalogStore.getState().remember("opencode-acp", [{ modelId: "gpt-4", name: "GPT-4" }]);
    // Empty lists must not clobber a known catalog (transient session config).
    useModelCatalogStore.getState().remember("claude-agent-acp", []);

    expect(useModelCatalogStore.getState().modelsForAgents(["claude-agent-acp"])).toEqual([
      { agentId: "claude-agent-acp", modelId: "sonnet", name: "Sonnet" },
      { agentId: "claude-agent-acp", modelId: "opus", name: "Opus" },
    ]);
    expect(
      useModelCatalogStore.getState().modelsForAgents(["opencode-acp", "claude-agent-acp"]),
    ).toEqual([
      { agentId: "opencode-acp", modelId: "gpt-4", name: "GPT-4" },
      { agentId: "claude-agent-acp", modelId: "sonnet", name: "Sonnet" },
      { agentId: "claude-agent-acp", modelId: "opus", name: "Opus" },
    ]);
  });

  test("persists across store reloads", async () => {
    const { useModelCatalogStore } = await import("./model-catalog-store");
    useModelCatalogStore.setState({ byAgentId: {} });
    useModelCatalogStore.getState().remember("cursor-acp", [{ modelId: "auto", name: "Auto" }]);

    vi.resetModules();
    const reloaded = await import("./model-catalog-store");
    expect(reloaded.useModelCatalogStore.getState().modelsForAgents(["cursor-acp"])).toEqual([
      { agentId: "cursor-acp", modelId: "auto", name: "Auto" },
    ]);
  });
});
