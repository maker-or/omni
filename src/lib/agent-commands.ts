import type { AvailableCommand } from "@agentclientprotocol/sdk";

export interface AgentCommand {
  name: string;
  description: string;
  inputHint?: string | null;
  source: "agent";
}

/** Map agent-advertised AvailableCommand[] into UI autocomplete items. */
export function commandsFromAvailable(commands: AvailableCommand[]): AgentCommand[] {
  return (commands ?? []).map((command) => ({
    name: command.name,
    description: command.description ?? "",
    inputHint:
      command.input && typeof command.input === "object" && "hint" in command.input
        ? ((command.input as { hint?: string }).hint ?? null)
        : null,
    source: "agent" as const,
  }));
}

/** @deprecated Use commandsFromAvailable — hardcoded slash commands removed. */
export function mergeAgentCommands(commands: AvailableCommand[]): AgentCommand[] {
  return commandsFromAvailable(commands);
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

/** Insert command text for the input box; adds trailing space when input hint exists. */
export function formatCommandInsert(command: AgentCommand): string {
  const base = `/${command.name}`;
  if (command.inputHint) return `${base} `;
  return base;
}
