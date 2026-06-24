import { afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

mock.module("electron", () => ({ app: { getPath: () => tmpdir() } }));

let root: string | null = null;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  delete process.env.PIPPER_LIBRARY_PATH;
  rmSync(join(tmpdir(), "pipper"), { recursive: true, force: true });
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
    writeFileSync(join(source, "AGENT.md"), "agent rules");
    writeFileSync(join(source, "DESIGN.md"), "design rules");
    writeFileSync(join(source, "patch.md"), "custom intent");
    writeFileSync(join(source, "blind.md"), "old investigation");
    writeFileSync(join(source, "node_modules", "dependency", "index.js"), "ignored");
    copyManagedWorkspace(source, destination);
    expect(existsSync(join(destination, ".git", "HEAD"))).toBeTrue();
    expect(existsSync(join(destination, "AGENT.md"))).toBeTrue();
    expect(existsSync(join(destination, "DESIGN.md"))).toBeTrue();
    expect(existsSync(join(destination, "patch.md"))).toBeTrue();
    expect(existsSync(join(destination, "blind.md"))).toBeFalse();
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

  test("promotion returns a receipt with swap heads", async () => {
    const { getActivePath, getCandidatePath, getPreviousPath, promoteCandidate } =
      await import("./workspace-manager.ts");
    root = mkdtempSync(join(tmpdir(), "pipper-promotion-"));
    process.env.PIPPER_LIBRARY_PATH = root;
    const active = getActivePath();
    const candidate = getCandidatePath();
    mkdirSync(active, { recursive: true });
    mkdirSync(candidate, { recursive: true });
    for (const workspace of [active, candidate]) {
      execFileSync("git", ["init"], { cwd: workspace });
      writeFileSync(join(workspace, "package.json"), "{}\n");
      execFileSync("git", ["add", "."], { cwd: workspace });
      execFileSync("git", ["commit", "-m", "init"], {
        cwd: workspace,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Pipper",
          GIT_AUTHOR_EMAIL: "pipper@internal",
          GIT_COMMITTER_NAME: "Pipper",
          GIT_COMMITTER_EMAIL: "pipper@internal",
        },
      });
    }
    writeFileSync(join(candidate, "app.ts"), "updated\n");
    execFileSync("git", ["add", "."], { cwd: candidate });
    execFileSync("git", ["commit", "-m", "candidate"], {
      cwd: candidate,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Pipper",
        GIT_AUTHOR_EMAIL: "pipper@internal",
        GIT_COMMITTER_NAME: "Pipper",
        GIT_COMMITTER_EMAIL: "pipper@internal",
      },
    });

    const receipt = promoteCandidate();
    expect(existsSync(getPreviousPath())).toBeTrue();
    expect(receipt.active_head_after).toBe(receipt.candidate_head);
    expect(receipt.previous_path).toBe(getPreviousPath());
  });
});
