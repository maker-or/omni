/** Image attachment rules shared by the desktop composer, the phone, and the
 * Remote server, so every entry point accepts exactly the same images. */

export const PROMPT_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export type PromptImageMimeType = (typeof PROMPT_IMAGE_MIME_TYPES)[number];

export const MAX_PROMPT_IMAGES = 5;
export const MAX_PROMPT_IMAGE_BYTES = 10 * 1024 * 1024;

export interface PromptImagePayload {
  /** Base64 (standard alphabet, no data: prefix). */
  data: string;
  mimeType: string;
}

export function isPromptImageMimeType(value: string): value is PromptImageMimeType {
  return (PROMPT_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Image type from the file's leading bytes, or null for anything else. The
 * declared mimeType is caller-controlled, so remote input is only trusted when
 * its content actually is that image format.
 */
export function sniffPromptImageMimeType(bytes: Uint8Array): PromptImageMimeType | null {
  const starts = (sig: number[], offset = 0) =>
    bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}
