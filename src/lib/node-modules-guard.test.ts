import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findForeignNestedNodeModules, nodeModulesGuardPlugin } from "./node-modules-guard.ts";

describe("node_modules guard", () => {
  let base: string;
  let project: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "nm-guard-"));
    project = join(base, "worktree");
    mkdirSync(join(project, "node_modules"), { recursive: true });
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("passes a normal install", () => {
    expect(findForeignNestedNodeModules(project)).toBeNull();
    expect(() => nodeModulesGuardPlugin(project).configResolved()).not.toThrow();
  });

  it("tolerates a nested link back to the project's own install", () => {
    symlinkSync(join(project, "node_modules"), join(project, "node_modules", "node_modules"));
    expect(findForeignNestedNodeModules(project)).toBeNull();
  });

  it("rejects a nested link into another checkout's install", () => {
    const other = join(base, "main", "node_modules");
    mkdirSync(other, { recursive: true });
    symlinkSync(other, join(project, "node_modules", "node_modules"));
    expect(findForeignNestedNodeModules(project)?.link).toBe(
      join(project, "node_modules", "node_modules"),
    );
    expect(() => nodeModulesGuardPlugin(project).configResolved()).toThrow(/duplicate React/);
  });

  it("ignores a dangling nested link", () => {
    symlinkSync(join(base, "gone"), join(project, "node_modules", "node_modules"));
    expect(findForeignNestedNodeModules(project)).toBeNull();
  });
});
