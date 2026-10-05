import type http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import {
  MAX_PROMPT_IMAGES,
  MAX_PROMPT_IMAGE_BYTES,
  isPromptImageMimeType,
  sniffPromptImageMimeType,
  type PromptImagePayload,
} from "../contracts/prompt-images.ts";

/**
 * Guards for the Remote HTTP surface. Once the server sits behind a public
 * tunnel, the pairing token is the only barrier in front of an agent that can
 * run commands on this machine, so every check here must hold without relying
 * on the network (source address, proxy headers) being trustworthy.
 */

export class HttpError extends Error {
  readonly status: number;
  readonly headers: Record<string, string>;
  constructor(status: number, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

/** Constant-time token comparison; digests equalize lengths so length never leaks. */
export function tokensEqual(presented: string, expected: string): boolean {
  if (!presented || !expected) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Bearer credential from an Authorization header, or "" when absent/malformed. */
export function bearerToken(header: string | undefined): string {
  const match = /^Bearer ([^\s]+)$/.exec(header ?? "");
  return match?.[1] ?? "";
}

/**
 * Rate-limit key for a request — never used for authorization. By default
 * the socket peer: X-Forwarded-For / CF-Connecting-IP are caller-controlled
 * unless a trusted proxy is proven. In tunnel mode the server listens on
 * loopback only and the public path is Cloudflare, whose edge overwrites
 * CF-Connecting-IP, so it can key limits per real client. (A local process
 * could forge it, but a local process is already inside the boundary.)
 */
export function clientKey(req: http.IncomingMessage, trustCloudflareIp = false): string {
  const peer = req.socket.remoteAddress ?? "unknown";
  if (!trustCloudflareIp) return peer;
  const forwarded = req.headers["cf-connecting-ip"];
  const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return ip && /^[0-9a-f.:]{2,45}$/i.test(ip) ? `cf:${ip}` : peer;
}

/**
 * Sliding-window counter per key. Used both to throttle failed auth attempts
 * and to cap how fast an authed client can start work. The key map is bounded
 * so a flood of distinct keys cannot grow memory without limit.
 */
export class WindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(opts: { limit: number; windowMs: number; maxKeys?: number }) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    this.maxKeys = opts.maxKeys ?? 1_000;
  }

  private recent(key: string, now: number): number[] {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  /** Seconds until `key` may act again; 0 when it is under the limit. */
  retryAfterSec(key: string, now = Date.now()): number {
    const list = this.recent(key, now);
    if (list.length < this.limit) return 0;
    const oldest = list[list.length - this.limit]!;
    return Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
  }

  record(key: string, now = Date.now()): void {
    const list = this.recent(key, now);
    list.push(now);
    this.hits.delete(key);
    this.hits.set(key, list);
    // Map preserves insertion order and record() re-inserts, so the first key
    // is the least recently active one.
    while (this.hits.size > this.maxKeys) {
      const first = this.hits.keys().next().value;
      if (first === undefined) break;
      this.hits.delete(first);
    }
  }

  /** Record and admit in one step; returns the retry delay when refused. */
  consume(key: string, now = Date.now()): number {
    const wait = this.retryAfterSec(key, now);
    if (wait > 0) return wait;
    this.record(key, now);
    return 0;
  }
}

/** Read a request body with a hard byte cap; oversize bodies fail with 413. */
export function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        fail(new HttpError(413, "Request body too large"));
        // Stop reading; the response is still written by the caller.
        req.pause();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolveBody(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (error) => fail(error));
    req.on("close", () => fail(new HttpError(400, "Request aborted")));
  });
}

/** Parse a JSON object body; anything else is a 400, never a 500. */
export function parseJsonObject(text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "JSON body must be an object");
  }
  return value as Record<string, unknown>;
}

/** Base64 length of `bytes` raw bytes (with padding). */
export function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Validate remote image attachments. Only the image formats the desktop
 * composer accepts get through, and each one must actually be that format:
 * the declared mimeType must match the decoded bytes, so arbitrary files
 * cannot be smuggled to the agent labelled as images.
 */
export function parsePromptImages(value: unknown): PromptImagePayload[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, "images must be an array");
  if (value.length > MAX_PROMPT_IMAGES) {
    throw new HttpError(400, `A prompt can contain at most ${MAX_PROMPT_IMAGES} images`);
  }
  return value.map((item, index) => {
    const label = `Image ${index + 1}`;
    if (!item || typeof item !== "object") throw new HttpError(400, `${label} is invalid`);
    const { data, mimeType } = item as { data?: unknown; mimeType?: unknown };
    if (typeof mimeType !== "string" || !isPromptImageMimeType(mimeType)) {
      throw new HttpError(400, `${label}: only PNG, JPEG, GIF, and WebP images are allowed`);
    }
    if (typeof data !== "string" || !data || data.length % 4 !== 0 || !BASE64_RE.test(data)) {
      throw new HttpError(400, `${label} is not valid base64`);
    }
    if (data.length > base64Length(MAX_PROMPT_IMAGE_BYTES)) {
      throw new HttpError(413, `${label} exceeds the 10 MiB limit`);
    }
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > MAX_PROMPT_IMAGE_BYTES) {
      throw new HttpError(413, `${label} exceeds the 10 MiB limit`);
    }
    if (sniffPromptImageMimeType(bytes) !== mimeType) {
      throw new HttpError(400, `${label} content does not match ${mimeType}`);
    }
    return { data, mimeType };
  });
}

/** Absolute path of `rel` inside `root`, or null if it would escape `root`. */
export function resolveWithin(root: string, rel: string): string | null {
  const base = resolve(root);
  const target = resolve(base, rel);
  const within = relative(base, target);
  if (!within || within.startsWith("..") || isAbsolute(within)) return null;
  return target;
}

/** Strip control characters so remote input cannot forge extra log lines. */
export function sanitizeLogText(text: string, maxLength = 2_000): string {
  // eslint-disable-next-line no-control-regex
  return text.slice(0, maxLength).replace(/[\u0000-\u001f\u007f]+/g, " ");
}

/** Headers on every response: no sniffing, no referrers, never framed. */
export const BASE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/**
 * CSP for the PWA shell. The app keeps its token in localStorage, so injected
 * script would be able to steal it: scripts and connections are same-origin
 * only. Inline styles stay allowed for framer-motion's style attributes.
 */
export const REMOTE_PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");
