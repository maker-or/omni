import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    expect(() => assertUpdateTransition("failed", "available")).not.toThrow();
    expect(() => assertUpdateTransition("failed", "idle")).not.toThrow();
    expect(() => assertUpdateTransition("idle", "promoting")).toThrow("Invalid update transition");
  });

  test("writes and reads complete state atomically", () => {
    temporaryPath = mkdtempSync(join(tmpdir(), "pipper-state-"));
    const path = join(temporaryPath, "updates", "state.json");
    const state = {
      ...createIdleUpdateState(),
      phase: "available" as const,
      run_id: "run-1",
    };
    writeUpdateStateAtomic(path, state);
    expect(JSON.parse(readFileSync(path, "utf8")).run_id).toBe("run-1");
    expect(readUpdateState(path).phase).toBe("available");
  });

  test("drops legacy fields when reading old state", () => {
    temporaryPath = mkdtempSync(join(tmpdir(), "pipper-state-"));
    const path = join(temporaryPath, "updates", "state.json");
    writeUpdateStateAtomic(path, {
      ...createIdleUpdateState(),
      phase: "failed",
      error: "kept",
    });
    const raw = JSON.parse(readFileSync(path, "utf8"));
    raw.to_version = "0.2.0";
    raw.validation_results = [];
    raw.manifest = { version: "0.2.0" };
    writeUpdateStateAtomic(path, raw);
    const state = readUpdateState(path) as any;
    expect(state.error).toBe("kept");
    expect(state.to_version).toBeUndefined();
    expect(state.validation_results).toBeUndefined();
  });

  test("normalizes failed state so it cannot stay scheduled for quit", () => {
    temporaryPath = mkdtempSync(join(tmpdir(), "pipper-state-"));
    const path = join(temporaryPath, "updates", "state.json");
    writeUpdateStateAtomic(path, {
      ...createIdleUpdateState(),
      phase: "failed",
      scheduled_for_quit: true,
      error: "kept",
    });

    const state = readUpdateState(path);
    expect(state.phase).toBe("failed");
    expect(state.scheduled_for_quit).toBeFalse();
  });

  test("rejects structurally invalid persisted update state", () => {
    temporaryPath = mkdtempSync(join(tmpdir(), "pipper-state-"));
    const path = join(temporaryPath, "updates", "state.json");
    mkdirSync(join(temporaryPath, "updates"), { recursive: true });
    writeFileSync(path, JSON.stringify({ phase: "installing", scheduled_for_quit: "yes" }));

    expect(() => readUpdateState(path)).toThrow("Update state is unreadable");
  });
});
