export interface AgentPromptImage {
  type: "image";
  data: string;
  mimeType: string;
}
import type { MessageLike } from "./message-utils";

const AGENT_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const MAX_AGENT_IMAGES = 5;
const MAX_AGENT_IMAGE_BYTES = 10 * 1024 * 1024;

export interface ChatImageAttachment extends AgentPromptImage {
  id: string;
  name?: string;
}

function validateImageFile(file: File): string | null {
  if (!AGENT_IMAGE_MIME_TYPES.includes(file.type as (typeof AGENT_IMAGE_MIME_TYPES)[number]))
    return `${file.name} is not a supported image.`;
  if (file.size > MAX_AGENT_IMAGE_BYTES) return `${file.name} exceeds the 10 MiB limit.`;
  return null;
}

export function partitionValidImageFiles(files: File[], existingCount = 0) {
  const valid: File[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const error = validateImageFile(file);
    if (error) errors.push(error);
    else if (existingCount + valid.length >= MAX_AGENT_IMAGES)
      errors.push("A prompt can contain at most 5 images.");
    else valid.push(file);
  }
  return { valid, errors };
}

export async function fileToPromptImage(file: File): Promise<AgentPromptImage> {
  const error = validateImageFile(file);
  if (error) throw new Error(error);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { type: "image", data: btoa(binary), mimeType: file.type };
}

export function extractMessageImages(message: MessageLike): ChatImageAttachment[] {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((part, index) => {
    if (!part || typeof part !== "object" || (part as { type?: string }).type !== "image")
      return [];
    const image = part as { data?: unknown; mimeType?: unknown };
    if (typeof image.data !== "string" || typeof image.mimeType !== "string") return [];
    return [
      {
        id: `${index}:${image.mimeType}:${image.data.slice(0, 16)}`,
        type: "image" as const,
        data: image.data,
        mimeType: image.mimeType,
      },
    ];
  });
}

export function extractGroupedMessageImages(messages: MessageLike[]): ChatImageAttachment[] {
  return messages.flatMap(extractMessageImages);
}
