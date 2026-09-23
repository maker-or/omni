import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { execFile } from "node:child_process";
import { z } from "zod";

/**
 * The "regular LLM" half of the brief: it reasons about who the user is (the
 * focus profile that guides Jev) and writes the prose (headline, one-line
 * "why it matters", reply drafts, meeting prep, the Pipper hand-off prompt).
 *
 * Backends are tried in order; any failure falls through to the next and
 * finally to the deterministic writer in compose.ts, so the brief never
 * depends on an LLM being reachable.
 */

export const FocusSchema = z.object({
  focus: z
    .string()
    .describe(
      "3-5 sentences: the user's likely role, the projects/repos/people that matter most right now, and what kinds of items are noise for them.",
    ),
});
export type FocusOutput = z.infer<typeof FocusSchema>;

export const WrittenBriefSchema = z.object({
  headline: z
    .string()
    .describe("One line, max ~90 chars, naming the single most important thing today."),
  summary: z
    .string()
    .describe("Two short sentences: the shape of the day and what to do first. No fluff."),
  items: z
    .array(
      z.object({
        id: z.string().describe("The exact id of the input item."),
        title: z.string().describe("Rewritten, scannable title, max ~80 chars."),
        why: z
          .string()
          .describe(
            "One sentence on why this earns a place today: who is waiting, what is at stake, or what changed.",
          ),
        reply_draft: z
          .string()
          .nullable()
          .describe(
            "Only for items where a written reply is the next step: a ready-to-send reply in the user's voice (plain text, <= 90 words). Otherwise null.",
          ),
      }),
    )
    .describe("One entry per input to-do and context item, same ids."),
  push: z
    .object({
      id: z.string().describe("Id of the item Pipper should push forward."),
      pitch: z
        .string()
        .describe("One sentence telling the user what Pipper can do for this item right now."),
      agent_prompt: z
        .string()
        .nullable()
        .describe(
          "If the work is coding/investigation, a complete, specific prompt for a coding agent (include links, repo, ids, acceptance criteria). Otherwise null.",
        ),
    })
    .nullable(),
  agenda_notes: z
    .array(
      z.object({
        id: z.string(),
        note: z
          .string()
          .describe("One-line prep note connecting the meeting to other items in the brief."),
      }),
    )
    .describe("Only for meetings where there is something useful to say; may be empty."),
});
export type WrittenBrief = z.infer<typeof WrittenBriefSchema>;

export interface WriterBackend {
  readonly name: string;
  focus(input: string): Promise<FocusOutput>;
  write(input: string): Promise<WrittenBrief>;
}

const FOCUS_SYSTEM = `You help Pipper, a desktop app for software engineers, prepare a personalized morning brief.
Given a digest of the user's recent email, calendar, GitHub, Linear, and Slack items, infer what this person works on and cares about right now.
Your output steers a separate classifier that decides which items are important, so be concrete: name repos, projects, teams, and people.`;

const WRITE_SYSTEM = `You write Pipper's Morning Brief: the first thing a busy software engineer reads each morning.
Its job: (1) make sure no outstanding to-do falls through the cracks, (2) surface context from across their tools they might not know but would benefit from, and (3) push their most important work forward with something Pipper can actually do.
Every item must earn its place. Be specific (names, numbers, times, ids), concise, and direct. Never invent facts that are not in the input. Write in second person. No emojis, no exclamation marks, no filler like "Don't forget" or "Just a heads up".
Pipper can: start a coding-agent thread in the user's repo (review a PR, investigate a bug, implement a ticket), and draft replies (email drafts, Slack or GitHub/Linear comments) that the user confirms before anything is sent.`;

// ── Anthropic API ──────────────────────────────────────────────────────────

export const ANTHROPIC_WRITER_MODEL = "claude-opus-5";

export class AnthropicWriter implements WriterBackend {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 2 });
  }

  async focus(input: string): Promise<FocusOutput> {
    const response = await this.client.messages.parse({
      model: ANTHROPIC_WRITER_MODEL,
      max_tokens: 4000,
      output_config: { effort: "low", format: zodOutputFormat(FocusSchema) },
      system: FOCUS_SYSTEM,
      messages: [{ role: "user", content: input }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new Error(`Anthropic focus call returned no output (${response.stop_reason}).`);
    }
    return response.parsed_output;
  }

  async write(input: string): Promise<WrittenBrief> {
    const response = await this.client.messages.parse({
      model: ANTHROPIC_WRITER_MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium", format: zodOutputFormat(WrittenBriefSchema) },
      system: WRITE_SYSTEM,
      messages: [{ role: "user", content: input }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new Error(`Anthropic writer returned no output (${response.stop_reason}).`);
    }
    return response.parsed_output;
  }
}

// ── Claude Code CLI (uses the user's existing Claude login) ─────────────────

/** Pull the first JSON object out of free text (models sometimes wrap in fences). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object in model output.");
  return JSON.parse(candidate.slice(start, end + 1));
}

export class ClaudeCliWriter implements WriterBackend {
  readonly name = "claude-cli";
  private readonly binary: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(binary: string, env: NodeJS.ProcessEnv) {
    this.binary = binary;
    this.env = env;
  }

  private run(system: string, input: string, shape: string): Promise<unknown> {
    const prompt = `${system}\n\nRespond with ONLY a JSON object matching this TypeScript shape, no prose:\n${shape}\n\n---\n${input}`;
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.binary,
        ["-p", "--output-format", "json", "--no-session-persistence", "--tools", ""],
        { env: this.env, timeout: 150_000, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }
          try {
            const envelope = JSON.parse(stdout) as { result?: unknown; is_error?: boolean };
            if (envelope.is_error || typeof envelope.result !== "string") {
              reject(new Error(`claude CLI error: ${String(envelope.result).slice(0, 200)}`));
              return;
            }
            resolve(extractJson(envelope.result));
          } catch (parseError) {
            reject(parseError);
          }
        },
      );
      child.stdin?.end(prompt);
    });
  }

  async focus(input: string): Promise<FocusOutput> {
    return FocusSchema.parse(await this.run(FOCUS_SYSTEM, input, "{ focus: string }"));
  }

  async write(input: string): Promise<WrittenBrief> {
    const shape = `{
  headline: string;
  summary: string;
  items: { id: string; title: string; why: string; reply_draft: string | null }[];
  push: { id: string; pitch: string; agent_prompt: string | null } | null;
  agenda_notes: { id: string; note: string }[];
}`;
    return WrittenBriefSchema.parse(await this.run(WRITE_SYSTEM, input, shape));
  }
}

/** Try each backend in order; returns null when every backend failed. */
export async function firstSuccessful<T>(
  backends: WriterBackend[],
  call: (backend: WriterBackend) => Promise<T>,
): Promise<{ value: T; backend: string } | null> {
  for (const backend of backends) {
    try {
      return { value: await call(backend), backend: backend.name };
    } catch (error) {
      console.warn(`[Brief] Writer backend ${backend.name} failed:`, error);
    }
  }
  return null;
}
