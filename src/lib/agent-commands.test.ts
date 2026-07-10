import { describe, expect, test } from "vitest";
import {
  commandsFromAvailable,
  formatCommandInsert,
  matchAgentCommands,
  mergeAgentCommands,
} from "./agent-commands";

describe("agent slash commands", () => {
  test("maps agent-advertised commands without hardcoded builtins", () => {
    const commands = mergeAgentCommands([
      { name: "compact", description: "agent compact" },
      { name: "explain", description: "Explain the current code", input: { hint: "topic" } },
    ] as never);

    expect(commands).toEqual([
      {
        name: "compact",
        description: "agent compact",
        inputHint: null,
        source: "agent",
      },
      {
        name: "explain",
        description: "Explain the current code",
        inputHint: "topic",
        source: "agent",
      },
    ]);
    expect(commandsFromAvailable([])).toEqual([]);
  });

  test("matches case-insensitively and ranks prefix matches before substring matches", () => {
    const commands = [
      { name: "recompact", description: "", source: "agent" as const },
      { name: "compact", description: "", source: "agent" as const },
      { name: "compare", description: "", source: "agent" as const },
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

  test("formatCommandInsert adds trailing space when input hint exists", () => {
    expect(formatCommandInsert({ name: "web", description: "", source: "agent" })).toBe("/web");
    expect(
      formatCommandInsert({ name: "web", description: "", inputHint: "query", source: "agent" }),
    ).toBe("/web ");
  });
});
