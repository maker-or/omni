import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertUpdateTransition,
  createIdleUpdateState,
  readUpdateState,
  writeUpdateStateAtomic,
} from "./update-state.ts";

let temporaryPath: string | null = null;
afterEach(() => {
  if (temporaryPath) rmSync(temporaryPath, { recursive: true, force: true });
  temporaryPath = null;
});

describe("update state", () => {
  test("validates transitions", () => {
    expect(() => assertUpdateTransition("available", "preparing")).not.toThrow();
    expect(() => assertUpdateTransition("idle", "promoting")).toThrow("Invalid update transition");
  });

  test("writes and reads complete state atomically", () => {
    temporaryPath = mkdtempSync(join(tmpdir(), "pipper-state-"));
    const path = join(temporaryPath, "updates", "state.json");
    const state = { ...createIdleUpdateState(), phase: "available" as const, to_version: "0.2.0" };
    writeUpdateStateAtomic(path, state);
    expect(JSON.parse(readFileSync(path, "utf8")).to_version).toBe("0.2.0");
    expect(readUpdateState(path).phase).toBe("available");
  });
});
