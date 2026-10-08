import { X } from "@phosphor-icons/react";
import {
  MAX_PROMPT_IMAGES,
  MAX_PROMPT_IMAGE_BYTES,
  isPromptImageMimeType,
  type PromptImagePayload,
} from "../../contracts/prompt-images.ts";

export interface PhoneImage extends PromptImagePayload {
  id: string;
  /** Object URL for the thumbnail; revoke with releaseImages(). */
  previewUrl: string;
}

/** Longest edge after downscaling. Plenty for screenshots and photos of screens. */
const MAX_EDGE_PX = 2048;
/** Supported images at or under this size upload untouched. */
const KEEP_ORIGINAL_BYTES = 1.5 * 1024 * 1024;

export const PHONE_IMAGE_ACCEPT = "image/*";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? "");
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image"));
    reader.readAsDataURL(blob);
  });
}

/** Re-encode as JPEG within MAX_EDGE_PX — phone photos are often 5–15 MB. */
async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob) throw new Error("Could not encode image");
    return blob;
  } finally {
    bitmap.close();
  }
}

/**
 * Turn a picked file into an upload-ready image. Small PNG/JPEG/GIF/WebP go
 * as-is; anything larger or in another format the browser can decode (e.g.
 * HEIC on iOS) is downscaled to JPEG. The laptop re-validates everything.
 */
export async function prepareImage(file: File): Promise<PhoneImage> {
  const keep = isPromptImageMimeType(file.type) && file.size <= KEEP_ORIGINAL_BYTES;
  let blob: Blob;
  try {
    blob = keep ? file : await downscale(file);
  } catch {
    throw new Error(`${file.name || "Image"} could not be read as an image.`);
  }
  if (blob.size > MAX_PROMPT_IMAGE_BYTES) {
    throw new Error(`${file.name || "Image"} is still over 10 MiB after resizing.`);
  }
  return {
    id: crypto.randomUUID(),
    data: await blobToBase64(blob),
    mimeType: blob.type,
    previewUrl: URL.createObjectURL(blob),
  };
}

/** Prepare picked files, stopping at the per-prompt image limit. */
export async function prepareImages(
  files: File[],
  existing: number,
): Promise<{ images: PhoneImage[]; errors: string[] }> {
  const images: PhoneImage[] = [];
  const errors: string[] = [];
  for (const file of files) {
    if (existing + images.length >= MAX_PROMPT_IMAGES) {
      errors.push(`A message can contain at most ${MAX_PROMPT_IMAGES} images.`);
      break;
    }
    try {
      images.push(await prepareImage(file));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { images, errors };
}

export function releaseImages(images: PhoneImage[]): void {
  for (const image of images) URL.revokeObjectURL(image.previewUrl);
}

export function ImageTray({
  images,
  onRemove,
}: {
  images: PhoneImage[];
  onRemove?: (id: string) => void;
}) {
  if (images.length === 0) return null;
  return (
    <div className="image-tray">
      {images.map((image) => (
        <div key={image.id} className="image-chip">
          <img src={image.previewUrl} alt="Attached image" />
          {onRemove && (
            <button
              type="button"
              className="image-chip-remove"
              aria-label="Remove image"
              onClick={() => onRemove(image.id)}
            >
              <X size={12} weight="bold" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
