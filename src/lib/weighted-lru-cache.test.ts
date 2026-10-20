import { expect, test } from "vitest";
import { WeightedLruCache } from "./weighted-lru-cache.ts";

test("keeps recently read values within both budgets", () => {
  const cache = new WeightedLruCache<string, string>({
    maxEntries: 2,
    maxBytes: 6,
    weigh: (_, value) => value.length,
  });
  cache.set("a", "aa");
  cache.set("b", "bb");
  expect(cache.get("a")).toBe("aa");
  cache.set("c", "cccc");
  expect(cache.get("b")).toBeUndefined();
  expect(cache.get("a")).toBe("aa");
  expect(cache.bytes).toBe(6);
  cache.set("a", "a");
  expect(cache.bytes).toBe(5);
  cache.set("huge", "1234567");
  expect(cache.get("huge")).toBeUndefined();
  expect(cache.get("c")).toBe("cccc");
  cache.clear();
  expect(cache.size).toBe(0);
  expect(cache.bytes).toBe(0);
});
