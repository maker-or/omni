import type { AcpAgentDescriptor } from "../../contracts/acp.ts";

/**
 * Client-side `/subagent` composer logic: the draft the morphed composer
 * edits, its validation, and the single orchestration prompt composed for
 * the orchestrator thread on submit. The orchestrator drives the actual
 * fan-out through the client-hosted `spawn_subagent` MCP tool
 * (docs/subagents.md); nothing here talks to subagents directly.
 */

export const SUBAGENT_COMMAND = "subagent";

export interface SubagentAssignment {
  /** Stable row key for the composer UI. */
  id: string;
  agentId: string;
  task: string;
}

export interface OrchestrationDraft {
  /** auto: the orchestrator decides how many subagents to spawn. */
  mode: "auto" | "manual";
  /** The overall goal (required in auto mode, optional in manual). */
  goal: string;
  assignments: SubagentAssignment[];
}

let assignmentCounter = 0;

export function newAssignment(agentId = ""): SubagentAssignment {
  assignmentCounter += 1;
  return { id: `assignment-${assignmentCounter}`, agentId, task: "" };
}

export function emptyOrchestrationDraft(): OrchestrationDraft {
  return { mode: "auto", goal: "", assignments: [newAssignment()] };
}

/** True when the composer input is the /subagent trigger (with or without a remainder). */
export function isSubagentTrigger(input: string): boolean {
  const [token] = input.trim().split(/\s+/);
  return token === `/${SUBAGENT_COMMAND}`;
}

/** Human-readable reason the draft can't be submitted yet, or null when valid. */
export function validateOrchestrationDraft(draft: OrchestrationDraft): string | null {
  if (draft.mode === "auto") {
    if (!draft.goal.trim()) return "Describe the goal so the orchestrator can split the work.";
    return null;
  }
  const filled = draft.assignments.filter((a) => a.task.trim());
  if (filled.length === 0) return "Add at least one subagent task.";
  const missingAgent = filled.find((a) => !a.agentId);
  if (missingAgent) return "Pick an agent for every task.";
  return null;
}

function agentLabel(
  agentId: string,
  agents: ReadonlyArray<Pick<AcpAgentDescriptor, "id" | "displayName">>,
): string {
  const match = agents.find((agent) => agent.id === agentId);
  return match ? `${match.displayName} (agent_id: ${match.id})` : `agent_id: ${agentId}`;
}

const ORCHESTRATOR_PREAMBLE =
  "You are acting as an orchestrator. You have a `spawn_subagent` tool (from the " +
  "pipper-subagents MCP server) that runs another coding agent in its own isolated session " +
  "and returns its final report; `list_subagents` shows what is available. Subagents share " +
  "none of your context, so every task you delegate must be fully self-contained: include " +
  "the background, relevant file paths, constraints, and the exact output you expect back.";

/**
 * Compose the single prompt sent to the orchestrator thread. Pure so the
 * exact delegation contract stays testable without any UI.
 */
export function composeOrchestrationPrompt(
  draft: OrchestrationDraft,
  agents: ReadonlyArray<Pick<AcpAgentDescriptor, "id" | "displayName">>,
): string {
  const goal = draft.goal.trim();

  if (draft.mode === "auto") {
    return [
      ORCHESTRATOR_PREAMBLE,
      "Decide how to split the goal below into subagent tasks: spawn as many subagents as " +
        "genuinely help (running independent tasks in parallel), pick whichever available " +
        "agent fits each task, then verify their reports against each other and synthesize " +
        "one final answer. Do the work yourself only where delegation adds nothing.",
      `<goal>\n${goal}\n</goal>`,
    ].join("\n\n");
  }

  const filled = draft.assignments.filter((a) => a.task.trim());
  const taskList = filled
    .map((a, index) => `${index + 1}. ${agentLabel(a.agentId, agents)} — ${a.task.trim()}`)
    .join("\n");

  return [
    ORCHESTRATOR_PREAMBLE,
    "The user assigned the following subagents. Spawn each with spawn_subagent, using the " +
      "listed agent_id, and run independent tasks in parallel. Enrich each task with any " +
      "context the subagent will need before delegating it.",
    `<assignments>\n${taskList}\n</assignments>`,
    goal ? `<goal>\n${goal}\n</goal>` : null,
    "When every subagent reports back, verify the results, resolve any conflicts between " +
      "them, and synthesize a single final answer for the user.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
