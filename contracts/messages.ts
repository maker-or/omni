export const messageRoles = ["user", "assistant", "system"] as const;
export type MessageRole = (typeof messageRoles)[number];

export interface Message {
  id: string;
  thread_id: string;
  role: MessageRole;
  content: string;
  created_at: number; // Unix timestamp in milliseconds
}

export type NewMessage = Omit<Message, "id">;
