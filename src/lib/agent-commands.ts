import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";

export interface AgentCommand {
  name: string;
  description: string;
  source: "builtin" | "extension";
}
const builtins: AgentCommand[] = [
  { name: "compact", description: "Compact conversation context", source: "builtin" },
  { name: "abort", description: "Stop the current response", source: "builtin" },
];
export function mergeAgentCommands(commands: SlashCommandInfo[]): AgentCommand[] {
  const names = new Set(builtins.map((command) => command.name));
  return [
    ...builtins,
    ...commands
      .filter((command) => !names.has(command.name))
      .map((command) => ({
        name: command.name,
        description: command.description ?? "",
        source: "extension" as const,
      })),
  ];
}
export function matchAgentCommands(commands: AgentCommand[], query: string): AgentCommand[] {
  const normalized = query.toLowerCase();
  return [...commands]
    .sort(
      (a, b) =>
        Number(b.name.toLowerCase().startsWith(normalized)) -
        Number(a.name.toLowerCase().startsWith(normalized)),
    )
    .filter((command) => command.name.toLowerCase().includes(normalized));
}
