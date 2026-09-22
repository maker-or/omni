import commonSkill from "../../skills/git/_common.md?raw";
import commitSkill from "../../skills/git/commit.md?raw";
import addressReviewSkill from "../../skills/git/address-review.md?raw";

/**
 * Scenario guidance for git tasks the workspace panel hands to an agent.
 *
 * Skills are markdown files under `skills/git/`, bundled into the renderer
 * and attached to the prompt at the moment the user clicks — the agent is
 * never expected to discover them on disk. `_common.md` is prepended to every
 * scenario; the scenario file carries the task-specific protocol; the caller
 * supplies the facts (branch, files, comments) as a fenced context block so
 * the prose stays generic and the data stays structured.
 */
export type GitSkillId = "commit" | "address-review";

const SKILLS: Record<GitSkillId, string> = {
  commit: commitSkill,
  "address-review": addressReviewSkill,
};

const CONTEXT_FENCE = "workspace-context";

/** Drop a leading `---` YAML frontmatter block; the agent only needs the body. */
export function stripFrontmatter(text: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return (match ? text.slice(match[0].length) : text).trim();
}

export type ContextValue = string | number | boolean | null | undefined | string[];

/**
 * Render caller-supplied facts as a fenced block the skill prose refers to
 * by key. Lists render one item per line; empty lists and nullish values are
 * omitted so the agent never sees a key with nothing behind it.
 */
export function contextBlock(fields: Record<string, ContextValue>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`, ...value.map((item) => `- ${item}`));
      continue;
    }
    lines.push(`${key}: ${value}`);
  }
  return ["```" + CONTEXT_FENCE, ...lines, "```"].join("\n");
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
    stripFrontmatter(commonSkill),
    "",
    stripFrontmatter(SKILLS[input.skill]),
    "",
    input.context,
  ].join("\n");
}
