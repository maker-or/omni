import { describe, expect, test } from "vitest";
import { groupModelsByProvider } from "./model-groups.ts";

describe("groupModelsByProvider", () => {
  test("groups accounts under their provider, preserving order", () => {
    const groups = groupModelsByProvider([
      { id: "codex-acp", name: "Codex", provider: "Codex" },
      { id: "codex-acp:work", name: "Work", provider: "Codex" },
      { id: "claude-agent-acp", name: "Claude", provider: "Claude" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({
      provider: "Codex",
      models: [
        { id: "codex-acp", name: "Codex", provider: "Codex" },
        { id: "codex-acp:work", name: "Work", provider: "Codex" },
      ],
    });
    expect(groups[1].provider).toBe("Claude");
  });

  test("keeps unlabeled models in an ungrouped bucket", () => {
    const groups = groupModelsByProvider([{ id: "x", name: "X" }]);
    expect(groups).toEqual([{ provider: null, models: [{ id: "x", name: "X" }] }]);
  });

  test("returns an empty list for no models", () => {
    expect(groupModelsByProvider([])).toEqual([]);
  });
});
