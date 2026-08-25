import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { WorkspaceGuard } from "./workspace-guard.ts";

/**
 * Containment behavior of the session path guard: a worktree-bound agent may
 * touch files under its own root (including paths that don't exist yet), and
 * must not escape via `..`, sibling-prefix names, or symlinked parents.
 */

describe("WorkspaceGuard", () => {
  let dir: string;
  let guard: WorkspaceGuard;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pipper-guard-"));
    guard = new WorkspaceGuard();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("allows targets inside the registered root", () => {
    const workspace = join(dir, "proj");
    mkdirSync(workspace);
    guard.register("s1", workspace);

    expect(() => guard.assertWithin("s1", join(workspace, "src", "app.ts"))).not.toThrow();
    expect(() => guard.assertWithin("s1", workspace)).not.toThrow();
  });

  test("rejects traversal into a sibling worktree", () => {
    const worktreeA = join(dir, "proj", "worktree-a");
    const worktreeB = join(dir, "proj", "worktree-b");
    mkdirSync(worktreeA, { recursive: true });
    mkdirSync(worktreeB, { recursive: true });
    guard.register("s1", worktreeA);

    expect(() => guard.assertWithin("s1", join(worktreeB, "secret.txt"))).toThrow(
      "Path outside workspace",
    );
    // Prefix confusion: /proj-evil must not pass for root /proj.
    const evil = `${worktreeA}-evil`;
    mkdirSync(evil, { recursive: true });
    expect(() => guard.assertWithin("s1", join(evil, "x.txt"))).toThrow("Path outside workspace");
  });

  test("resolves not-yet-created files through their deepest existing ancestor", () => {
    const workspace = join(dir, "proj");
    mkdirSync(workspace);
    guard.register("s1", workspace);

    // The file and its parent directory do not exist yet; containment must
    // still hold by resolving the existing prefix.
    expect(() =>
      guard.assertWithin("s1", join(workspace, "new", "deep", "file.txt")),
    ).not.toThrow();
    expect(() =>
      guard.assertWithin("s1", join(workspace, "missing", "..", "escape.txt")),
    ).not.toThrow();
  });

  test("rejects escapes through a symlinked parent of an unwritten file", () => {
    const workspace = join(dir, "proj");
    const outside = join(dir, "outside");
    mkdirSync(workspace);
    mkdirSync(outside);
    symlinkSync(outside, join(workspace, "link"));
    guard.register("s1", workspace);

    // `workspace/link` does not exist as a directory entry below the link...
    // the link itself exists, so realpath resolves through it to /outside.
    expect(() => guard.assertWithin("s1", join(workspace, "link", "file.txt"))).toThrow(
      "Path outside workspace",
    );
  });

  test("unknown sessions are rejected, released sessions lose access", () => {
    const workspace = join(dir, "proj");
    mkdirSync(workspace);

    expect(() => guard.assertWithin("ghost", join(workspace, "x.txt"))).toThrow(
      "Path outside workspace",
    );

    guard.register("s1", workspace);
    expect(() => guard.assertWithin("s1", join(workspace, "x.txt"))).not.toThrow();
    guard.release("s1");
    expect(() => guard.assertWithin("s1", join(workspace, "x.txt"))).toThrow(
      "Path outside workspace",
    );
  });

  test("no session id is a no-op (caller never binds a session)", () => {
    expect(() => guard.assertWithin(undefined, join(dir, "anything"))).not.toThrow();
  });

  test("clear drops every registration", () => {
    const workspace = join(dir, "proj");
    mkdirSync(workspace);
    writeFileSync(join(workspace, "a.txt"), "x");
    guard.register("s1", workspace);
    guard.clear();

    expect(() => guard.assertWithin("s1", join(workspace, "a.txt"))).toThrow(
      "Path outside workspace",
    );
  });
});
