import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import {
  createWorktree,
  isLiveWorktree,
  listBranches,
  listChildWorktrees,
  listWorktrees,
  parseWorktreePorcelain,
  switchWorktreeBranch,
} from "./worktree-manager.ts";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

let root: string;
let projectPath: string;
const PROJECT_ID = "proj-abc";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV }).trim();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pipper-worktree-"));
  // Worktrees land under this root instead of ~/.pipper/worktrees.
  process.env.PIPPER_WORKTREES_PATH = join(root, "worktrees");

  projectPath = join(root, "project");
  execFileSync("git", ["init", "-b", "main", projectPath], { env: GIT_ENV });
  writeFileSync(join(projectPath, "README.md"), "hello");
  writeFileSync(join(projectPath, ".gitignore"), ".env*\n");
  git(projectPath, ["add", "-A"]);
  git(projectPath, ["commit", "-m", "initial"]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.PIPPER_WORKTREES_PATH;
});

describe("createWorktree", () => {
  test("adds a worktree on an auto-generated branch off the default branch", () => {
    const worktree = createWorktree({ projectPath, projectId: PROJECT_ID, name: "Feature X" });

    expect(worktree.branch).toBe("pipper/feature-x");
    expect(existsSync(worktree.path)).toBe(true);
    expect(worktree.path).toContain(join("worktrees", PROJECT_ID, "feature-x"));

    // Git knows about it as a worktree on the expected branch.
    const listed = parseWorktreePorcelain(
      execFileSync("git", ["worktree", "list", "--porcelain"], {
        cwd: projectPath,
        encoding: "utf8",
      }),
    );
    const entry = listed.find((w) => w.path === worktree.path);
    expect(entry?.branch).toBe("pipper/feature-x");
    expect(worktree.head).toBe(git(projectPath, ["rev-parse", "HEAD"]));
  });

  test("suffixes the branch name when the auto branch already exists", () => {
    // A pre-existing branch (path is still free) forces the -2 suffix.
    git(projectPath, ["branch", "pipper/dup"]);
    const worktree = createWorktree({ projectPath, projectId: PROJECT_ID, name: "dup" });
    expect(worktree.branch).toBe("pipper/dup-2");
  });

  test("seeds gitignored .env files with mode 0600", () => {
    writeFileSync(join(projectPath, ".env"), "SECRET=1");
    writeFileSync(join(projectPath, ".env.local"), "LOCAL=1");

    const worktree = createWorktree({ projectPath, projectId: PROJECT_ID, name: "seeded" });

    const seeded = join(worktree.path, ".env");
    expect(existsSync(seeded)).toBe(true);
    expect(existsSync(join(worktree.path, ".env.local"))).toBe(true);
    // Owner read/write only.
    expect(statSync(seeded).mode & 0o777).toBe(0o600);
  });

  test("does not follow a symlinked source during the seed", () => {
    const outside = join(root, "outside-secret");
    writeFileSync(outside, "STOLEN=1");
    symlinkSync(outside, join(projectPath, ".env"));
    // Sanity: the source really is a symlink.
    expect(lstatSync(join(projectPath, ".env")).isSymbolicLink()).toBe(true);

    const worktree = createWorktree({ projectPath, projectId: PROJECT_ID, name: "symlink" });

    // The symlinked secret must not be copied into the worktree.
    expect(existsSync(join(worktree.path, ".env"))).toBe(false);
  });

  test("does not clobber a tracked file of the same name", () => {
    // Track a .keep file matching a custom include glob, with distinct content.
    writeFileSync(join(projectPath, "config.tracked"), "TRACKED");
    git(projectPath, ["add", "-A"]);
    git(projectPath, ["commit", "-m", "add tracked"]);

    const worktree = createWorktree({
      projectPath,
      projectId: PROJECT_ID,
      name: "clobber",
      includeGlobs: ["config.tracked"],
    });

    // The worktree's tracked copy is preserved (not overwritten by the seed).
    expect(statSync(join(worktree.path, "config.tracked")).mode & 0o777).not.toBe(0o600);
  });

  test("rejects a non-git directory", () => {
    const notRepo = join(root, "plain");
    writeFileSync(join(root, "plain-marker"), "x");
    expect(() =>
      createWorktree({ projectPath: notRepo, projectId: PROJECT_ID, name: "x" }),
    ).toThrow();
  });
});

describe("listWorktrees / isLiveWorktree", () => {
  test("lists the main tree plus created worktrees", () => {
    const worktree = createWorktree({ projectPath, projectId: PROJECT_ID, name: "listed" });
    const mainReal = realpathSync(projectPath);
    const all = listWorktrees(projectPath);
    expect(all.some((w) => w.path === mainReal)).toBe(true);
    expect(all.some((w) => w.path === worktree.path)).toBe(true);
    expect(all.find((w) => w.path === mainReal)).toMatchObject({
      isProjectRoot: true,
      workspaceName: "main",
      branch: "main",
    });
    expect(isLiveWorktree(worktree.path)).toBe(true);
    expect(isLiveWorktree(join(root, "does-not-exist"))).toBe(false);
  });

  test("always resolves one annotated root, even when the path doesn't match an entry", () => {
    // Project added as a subdirectory of the repo: canonical(subdir) matches no
    // worktree path, so the root must fall back to git's first (main) entry —
    // otherwise the title bar can't resolve a current workspace name/branch.
    const subdir = join(projectPath, "packages", "app");
    mkdirSync(subdir, { recursive: true });
    const all = listWorktrees(subdir);
    const roots = all.filter((w) => w.isProjectRoot);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.workspaceName).toBe("main");
    expect(roots[0]?.branch).toBe("main");
    // Every entry has a non-empty workspace name (never undefined → "Workspace").
    expect(all.every((w) => Boolean(w.workspaceName))).toBe(true);
  });

  test("listChildWorktrees excludes the main working tree", () => {
    const worktree = createWorktree({ projectPath, projectId: PROJECT_ID, name: "child" });
    const children = listChildWorktrees(projectPath);
    const mainReal = realpathSync(projectPath);
    expect(children.some((w) => w.path === mainReal)).toBe(false);
    expect(children.some((w) => w.path === worktree.path)).toBe(true);
  });

  test("lists local branches with their checked-out worktrees", () => {
    const worktree = createWorktree({ projectPath, projectId: PROJECT_ID, name: "branch-owner" });
    const branches = listBranches(projectPath);

    expect(branches).toContainEqual({ name: "main", worktreePath: realpathSync(projectPath) });
    expect(branches).toContainEqual({ name: "pipper/branch-owner", worktreePath: worktree.path });
  });

  test("switches an available branch inside the selected worktree", () => {
    git(projectPath, ["branch", "feature/header"]);

    const switched = switchWorktreeBranch(projectPath, projectPath, "feature/header");

    expect(switched.branch).toBe("feature/header");
    expect(switched.isProjectRoot).toBe(true);
    expect(git(projectPath, ["branch", "--show-current"])).toBe("feature/header");
  });
});

describe("parseWorktreePorcelain", () => {
  test("parses paths, HEADs, branches, and detached entries", () => {
    const out = [
      "worktree /repo/main",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /repo/wt",
      "HEAD def456",
      "detached",
      "",
    ].join("\n");
    const parsed = parseWorktreePorcelain(out);
    expect(parsed).toEqual([
      { path: "/repo/main", head: "abc123", branch: "main" },
      { path: "/repo/wt", head: "def456", branch: null },
    ]);
  });
});
