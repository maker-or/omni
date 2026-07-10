import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { AcpChatMessage } from "../../contracts/acp.ts";

export type MessageLike =
  | AcpChatMessage
  | {
      role?: string;
      text?: string;
      content?: unknown;
      thought?: string;
    };

export function stringifyMessageContent(message: MessageLike): string {
  if ("text" in message && typeof message.text === "string" && message.text.length > 0) {
    return message.text;
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const typed = part as { type?: string; text?: string; thinking?: string };
      if (typed.type === "text" && typeof typed.text === "string") return typed.text;
      if (typed.type === "thinking" && typeof typed.thinking === "string") return typed.thinking;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function stringifyContentBlocks(blocks: ContentBlock[] | undefined | null): string {
  if (!blocks?.length) return "";
  return blocks
    .map((block) => {
      if (block.type === "text") return block.text ?? "";
      if (block.type === "image") return "[image]";
      if (block.type === "audio") return "[audio]";
      if (block.type === "resource_link") return block.name ?? block.uri;
      if (block.type === "resource") {
        const res = block.resource as { text?: string; uri?: string };
        return res.text ?? res.uri ?? "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function messageRole(message: MessageLike): string {
  if ("role" in message && typeof message.role === "string") return message.role;
  return "assistant";
}
