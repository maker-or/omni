import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir, userInfo } from "node:os";
import { join, normalize } from "node:path";
import { realpathSync } from "node:fs";
import {
  createWorktree,
  isLiveWorktree,
  listBranches,
  listChildWorktrees,
  listWorktrees,
  parseWorktreePorcelain,
  resolveInstallCommand,
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

/** Same path form production code returns — realpath + normalize (Windows `/` vs `\`). */
function realPath(p: string): string {
  return normalize(realpathSync.native(p));
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV }).trim();
}

/**
 * Assert the OS itself grants nobody but the current user access to `filePath`.
 * The two platforms model access differently, so the same guarantee is read
 * back in each one's own terms — POSIX mode bits, or the Windows DACL.
 */
function expectOwnerOnly(filePath: string): void {
  if (process.platform !== "win32") {
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
    return;
  }
  // `icacls <file>` prints the path followed by one `PRINCIPAL:(rights)` ACE
  // per line, then a blank line before its summary.
  const stdout = execFileSync("icacls", [filePath], { encoding: "utf8" });
  const aces = (stdout.split(/\r?\n\s*\r?\n/)[0] ?? "")
    .replace(filePath, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  // No ACE may be inherited. icacls marks those `(I)`, and their absence is what
  // proves the restriction actually ran: the principals allowed below are the
  // machine's own default, so they would look identical if it had not.
  for (const ace of aces) {
    expect(ace, `DACL still inherits from the parent directory: ${ace}`).not.toContain("(I)");
  }

  // Windows puts SYSTEM and Administrators on essentially every file, and an
  // administrator can take ownership regardless of the DACL — excluding them is
  // unenforceable, exactly as mode 0600 does not exclude root on POSIX. The
  // guarantee under test is that no *other* principal (Everyone, Users,
  // Authenticated Users, a second account) is listed. An allowlist fails on any
  // principal nobody thought to blocklist.
  const owner = userInfo().username.toLowerCase();
  const isOwner = (ace: string) => ace.includes(`\\${owner}:`);
  for (const ace of aces) {
    const permitted =
      isOwner(ace.toLowerCase()) ||
      ace.toLowerCase().startsWith("nt authority\\system:") ||
      ace.toLowerCase().startsWith("builtin\\administrators:");
    expect(permitted, `unexpected principal in DACL: ${ace}`).toBe(true);
  }
  // An empty DACL is not "owner-only" — the owner must actually be granted.
  expect(aces.some((ace) => isOwner(ace.toLowerCase()))).toBe(true);
}

beforeEach(() => {
  // Canonicalize the root: Windows TEMP is an 8.3 short path
  // (`C:\Users\RUNNER~1\...`) while git reports the expanded long name, so a
  // raw mkdtemp path would never compare equal to a worktree git reports.
  root = realPath(mkdtempSync(join(tmpdir(), "pipper-worktree-")));
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
    // Porcelain paths are raw git output — POSIX separators and long names on
    // Windows — so they only compare against a canonical path once resolved.
    const entry = listed.find((w) => realPath(w.path) === worktree.path);
    expect(entry?.branch).toBe("pipper/feature-x");
    expect(worktree.head).toBe(git(projectPath, ["rev-parse", "HEAD"]));
  });

  test("suffixes the branch name when the auto branch already exists", () => {
    // A pre-existing branch (path is still free) forces the -2 suffix.
    git(projectPath, ["branch", "pipper/dup"]);
    const worktree = createWorktree({ projectPath, projectId: PROJECT_ID, name: "dup" });
    expect(worktree.branch).toBe("pipper/dup-2");
  });

  test("seeds gitignored .env files restricted to the owner", () => {
    writeFileSync(join(projectPath, ".env"), "SECRET=1");
    writeFileSync(join(projectPath, ".env.local"), "LOCAL=1");

    const worktree = createWorktree({ projectPath, projectId: PROJECT_ID, name: "seeded" });

    const seeded = join(worktree.path, ".env");
    expect(existsSync(seeded)).toBe(true);
    expect(readFileSync(seeded, "utf8")).toBe("SECRET=1");
    expect(existsSync(join(worktree.path, ".env.local"))).toBe(true);
    // The seed carries secrets out of the project checkout, so no other account
    // may read them — asserted in each platform's own access-control terms.
    expectOwnerOnly(seeded);
    expectOwnerOnly(join(worktree.path, ".env.local"));
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
    // Track a file matching a custom include glob.
    writeFileSync(join(projectPath, "config.tracked"), "TRACKED");
    git(projectPath, ["add", "-A"]);
    git(projectPath, ["commit", "-m", "add tracked"]);
    // Diverge the seed source from the committed content, so a clobber is
    // visible in the file itself rather than inferred from its mode.
    writeFileSync(join(projectPath, "config.tracked"), "SEEDED");

    const worktree = createWorktree({
      projectPath,
      projectId: PROJECT_ID,
      name: "clobber",
      includeGlobs: ["config.tracked"],
    });

    // The worktree's tracked copy is preserved (not overwritten by the seed).
    expect(readFileSync(join(worktree.path, "config.tracked"), "utf8")).toBe("TRACKED");
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
    const mainReal = realPath(projectPath);
    const all = listWorktrees(projectPath);
    expect(all.some((w) => w.path === mainReal)).toBe(true);
    expect(all.some((w) => w.path === worktree.path)).toBe(true);
    expect(all.find((w) => w.path === mainReal)).toMatchObject({
      isProjectRoot: true,
      workspaceName: "main",
      branch: "main",
    });
    expect(isLiveWorktree(worktree.path, projectPath)).toBe(true);
    expect(isLiveWorktree(join(root, "does-not-exist"), projectPath)).toBe(false);
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
    const mainReal = realPath(projectPath);
    expect(children.some((w) => w.path === mainReal)).toBe(false);
    expect(children.some((w) => w.path === worktree.path)).toBe(true);
  });

  test("lists local branches with their checked-out worktrees", () => {
    const worktree = createWorktree({ projectPath, projectId: PROJECT_ID, name: "branch-owner" });
    const branches = listBranches(projectPath);

    expect(branches).toContainEqual({
      name: "main",
      worktreePath: realPath(projectPath),
    });
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

describe("resolveInstallCommand", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pipper-install-detect-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("no package.json means nothing to install", () => {
    expect(resolveInstallCommand(dir)).toBeNull();
  });

  test("lockfile decides the package manager", () => {
    writeFileSync(join(dir, "package.json"), "{}");

    writeFileSync(join(dir, "bun.lock"), "");
    expect(resolveInstallCommand(dir)).toEqual({
      command: "bun",
      args: ["install"],
      manager: "bun",
    });
    rmSync(join(dir, "bun.lock"));

    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    expect(resolveInstallCommand(dir)?.manager).toBe("pnpm");
    rmSync(join(dir, "pnpm-lock.yaml"));

    writeFileSync(join(dir, "yarn.lock"), "");
    expect(resolveInstallCommand(dir)?.manager).toBe("yarn");
    rmSync(join(dir, "yarn.lock"));

    writeFileSync(join(dir, "package-lock.json"), "{}");
    expect(resolveInstallCommand(dir)?.manager).toBe("npm");
  });

  test("bun's lockfile outranks npm's when both exist", () => {
    writeFileSync(join(dir, "package.json"), "{}");
    writeFileSync(join(dir, "package-lock.json"), "{}");
    writeFileSync(join(dir, "bun.lockb"), "");
    expect(resolveInstallCommand(dir)?.manager).toBe("bun");
  });

  test("a bare package.json falls back to npm", () => {
    writeFileSync(join(dir, "package.json"), "{}");
    expect(resolveInstallCommand(dir)?.manager).toBe("npm");
  });
});
