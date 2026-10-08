import type { SessionUpdate } from "@agentclientprotocol/sdk";

/** Keep ACP messages separate so progress text cannot be parsed as the answer. */
export class HeadlessResponse {
  private messages: Array<{ id: string | null; phase: string | null; text: string }> = [];

  add(update: SessionUpdate): void {
    if (update.sessionUpdate !== "agent_message_chunk" || update.content.type !== "text") return;
    const id = (update as { messageId?: string | null }).messageId ?? null;
    const phase =
      (update as { _meta?: { codex?: { phase?: string } } })._meta?.codex?.phase ?? null;
    const last = this.messages.at(-1);
    if (last && last.id === id && last.phase === phase) {
      last.text += update.content.text;
    } else {
      this.messages.push({ id, phase, text: update.content.text });
    }
  }

  text(requireFinal = false): string {
    const final = this.messages.filter((message) => message.phase === "final_answer");
    if (final.length)
      return final
        .map((message) => message.text)
        .join("")
        .trim();
    return requireFinal ? "" : (this.messages.at(-1)?.text.trim() ?? "");
  }
}
