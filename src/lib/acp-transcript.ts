/**
 * Extract a plain user/assistant transcript from panel messages, for the
 * `/continue` flow (fork a conversation onto another agent). Thoughts and tool
 * calls are intentionally dropped — only what the two parties actually said.
 *
 * Operates on the panel snapshot's message shape (already role-grouped) so it
 * needs no access to the raw ACP entry timeline and stays trivially testable.
 */

/** Minimal shape shared with `AgentPanelSnapshot["messages"]`. */
export interface TranscriptSourceMessage {
  role: string;
  content: string | Array<Record<string, unknown>>;
}

export interface TranscriptTurn {
  role: "user" | "assistant";
  text: string;
}

/**
 * Visible text of a message: the string itself, or the `text` parts joined.
 * Assistant runs emit a separate text part on each side of a tool call, so the
 * parts must be joined with a separator — concatenating with "" would fuse
 * sentences ("I'll check." + "Tests passed." → "I'll check.Tests passed.").
 * "\n\n" matches how the app's own projection concatenates visible segments.
 */
function messageText(content: TranscriptSourceMessage["content"]): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    const typed = part as { type?: string; text?: string };
    if (typed.type === "text" && typeof typed.text === "string" && typed.text) {
      parts.push(typed.text);
    }
  }
  return parts.join("\n\n").trim();
}

/** User/assistant turns with non-empty visible text, in timeline order. */
export function extractConversation(
  messages: readonly TranscriptSourceMessage[],
): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = messageText(message.content);
    if (!text) continue;
    turns.push({ role: message.role, text });
  }
  return turns;
}

/** True when there is at least one user/assistant turn worth carrying over. */
export function hasConversation(messages: readonly TranscriptSourceMessage[]): boolean {
  return extractConversation(messages).length > 0;
}

/** Render turns as a readable `User:` / `Assistant:` transcript. */
export function formatTranscript(turns: readonly TranscriptTurn[]): string {
  return turns
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`)
    .join("\n\n");
}

/** Rough characters-per-token; conversational text averages ~4. */
const CHARS_PER_TOKEN = 4;

/**
 * Target token budget for a carried-over transcript. Deliberately conservative
 * so a long source thread can't swallow the new thread's whole context window
 * on the very first message.
 */
export const CONTINUATION_TOKEN_BUDGET = 12_000;

export interface BudgetedTranscript {
  /** Transcript text, trimmed to the newest turns that fit the budget. */
  text: string;
  /** True when older turns were dropped to fit. */
  omittedHistory: boolean;
}

/**
 * Format a transcript bounded to a token budget: keep the newest turns that
 * fit (a conversation is most useful from its tail), drop older ones, and — when
 * anything was dropped — prepend a marker so the receiving agent knows earlier
 * history is missing rather than assuming it has the full thread.
 */
export function budgetTranscript(
  turns: readonly TranscriptTurn[],
  tokenBudget: number = CONTINUATION_TOKEN_BUDGET,
): BudgetedTranscript {
  const charBudget = Math.max(0, tokenBudget) * CHARS_PER_TOKEN;
  const kept: TranscriptTurn[] = [];
  let total = 0;
  // Walk newest → oldest, keeping turns until the next one would overflow.
  // Always keep at least the most recent turn, even if it alone exceeds budget.
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i]!;
    const cost = turn.text.length + turn.role.length + 4; // + framing overhead
    if (kept.length > 0 && total + cost > charBudget) break;
    kept.unshift(turn);
    total += cost;
  }
  const omittedHistory = kept.length < turns.length;
  const body = formatTranscript(kept);
  const text = omittedHistory
    ? `[Earlier messages were omitted to fit the context window.]\n\n${body}`
    : body;
  return { text, omittedHistory };
}

/**
 * Wrap a transcript with a short preamble so the receiving agent treats it as
 * prior context to continue, not as a fresh instruction. Sent as its own
 * content block alongside the user's actual message.
 */
export function buildContinuationText(transcript: string): string {
  return [
    "The following is a transcript of an earlier conversation you are continuing.",
    "Use it as context and pick up seamlessly from where it left off.",
    "",
    transcript,
    "",
    "--- end of earlier conversation ---",
  ].join("\n");
}
