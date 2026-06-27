import { describe, expect, test } from "vitest";
import { matchAgentCommands, mergeAgentCommands } from "./agent-commands";

describe("agent slash commands", () => {
  test("keeps built-ins first and removes extension duplicates by command name", () => {
    const commands = mergeAgentCommands([
      { name: "compact", description: "extension duplicate" },
      { name: "explain", description: "Explain the current code" },
    ] as never);

    expect(commands).toEqual([
      { name: "compact", description: "Compact conversation context", source: "builtin" },
      { name: "abort", description: "Stop the current response", source: "builtin" },
      { name: "explain", description: "Explain the current code", source: "extension" },
    ]);
  });

  test("matches case-insensitively and ranks prefix matches before substring matches", () => {
    const commands = [
      { name: "recompact", description: "", source: "extension" as const },
      { name: "compact", description: "", source: "builtin" as const },
      { name: "compare", description: "", source: "extension" as const },
    ];

    expect(matchAgentCommands(commands, "comp").map((command) => command.name)).toEqual([
      "compact",
      "compare",
      "recompact",
    ]);
    expect(matchAgentCommands(commands, "PACT").map((command) => command.name)).toEqual([
      "recompact",
      "compact",
    ]);
  });
});
