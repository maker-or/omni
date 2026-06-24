import { afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

mock.module("electron", () => ({ app: { getPath: () => tmpdir() } }));

let root: string | null = null;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe("workspace copy policies", () => {
  test("managed candidates preserve git and patch context but exclude build products", async () => {
    const { copyManagedWorkspace } = await import("./workspace-manager.ts");
    root = mkdtempSync(join(tmpdir(), "pipper-copy-"));
    const source = join(root, "source");
    const destination = join(root, "candidate");
    mkdirSync(join(source, ".git"), { recursive: true });
    mkdirSync(join(source, "node_modules", "dependency"), { recursive: true });
    writeFileSync(join(source, ".git", "HEAD"), "ref: refs/heads/main");
    writeFileSync(join(source, "patch.md"), "custom intent");
    writeFileSync(join(source, "node_modules", "dependency", "index.js"), "ignored");
    copyManagedWorkspace(source, destination);
    expect(existsSync(join(destination, ".git", "HEAD"))).toBeTrue();
    expect(existsSync(join(destination, "patch.md"))).toBeTrue();
    expect(existsSync(join(destination, "node_modules"))).toBeFalse();
  });

  test("packaged templates exclude launcher code without dropping markdown", async () => {
    const { copyPackagedTemplate } = await import("./workspace-manager.ts");
    root = mkdtempSync(join(tmpdir(), "pipper-template-"));
    const source = join(root, "source");
    const destination = join(root, "active");
    mkdirSync(join(source, "electron"), { recursive: true });
    writeFileSync(join(source, "electron", "main.ts"), "launcher");
    writeFileSync(join(source, ".gitignore"), "node_modules\n");
    writeFileSync(join(source, "patch.md"), "context");
    copyPackagedTemplate(source, destination);
    expect(existsSync(join(destination, "electron"))).toBeFalse();
    expect(existsSync(join(destination, ".gitignore"))).toBeTrue();
    expect(existsSync(join(destination, "patch.md"))).toBeTrue();
  });
});
