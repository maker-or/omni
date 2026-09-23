import { getGroupPreamble, getSkill } from "@/lib/skill-bundle";

export { stripFrontmatter } from "@/lib/skill-bundle";

/**
 * Scenario guidance for git tasks the workspace panel hands to an agent.
 *
 * Skills are markdown files under `skills/git/`, bundled by `skill-bundle`
 * and attached to the prompt at the moment the user clicks — the agent is
 * never expected to discover them on disk. `_common.md` is prepended to every
 * scenario; the scenario file carries the task-specific protocol; the caller
 * supplies the facts (branch, files, comments) as a fenced context block so
 * the prose stays generic and the data stays structured.
 *
 * Adding a scenario: drop `skills/git/<id>.md` (see skills/README.md) and add
 * its id here. The bundle test fails if an id has no file behind it.
 */
export const GIT_SKILL_IDS = ["commit", "address-review", "get-latest"] as const;
export type GitSkillId = (typeof GIT_SKILL_IDS)[number];

const CONTEXT_FENCE = "workspace-context";

export type ContextValue = string | number | boolean | null | undefined | string[];

/**
 * Encode a string value as a single-line JSON string literal.
 *
 * Values here are repository-controlled (file paths, branch names), and git
 * allows newlines and backticks in paths. Written raw, a crafted filename
 * could close the fence or forge extra fields and instructions for a
 * commit-capable agent. JSON escapes every control character, so each value
 * stays on its own line; backticks are escaped too so no value can ever
 * spell a fence.
 */
export function encodeContextString(value: string): string {
  return JSON.stringify(value).replace(/`/g, "\\u0060");
}

function encodeContextValue(value: string | number | boolean): string {
  return typeof value === "string" ? encodeContextString(value) : String(value);
}

/**
 * Render caller-supplied facts as a fenced block the skill prose refers to
 * by key. Strings are JSON string literals (see `encodeContextString`);
 * numbers and booleans are bare. Lists render one item per line; empty lists
 * and nullish values are omitted so the agent never sees a key with nothing
 * behind it.
 */
export function contextBlock(fields: Record<string, ContextValue>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`, ...value.map((item) => `- ${encodeContextString(item)}`));
      continue;
    }
    lines.push(`${key}: ${encodeContextValue(value)}`);
  }
  return ["```" + CONTEXT_FENCE, ...lines, "```"].join("\n");
}

/** The shared git rules. Their absence would drop the hard safety rules from every task, so it throws. */
function gitPreamble(): string {
  const preamble = getGroupPreamble("git");
  if (!preamble) throw new Error("skills/git/_common.md is missing from the skill bundle.");
  return preamble.body;
}

/**
 * Assemble the message sent to the agent: a one-line task the user can read
 * in the thread, the shared rules, the scenario protocol, then the context.
 * `context` is a pre-rendered block (from `contextBlock`) or any extra
 * sections the scenario needs after the prose (e.g. fenced comments).
 */
export function composeSkillPrompt(input: {
  skill: GitSkillId;
  task: string;
  context: string;
}): string {
  return [
    input.task,
    "",
    gitPreamble(),
    "",
    getSkill(`git/${input.skill}`).body,
    "",
    input.context,
  ].join("\n");
}
