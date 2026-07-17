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

/** Visible text of a message: the string itself, or the joined `text` parts. */
function messageText(content: TranscriptSourceMessage["content"]): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    const typed = part as { type?: string; text?: string };
    if (typed.type === "text" && typeof typed.text === "string") parts.push(typed.text);
  }
  return parts.join("").trim();
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
