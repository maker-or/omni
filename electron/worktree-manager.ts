import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
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

let cachedUserSid: string | null = null;

/** The current user's SID (`S-1-5-…`). Cached: it cannot change mid-process. */
function currentUserSid(): string {
  if (cachedUserSid) return cachedUserSid;
  // `whoami /user /fo csv /nh` prints `"HOST\user","S-1-5-21-…"`.
  const stdout = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  // The SID is the trailing field; take the last match so an exotic host or
  // account name in the leading `HOST\user` field can't shadow it.
  const sid = stdout.match(/S-1-[\d-]+/g)?.at(-1);
  if (!sid) throw new Error("Could not resolve the current user's SID");
  cachedUserSid = sid;
  return sid;
}

/**
 * Restrict a file to its owner: no other *user* of the machine can read it.
 *
 * POSIX spells this as mode 0600. Windows has no POSIX mode bits — `chmod`
 * there only toggles the read-only flag, and `stat` reports 0o666 whatever you
 * do — so a seeded secret would otherwise keep the ACEs it inherited from the
 * parent directory. The equivalent is an explicit DACL: drop the inherited
 * ACEs, then grant this user.
 *
 * SYSTEM and Administrators survive this, because the file is created with the
 * process token's default DACL and those entries are explicit rather than
 * inherited. That is deliberate: an administrator can take ownership of any
 * file regardless of its DACL, so removing them buys nothing and would break
 * backup and antimalware services. Mode 0600 does not exclude root either.
 *
 * The owner gets full control rather than a literal read/write analogue of
 * 0600: `(R,W)` alone withholds DELETE, which would break the user's own tools
 * rewriting the file.
 *
 * Throws when the restriction cannot be applied, so the caller can delete the
 * file rather than leave a secret readable.
 */
function restrictToOwner(filePath: string): void {
  if (process.platform !== "win32") {
    chmodSync(filePath, 0o600);
    return;
  }
  // Grant against the SID rather than the account name: it is unambiguous
  // across domains and immune to the localized names icacls prints. Numeric
  // SIDs must carry the `*` prefix. Exit status, not the localized stdout, is
  // what signals failure here.
  execFileSync("icacls", [filePath, "/inheritance:r", "/grant:r", `*${currentUserSid()}:(F)`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Copy gitignored files matching the include list from the project root into the
 * worktree: allowlist-driven, top-level only, restricted to the owner,
 * destination asserted inside the worktree root, symlinked sources not
 * followed, existing (tracked) files never clobbered.
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

    let created = false;
    try {
      const contents = readFileSync(src);
      // Create the destination owner-only *before* the secret lands in it, and
      // write through the handle: `copyFileSync` would reset the mode to the
      // source's, leaving the secret briefly world-readable. `wx` also makes
      // the no-clobber rule above atomic rather than check-then-act.
      const fd = openSync(dest, "wx", 0o600);
      created = true;
      try {
        writeFileSync(fd, contents);
      } finally {
        closeSync(fd);
      }
      // Windows ignores the mode above; this is what actually restricts it
      // there, and normalizes an unusual umask on POSIX.
      restrictToOwner(dest);
    } catch {
      // Fail closed: a secret we could not restrict to its owner must not be
      // left behind. One bad file still doesn't abort the create.
      if (created) {
        try {
          rmSync(dest, { force: true });
        } catch {
          // nothing further we can do for this file
        }
      }
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

  try {
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
  } catch (err) {
    // Cleanup: remove the worktree and delete the newly created branch
    try {
      git(projectPath, ["worktree", "remove", worktreePath, "--force"]);
    } catch {
      // Best effort cleanup of worktree registration
    }
    try {
      git(projectPath, ["branch", "-D", branch]);
    } catch {
      // Best effort cleanup of branch
    }
    try {
      rmSync(worktreePath, { recursive: true, force: true });
    } catch {
      // Best effort cleanup of directory
    }
    throw err;
  }

  const head = git(worktreePath, ["rev-parse", "HEAD"]);
  // Same canonical form `listWorktrees` returns, so callers can match/exclude
  // entries from `git worktree list`.
  return { path: canonical(worktreePath), branch, head };
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
  const projectRoot = pathKey(projectPath);
  // Canonicalize up front so every path this module hands out is in one form.
  // Git reports POSIX separators and long names on Windows; callers compare
  // these against `createWorktree` results and stored paths, so the two must
  // agree exactly.
  const worktrees = parseWorktreePorcelain(stdout).map((worktree) => ({
    ...worktree,
    path: canonical(worktree.path),
  }));
  // git lists the main working tree first; use it as the root when the project
  // path doesn't canonical-match any entry (e.g. project added as a subdir).
  const rootEntry =
    worktrees.find((worktree) => pathKey(worktree.path) === projectRoot) ?? worktrees[0];
  const rootLabel = rootEntry
    ? resolveRepositoryDefaultBranch(projectPath, rootEntry.branch)
    : null;

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
  const targetPath = pathKey(worktreePath);
  const target = listWorktrees(projectPath).find(
    (worktree) => pathKey(worktree.path) === targetPath,
  );
  if (!target) throw new Error("Worktree is no longer available");
  if (!branchExists(projectPath, branch)) throw new Error(`Branch does not exist: ${branch}`);

  // execFileSync receives an argument array, and branchExists above constrains
  // this to a local ref, so no shell interpretation is possible here.
  git(target.path, ["switch", branch]);
  const switched = listWorktrees(projectPath).find(
    (worktree) => pathKey(worktree.path) === targetPath,
  );
  if (!switched) throw new Error("Worktree disappeared after switching branches");
  return switched;
}

/**
 * The OS's canonical form of a real path. `realpathSync.native` is required
 * rather than the JS implementation: on Windows only the native call expands
 * 8.3 short names (`RUNNER~1` → `runneradmin`) and resolves true on-disk
 * casing, which is the form `git worktree list` reports. Falls back to
 * `resolve` for paths that don't exist (they match no live worktree anyway).
 */
function canonical(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Comparison key for a path. Canonicalization alone isn't enough on Windows,
 * where the filesystem is case-insensitive and git and the OS may disagree on
 * casing. Never use this as a value — it is lossy; return `canonical` instead.
 */
function pathKey(path: string): string {
  const real = canonical(path);
  return process.platform === "win32" ? real.toLowerCase() : real;
}

/** True when two paths denote the same location on this platform. */
export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

/**
 * Worktrees nested under a project, excluding the project's own main working
 * tree. git canonicalizes (realpath) worktree paths, so the exclusion compares
 * realpaths — a plain string compare would leak the main tree when the project
 * path contains a symlink.
 */
export function listChildWorktrees(projectPath: string): Worktree[] {
  return listWorktrees(projectPath).filter((w) => !w.isProjectRoot);
}

/**
 * True when a bound worktree path still points at a live worktree — used to
 * validate a thread's stored `worktree_path` before binding a session to it.
 * A linked worktree has a `.git` *file* (gitdir pointer), not a directory.
 */
export function isLiveWorktree(worktreePath: string, projectPath: string): boolean {
  try {
    const canonicalTarget = pathKey(worktreePath);
    const worktrees = listWorktrees(projectPath);
    return worktrees.some((w) => pathKey(w.path) === canonicalTarget);
  } catch {
    return false;
  }
}
