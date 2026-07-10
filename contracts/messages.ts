/**
 * @deprecated Messages table removed — agent is source of truth.
 * Kept as empty shim so residual imports do not crash.
 */
export const messageRoles = ["user", "assistant", "system"] as const;
export type MessageRole = (typeof messageRoles)[number];

export interface Message {
  id: string;
  thread_id: string;
  role: MessageRole;
  content: string;
  created_at: number;
}

export type NewMessage = Omit<Message, "id">;
