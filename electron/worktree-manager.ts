import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { GitBranch, Worktree } from "../contracts/worktrees.ts";

/**
 * Worktree ("workspace") support — Phase 1: create + list.
 *
 * Git is the source of truth: every worktree is reported by
 * `git worktree list --porcelain` and persisted in `.git/worktrees/`. This
 * module is deliberately electron-free (only node builtins) so it can be unit
 * tested without mocking the app, and stateless (plain functions, matching
 * `projects.ts`/`threads.ts`) — there is no app-only state to hold this phase.
 */

/** Default gitignored files seeded into a fresh worktree. */
const DEFAULT_INCLUDE_GLOBS = [".env*"];

/**
 * Never copied during the env seed even if a custom include list matches them —
 * these are the setup script's job (it may symlink them into the main checkout).
 */
const SEED_EXCLUSIONS = new Set(["node_modules", "dist", "out", "build", ".git", ".cache"]);

export interface CreateWorktreeOptions {
  /** The project's repo root — the `git worktree add` anchor. */
  projectPath: string;
  /** Stable, fs-safe project identity (its `id`), used for the on-disk slug. */
  projectId: string;
  /** Human label; derives the leaf dir name and the auto branch. */
  name: string;
  /** Explicit branch name; auto-generated Conductor-style when omitted. */
  branch?: string;
  /**
   * Override the gitignored-file include list. Precedence otherwise:
   * `.worktreeinclude` (repo root) → this → default `.env*`.
   * Custom patterns *replace* the default (they don't merge).
   */
  includeGlobs?: string[];
  /**
   * Trusted, user-authored command run once after create with
   * `WORKSPACE_PATH` / `ROOT_PATH` / `WORKSPACE_NAME` in env. May deliberately
   * reach into the main checkout (e.g. symlink `node_modules`).
   */
  setupScript?: string;
}

/**
 * Root under which all worktrees live: `~/.pipper/worktrees` (Conductor style),
 * overridable via `PIPPER_WORKTREES_PATH`. A home dotdir, distinct from the
 * app's self-update library (`~/Library/pipper` on macOS) — no collision.
 */
export function getWorktreesRoot(): string {
  return process.env.PIPPER_WORKTREES_PATH || join(homedir(), ".pipper", "worktrees");
}

/** Lowercase, fs-safe slug; falls back to "workspace" when nothing survives. */
function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "workspace";
}

/** `<root>/<projectId>/<name-slug>` — outside the main working tree. */
export function worktreePathFor(projectId: string, name: string): string {
  return join(getWorktreesRoot(), projectId, slugify(name));
}

function git(projectPath: string, args: string[]): string {
  // Capture (don't inherit) stderr: several probes below expect failure and
  // catch it — inheriting would spam the app log with `fatal:` noise.
  return execFileSync("git", args, {
    cwd: projectPath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * The repo's default branch to base new worktrees on: `origin/HEAD` when a
 * remote advertises one, else the currently checked-out branch, else HEAD.
 */
function resolveBaseBranch(projectPath: string): string {
  try {
    const ref = git(projectPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    // e.g. "origin/main" → "main"
    const slash = ref.indexOf("/");
    if (slash >= 0) return ref.slice(slash + 1);
  } catch {
    // no remote / no origin HEAD
  }
  try {
    const current = git(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (current && current !== "HEAD") return current;
  } catch {
    // detached or no commits
  }
  return "HEAD";
}

/** True when a branch ref already exists locally. */
function branchExists(projectPath: string, branch: string): boolean {
  try {
    git(projectPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Auto branch name, Conductor style: `pipper/<name-slug>`, suffixed `-2`, `-3`…
 * on collision. The agent renames it on first chat.
 */
function resolveBranchName(projectPath: string, name: string): string {
  const base = `pipper/${slugify(name)}`;
  if (!branchExists(projectPath, base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!branchExists(projectPath, candidate)) return candidate;
  }
  throw new Error(`Could not find a free branch name for "${name}".`);
}

/** Convert a gitignore-ish glob (only `*`/`?`) to an anchored regex. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

/**
 * The gitignored-file include list. Precedence: `.worktreeinclude` (repo root,
 * one gitignore-style pattern per line, `#` comments) → explicit override →
 * default `.env*`. Custom patterns replace the default.
 */
function resolveIncludeGlobs(projectPath: string, override?: string[]): string[] {
  const file = join(projectPath, ".worktreeinclude");
  if (existsSync(file)) {
    try {
      const patterns = readFileSync(file, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      if (patterns.length > 0) return patterns;
    } catch {
      // fall through to override/default
    }
  }
  if (override && override.length > 0) return override;
  return DEFAULT_INCLUDE_GLOBS;
}

/**
 * Copy gitignored files matching the include list from the project root into the
 * worktree: allowlist-driven, top-level only, mode 0600, destination asserted
 * inside the worktree root, symlinked sources not followed, existing (tracked)
 * files never clobbered.
 */
function seedGitignoredFiles(projectPath: string, worktreePath: string, override?: string[]): void {
  const globs = resolveIncludeGlobs(projectPath, override).map(globToRegExp);
  const worktreeReal = resolve(worktreePath);

  let entries: string[];
  try {
    entries = readdirSync(projectPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SEED_EXCLUSIONS.has(entry)) continue;
    if (!globs.some((re) => re.test(entry))) continue;

    const src = join(projectPath, entry);
    // Never follow a symlinked source: it could resolve outside the project and
    // hand the worktree a writable path back into another tree.
    let stat;
    try {
      stat = lstatSync(src);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue; // skips symlinks and directories

    const dest = join(worktreePath, entry);
    // Assert the destination stays inside the worktree root.
    const rel = relative(worktreeReal, resolve(dest));
    if (rel.startsWith("..") || rel === "") continue;
    // Don't clobber blindly — a tracked file of the same name is already present.
    if (existsSync(dest)) continue;

    try {
      copyFileSync(src, dest);
      chmodSync(dest, 0o600);
    } catch {
      // best effort per file — one unreadable secret shouldn't abort create
    }
  }
}

function runSetupScript(
  script: string,
  ctx: { worktreePath: string; rootPath: string; name: string },
): void {
  execFileSync(process.platform === "win32" ? "cmd" : "/bin/sh", ["-c", script], {
    cwd: ctx.worktreePath,
    encoding: "utf8",
    env: {
      ...process.env,
      WORKSPACE_PATH: ctx.worktreePath,
      ROOT_PATH: ctx.rootPath,
      WORKSPACE_NAME: ctx.name,
    },
  });
}

/**
 * Create a worktree off `projectPath`: add the git worktree on a fresh branch,
 * seed gitignored files (`.env*`), then run the optional setup script.
 */
export function createWorktree(options: CreateWorktreeOptions): Worktree {
  const { projectPath, projectId, name } = options;
  if (!existsSync(join(projectPath, ".git"))) {
    throw new Error(`Not a git repository: ${projectPath}`);
  }

  const worktreePath = worktreePathFor(projectId, name);
  if (existsSync(worktreePath)) {
    throw new Error(`A worktree already exists at ${worktreePath}`);
  }

  const branch = options.branch ?? resolveBranchName(projectPath, name);
  if (branchExists(projectPath, branch)) {
    throw new Error(`Branch already exists: ${branch}`);
  }
  const base = resolveBaseBranch(projectPath);

  // `git worktree add` needs the leaf absent but the parent present.
  mkdirSync(dirname(worktreePath), { recursive: true });

  // 1. Add the worktree on a new branch off the base branch.
  git(projectPath, ["worktree", "add", worktreePath, "-b", branch, base]);

  // 2. Seed gitignored files (untrusted data, allowlisted, contained).
  seedGitignoredFiles(projectPath, worktreePath, options.includeGlobs);

  // 3. Setup script (trusted, user-authored, may touch the main checkout).
  if (options.setupScript) {
    runSetupScript(options.setupScript, {
      worktreePath,
      rootPath: projectPath,
      name,
    });
  }

  const head = git(worktreePath, ["rev-parse", "HEAD"]);
  // git canonicalizes worktree paths (realpath); return the same form git
  // reports so callers can match/exclude entries from `git worktree list`.
  let canonical = worktreePath;
  try {
    canonical = realpathSync(worktreePath);
  } catch {
    // keep the constructed path
  }
  return { path: canonical, branch, head };
}

/** Parse `git worktree list --porcelain` into structured entries. */
export function parseWorktreePorcelain(stdout: string): Worktree[] {
  const worktrees: Worktree[] = [];
  let path: string | null = null;
  let head = "";
  let branch: string | null = null;

  const flush = () => {
    if (path) worktrees.push({ path, head, branch });
    path = null;
    head = "";
    branch = null;
  };

  for (const raw of stdout.split("\n")) {
    const line = raw.trimEnd();
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      // A new record starts; flush any in-progress one (defensive vs missing blank line).
      if (path) flush();
      path = line.slice("worktree ".length);
    } else if (line.startsWith("HEAD ")) {
      head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      // e.g. "branch refs/heads/main" → "main"
      branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line === "detached") {
      branch = null;
    }
  }
  flush();
  return worktrees;
}

/** List worktrees for a project live from git (no caching). Includes the main tree. */
export function listWorktrees(projectPath: string): Worktree[] {
  const stdout = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: projectPath,
    encoding: "utf8",
  });
  const projectRoot = canonical(projectPath);
  const worktrees = parseWorktreePorcelain(stdout);
  // git lists the main working tree first; use it as the root when the project
  // path doesn't canonical-match any entry (e.g. project added as a subdir).
  const rootEntry =
    worktrees.find((worktree) => canonical(worktree.path) === projectRoot) ?? worktrees[0];
  const rootLabel = rootEntry ? resolveRepositoryDefaultBranch(projectPath, rootEntry.branch) : null;

  return worktrees.map((worktree) => {
    // Identity, not path comparison: guarantees exactly one root entry even when
    // canonicalization differs, so the UI always resolves a current workspace.
    const isProjectRoot = worktree === rootEntry;
    return {
      ...worktree,
      isProjectRoot,
      workspaceName: isProjectRoot
        ? (rootLabel ?? worktree.branch ?? "main")
        : (worktree.path.split(/[\\/]/).filter(Boolean).at(-1) ?? "worktree"),
    };
  });
}

/**
 * Git does not persist a display name for the root checkout. Prefer the
 * repository's advertised default branch, then its branch at the configured
 * project root. This intentionally never assumes a branch name in the UI.
 */
function resolveRepositoryDefaultBranch(
  projectPath: string,
  rootBranch: string | null,
): string | null {
  try {
    const remoteHead = git(projectPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    const slash = remoteHead.indexOf("/");
    if (slash >= 0) return remoteHead.slice(slash + 1);
  } catch {
    // A repository without an origin has no advertised default branch.
  }
  return rootBranch;
}

/** List local branches, annotated with the worktree Git says currently owns each one. */
export function listBranches(projectPath: string): GitBranch[] {
  const checkedOutByBranch = new Map(
    listWorktrees(projectPath)
      .filter((worktree): worktree is Worktree & { branch: string } => Boolean(worktree.branch))
      .map((worktree) => [worktree.branch, worktree.path]),
  );
  const stdout = git(projectPath, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  return stdout
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name, worktreePath: checkedOutByBranch.get(name) ?? null }));
}

/** Check out a local branch in a specific live worktree, then return its fresh Git state. */
export function switchWorktreeBranch(
  projectPath: string,
  worktreePath: string,
  branch: string,
): Worktree {
  const targetPath = canonical(worktreePath);
  const target = listWorktrees(projectPath).find(
    (worktree) => canonical(worktree.path) === targetPath,
  );
  if (!target) throw new Error("Worktree is no longer available");
  if (!branchExists(projectPath, branch)) throw new Error(`Branch does not exist: ${branch}`);

  // execFileSync receives an argument array, and branchExists above constrains
  // this to a local ref, so no shell interpretation is possible here.
  git(target.path, ["switch", branch]);
  const switched = listWorktrees(projectPath).find(
    (worktree) => canonical(worktree.path) === targetPath,
  );
  if (!switched) throw new Error("Worktree disappeared after switching branches");
  return switched;
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Worktrees nested under a project, excluding the project's own main working
 * tree. git canonicalizes (realpath) worktree paths, so the exclusion compares
 * realpaths — a plain string compare would leak the main tree when the project
 * path contains a symlink.
 */
export function listChildWorktrees(projectPath: string): Worktree[] {
  const mainReal = canonical(projectPath);
  return listWorktrees(projectPath).filter((w) => canonical(w.path) !== mainReal);
}

/**
 * True when a bound worktree path still points at a live worktree — used to
 * validate a thread's stored `worktree_path` before binding a session to it.
 * A linked worktree has a `.git` *file* (gitdir pointer), not a directory.
 */
export function isLiveWorktree(worktreePath: string): boolean {
  try {
    return existsSync(worktreePath) && existsSync(join(worktreePath, ".git"));
  } catch {
    return false;
  }
}
