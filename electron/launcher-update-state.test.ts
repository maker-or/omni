import { describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertLauncherUpdateTransition,
  createIdleLauncherUpdateState,
  readLauncherUpdateState,
  writeLauncherUpdateStateAtomic,
} from "./launcher-update-state.ts";

describe("launcher update state", () => {
  test("enforces the state machine", () => {
    expect(() => assertLauncherUpdateTransition("idle", "checking")).not.toThrow();
    expect(() => assertLauncherUpdateTransition("idle", "downloaded")).toThrow();
    expect(() => assertLauncherUpdateTransition("downloading", "available")).not.toThrow();
  });

  test("persists owner-only atomic state", () => {
    const root = mkdtempSync(join(tmpdir(), "launcher-state-"));
    try {
      const path = join(root, "state.json");
      const state = createIdleLauncherUpdateState("0.1.0");
      writeLauncherUpdateStateAtomic(path, state);
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(state);
      expect(readLauncherUpdateState(path, "0.1.1").current_version).toBe("0.1.1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects structurally invalid persisted state", () => {
    const root = mkdtempSync(join(tmpdir(), "launcher-state-invalid-"));
    try {
      const path = join(root, "state.json");
      writeFileSync(path, JSON.stringify({ phase: "installing", downloaded_path: 42 }));
      expect(() => readLauncherUpdateState(path, "0.1.0")).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
