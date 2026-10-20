import { WeightedLruCache } from "./weighted-lru-cache.ts";

export const HIGHLIGHT_CACHE_MAX_BYTES = 8 * 1024 * 1024;
export const highlightedCodeCache = new WeightedLruCache<string, string>({
  maxEntries: 256,
  maxBytes: HIGHLIGHT_CACHE_MAX_BYTES,
  // Conservative UTF-16 string storage estimate, including source in the key.
  weigh: (key, html) => 2 * (key.length + html.length),
});
