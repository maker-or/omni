import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, linkSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("disk inventory deduplicates hard links and does not traverse external symlinks", async () => {
  const { measureDirectory } = await import(new URL("./audit-resources.mjs", import.meta.url).href);
  const root = mkdtempSync(join(tmpdir(), "pipper-disk-audit-"));
  try {
    const tree = join(root, "worktree");
    mkdirSync(tree);
    const modules = join(tree, "node_modules");
    mkdirSync(modules);
    const external = join(root, "outside");
    mkdirSync(external);
    writeFileSync(join(modules, "file"), "dependency");
    linkSync(join(modules, "file"), join(modules, "hardlink"));
    writeFileSync(join(external, "large"), Buffer.alloc(1024 * 1024));
    // Windows junctions avoid requiring symlink privileges for this directory link.
    symlinkSync(external, join(tree, "linked"), process.platform === "win32" ? "junction" : "dir");
    const usage = await measureDirectory(tree);
    expect(usage.logicalBytes).toBe(10);
    expect(usage.categories.dependencies.files).toBe(1);
    expect(usage.symlinks).toBe(1);
    expect(usage.errors).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
