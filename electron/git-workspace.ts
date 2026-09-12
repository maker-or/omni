import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  WorkspaceGitFile,
  WorkspaceGitStatus,
  WorkspacePr,
  WorkspacePrCheck,
  WorkspacePrCheckState,
  WorkspacePrComment,
  WorkspacePrDeployment,
} from "../contracts/git.ts";
import { gitBinary } from "./worktree-manager.ts";

/**
 * First-party git operations for the advanced workspace UI.
 * Electron-free except for node builtins (unit-testable like worktree-manager).
 * Every operation is scoped to a worktree path; callers must ensure the path
 * belongs to a known project.
 */

const MAX_PANEL_FILES = 30;
const GH_AVAILABLE_TTL_MS = 60_000;

const execFileAsync = promisify(execFile);

function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key === "GIT_ALTERNATE_OBJECT_DIRECTORIES" ||
      key === "GIT_COMMON_DIR" ||
      key === "GIT_DIR" ||
      key === "GIT_GRAFT_FILE" ||
      key === "GIT_IMPLICIT_WORK_TREE" ||
      key === "GIT_INDEX_FILE" ||
      key === "GIT_OBJECT_DIRECTORY" ||
      key === "GIT_PREFIX" ||
      key === "GIT_REPLACE_REF_BASE" ||
      key === "GIT_SHALLOW_FILE" ||
      key === "GIT_WORK_TREE" ||
      key.startsWith("GIT_CONFIG")
    ) {
      delete env[key];
    }
  }
  return env;
}

function git(cwd: string, args: string[], timeoutMs = 60_000): string {
  const out = execFileSync(gitBinary(), args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: cleanGitEnv(),
    timeout: timeoutMs,
  });
  // Trailing trim only: porcelain status records carry a significant leading
  // space (" M file" = unstaged modification) that String.trim() would eat.
  return out.replace(/[\r\n]+$/, "");
}

function tryGit(cwd: string, args: string[]): string | null {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

/**
 * Async twin of `git()` for the polled status query and network-bound
 * actions (push, PR) so they never block the main process event loop.
 */
async function gitAsync(cwd: string, args: string[], timeoutMs = 60_000): Promise<string> {
  const { stdout } = await execFileAsync(gitBinary(), args, {
    cwd,
    encoding: "utf8",
    env: cleanGitEnv(),
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.replace(/[\r\n]+$/, "");
}

async function tryGitAsync(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await gitAsync(cwd, args);
  } catch {
    return null;
  }
}

async function gh(cwd: string, args: string[], timeoutMs = 60_000): Promise<string> {
  const { stdout } = await execFileAsync(ghBinary(), args, {
    cwd,
    encoding: "utf8",
    env: cleanGitEnv(),
    timeout: timeoutMs,
  });
  return stdout.trim();
}

const GH_CANDIDATES =
  process.platform === "win32"
    ? [
        join(process.env["ProgramFiles"] ?? "C:\\Program Files", "GitHub CLI", "gh.exe"),
        join(process.env["LOCALAPPDATA"] ?? "", "Programs", "GitHub CLI", "gh.exe"),
      ]
    : ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"];

/**
 * Absolute `gh` binary, PATH-independent like `gitBinary()`: an app launched
 * from the Dock/Finder gets a minimal PATH without Homebrew, and a bare "gh"
 * would silently read as "not installed" (no PR, no checks) in the panel.
 */
export function ghBinary(): string {
  const pathEnv = process.env.PATH ?? "";
  const delimiter = process.platform === "win32" ? ";" : ":";
  const exe = process.platform === "win32" ? "gh.exe" : "gh";
  for (const dir of pathEnv.split(delimiter).filter(Boolean)) {
    const candidate = join(dir, exe);
    if (existsSync(candidate)) return candidate;
  }
  for (const candidate of GH_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return "gh";
}

let ghAvailableCache: { value: boolean; expiresAt: number } | null = null;

/**
 * Whether the GitHub CLI can be run. Cached briefly: the status poll asks
 * every 15s and spawning `gh --version` each time is pure overhead.
 */
export function isGhAvailable(): boolean {
  if (ghAvailableCache && ghAvailableCache.expiresAt > Date.now()) return ghAvailableCache.value;
  let value = false;
  try {
    execFileSync(ghBinary(), ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    value = true;
  } catch {
    value = false;
  }
  ghAvailableCache = { value, expiresAt: Date.now() + GH_AVAILABLE_TTL_MS };
  return value;
}

async function remoteOrigin(cwd: string): Promise<{ host: string | null; url: string | null }> {
  const url = await tryGitAsync(cwd, ["remote", "get-url", "origin"]);
  if (!url) return { host: null, url: null };
  // git@github.com:owner/repo.git  |  https://github.com/owner/repo.git
  const scp = url.match(/@([^:]+):/);
  if (scp?.[1]) return { host: scp[1], url };
  try {
    return { host: new URL(url).hostname || null, url };
  } catch {
    return { host: null, url };
  }
}

async function parseStatusFiles(
  cwd: string,
): Promise<{ files: WorkspaceGitFile[]; truncated: boolean }> {
  const out = await tryGitAsync(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const files: WorkspaceGitFile[] = [];
  if (!out) return { files, truncated: false };
  const records = out.split("\0");
  let truncated = false;
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (!record || record.length < 4) continue;
    const code = record.slice(0, 2);
    const path = record.slice(3);
    if (code.includes("R") || code.includes("C")) i += 1; // skip rename source
    let status: WorkspaceGitFile["status"] | null = null;
    if (code === "??") status = "untracked";
    else if (code === "!!") continue;
    else if (code.includes("R") || code.includes("C")) status = "renamed";
    else if (code.includes("D")) status = "deleted";
    else if (code.includes("A")) status = "added";
    else if (code.includes("M") || code.includes("T") || code.includes("U")) status = "modified";
    if (!status) continue;
    if (files.length >= MAX_PANEL_FILES) {
      truncated = true;
      continue;
    }
    files.push({ path, staged: code[0] !== " " && code[0] !== "?", status });
  }
  return { files, truncated };
}

type PrSummary = {
  number: number | null;
  url: string | null;
  isDraft: boolean;
  checksState: WorkspaceGitStatus["checksState"];
  checks: WorkspacePrCheck[];
  mergedNumber: number | null;
  mergedUrl: string | null;
  pr: WorkspacePr | null;
};

const NO_PR: PrSummary = {
  number: null,
  url: null,
  isDraft: false,
  checksState: "unknown",
  checks: [],
  mergedNumber: null,
  mergedUrl: null,
  pr: null,
};

const PR_BODY_MAX = 20_000;
const COMMENT_BODY_MAX = 4_000;
const COMMENT_LIMIT = 30;

/** `owner/name` from an origin URL (ssh or https), or null for non-GitHub. */
export function parseGitHubRepo(remoteUrl: string): { owner: string; name: string } | null {
  const match = remoteUrl.trim().match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (!match) return null;
  return { owner: match[1]!, name: match[2]! };
}

/** One round-trip for everything the panel shows about the branch's PR. */
const PR_QUERY = `
query($owner: String!, $name: String!, $branch: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $branch, states: [OPEN, MERGED], first: 5,
                 orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number title body isDraft state url
        commits(last: 1) { nodes { commit {
          deployments(last: 10) { nodes {
            environment state latestStatus { state environmentUrl logUrl }
          } }
          statusCheckRollup { contexts(first: 100) { nodes {
            __typename
            ... on CheckRun { name status conclusion startedAt completedAt detailsUrl }
            ... on StatusContext { context state targetUrl createdAt }
          } } }
        } } }
        comments(last: ${COMMENT_LIMIT}) { nodes {
          id author { login avatarUrl } body url createdAt
        } }
        reviewThreads(first: ${COMMENT_LIMIT}) { nodes {
          isResolved
          comments(first: 1) { nodes {
            id author { login avatarUrl } body url createdAt path line
          } }
        } }
      }
    }
  }
}`;

/** Shape of one `pullRequests.nodes[]` entry from PR_QUERY (all optional: be lenient). */
export interface GhPrNode {
  number: number;
  title?: string | null;
  body?: string | null;
  isDraft?: boolean | null;
  state?: string | null;
  url?: string | null;
  commits?: {
    nodes?: Array<{
      commit?: {
        deployments?: { nodes?: GhDeploymentNode[] | null } | null;
        statusCheckRollup?: { contexts?: { nodes?: GhCheckContext[] | null } | null } | null;
      } | null;
    }> | null;
  } | null;
  comments?: { nodes?: GhCommentNode[] | null } | null;
  reviewThreads?: {
    nodes?: Array<{
      isResolved?: boolean | null;
      comments?: { nodes?: GhCommentNode[] | null } | null;
    }> | null;
  } | null;
}

export interface GhDeploymentNode {
  environment?: string | null;
  state?: string | null;
  latestStatus?: {
    state?: string | null;
    environmentUrl?: string | null;
    logUrl?: string | null;
  } | null;
}

/** CheckRun or StatusContext from statusCheckRollup.contexts. */
export interface GhCheckContext {
  __typename?: string;
  // CheckRun
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  detailsUrl?: string | null;
  // StatusContext
  context?: string | null;
  state?: string | null;
  targetUrl?: string | null;
  createdAt?: string | null;
}

interface GhCommentNode {
  id?: string | null;
  author?: { login?: string | null; avatarUrl?: string | null } | null;
  body?: string | null;
  url?: string | null;
  createdAt?: string | null;
  path?: string | null;
  line?: number | null;
}

function checkStateOf(entry: GhCheckContext): WorkspacePrCheckState {
  if (entry.__typename === "StatusContext") {
    const state = (entry.state ?? "").toUpperCase();
    if (state === "SUCCESS") return "passing";
    if (state === "FAILURE" || state === "ERROR") return "failing";
    return "pending";
  }
  if ((entry.status ?? "").toUpperCase() !== "COMPLETED") return "pending";
  const conclusion = (entry.conclusion ?? "").toUpperCase();
  if (
    ["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(conclusion)
  )
    return "failing";
  if (conclusion === "SKIPPED" || conclusion === "NEUTRAL") return "skipped";
  return "passing";
}

/**
 * Pure CI summary over statusCheckRollup contexts (unit-tested without `gh`).
 * Re-runs repeat a check name — the most recently started one wins so a
 * green re-run hides its red predecessor, exactly as GitHub shows it.
 */
export function summarizeChecks(entries: GhCheckContext[]): {
  checksState: WorkspaceGitStatus["checksState"];
  checks: WorkspacePrCheck[];
} {
  const byName = new Map<string, { startedAt: number; check: WorkspacePrCheck }>();
  for (const entry of entries) {
    const name = (entry.__typename === "StatusContext" ? entry.context : entry.name) ?? "check";
    const started = Date.parse(entry.startedAt ?? entry.createdAt ?? "") || 0;
    const completed = Date.parse(entry.completedAt ?? "") || 0;
    const check: WorkspacePrCheck = {
      name,
      state: checkStateOf(entry),
      durationMs: started && completed && completed >= started ? completed - started : null,
      url: entry.detailsUrl ?? entry.targetUrl ?? null,
    };
    const existing = byName.get(name);
    if (!existing || started >= existing.startedAt) byName.set(name, { startedAt: started, check });
  }
  const checks = [...byName.values()].map((item) => item.check);
  if (checks.length === 0) return { checksState: "none", checks };
  if (checks.some((check) => check.state === "failing")) return { checksState: "failing", checks };
  if (checks.some((check) => check.state === "pending")) return { checksState: "pending", checks };
  return { checksState: "passing", checks };
}

function deploymentOf(node: GhDeploymentNode): WorkspacePrDeployment {
  const status = (node.latestStatus?.state ?? node.state ?? "").toUpperCase();
  const state: WorkspacePrDeployment["state"] =
    status === "SUCCESS" || status === "ACTIVE"
      ? "success"
      : status === "ERROR" || status === "FAILURE"
        ? "failure"
        : status === "INACTIVE" || status === "DESTROYED"
          ? "inactive"
          : "pending";
  return {
    environment: node.environment ?? "deployment",
    state,
    url: node.latestStatus?.environmentUrl ?? node.latestStatus?.logUrl ?? null,
  };
}

function commentOf(node: GhCommentNode, fallbackId: string): WorkspacePrComment {
  return {
    id: node.id ?? fallbackId,
    author: node.author?.login ?? "unknown",
    avatarUrl: node.author?.avatarUrl ?? null,
    body: (node.body ?? "").slice(0, COMMENT_BODY_MAX),
    url: node.url ?? null,
    createdAt: node.createdAt ?? "",
    path: node.path ?? null,
    line: node.line ?? null,
  };
}

/** Pure selection over PR_QUERY nodes: open PR wins, else newest merged. */
export function summarizePrNodes(nodes: GhPrNode[]): PrSummary {
  const open = nodes.find((node) => (node.state ?? "").toUpperCase() === "OPEN");
  const merged = nodes.find((node) => (node.state ?? "").toUpperCase() === "MERGED");
  const node = open ?? merged;
  if (!node) return NO_PR;
  const commit = node.commits?.nodes?.[0]?.commit;
  const summary = summarizeChecks(commit?.statusCheckRollup?.contexts?.nodes ?? []);
  const issueComments = (node.comments?.nodes ?? []).map((item, index) =>
    commentOf(item, `c${index}`),
  );
  const reviewComments = (node.reviewThreads?.nodes ?? [])
    .filter((thread) => !thread.isResolved)
    .flatMap((thread, index) =>
      (thread.comments?.nodes ?? []).slice(0, 1).map((item) => commentOf(item, `r${index}`)),
    );
  const pr: WorkspacePr = {
    number: node.number,
    url: node.url ?? "",
    title: node.title ?? "",
    body: (node.body ?? "").slice(0, PR_BODY_MAX),
    isDraft: node.isDraft ?? false,
    state: open ? "open" : "merged",
    deployments: (commit?.deployments?.nodes ?? []).map(deploymentOf),
    comments: [...issueComments, ...reviewComments],
  };
  if (open) {
    return {
      number: node.number,
      url: pr.url,
      isDraft: pr.isDraft,
      ...summary,
      mergedNumber: null,
      mergedUrl: null,
      pr,
    };
  }
  return { ...NO_PR, mergedNumber: node.number, mergedUrl: pr.url, pr };
}

/**
 * PR picture for the branch in one `gh api graphql` round-trip: the open PR
 * (draft flag, CI, deployments, comments) or — once nothing is open — the
 * last merged one. Never throws — `gh` auth/network failures read as
 * "no PR known".
 */
async function lookupPr(
  cwd: string,
  branch: string | null,
  remoteUrl: string | null,
): Promise<PrSummary> {
  const repo = remoteUrl ? parseGitHubRepo(remoteUrl) : null;
  if (!branch || !repo || !isGhAvailable()) return NO_PR;
  try {
    const out = await gh(
      cwd,
      [
        "api",
        "graphql",
        "-f",
        `query=${PR_QUERY}`,
        "-f",
        `owner=${repo.owner}`,
        "-f",
        `name=${repo.name}`,
        "-f",
        `branch=${branch}`,
      ],
      30_000,
    );
    const parsed = JSON.parse(out) as {
      data?: { repository?: { pullRequests?: { nodes?: GhPrNode[] } | null } | null };
    };
    return summarizePrNodes(parsed.data?.repository?.pullRequests?.nodes ?? []);
  } catch {
    return NO_PR;
  }
}

/**
 * Full git picture for one workspace worktree. Never throws — degrades to
 * isRepo:false. Async end to end: this is polled by the panel, and a slow
 * `gh` round-trip must not stall every other IPC in the app.
 */
export async function getWorkspaceGitStatus(worktreePath: string): Promise<WorkspaceGitStatus> {
  const degraded: WorkspaceGitStatus = {
    isRepo: false,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    aheadOfBase: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    files: [],
    truncated: false,
    remoteHost: null,
    ghAvailable: isGhAvailable(),
    openPrNumber: null,
    openPrUrl: null,
    isDraftPr: false,
    mergedPrNumber: null,
    mergedPrUrl: null,
    checksState: "unknown",
    checks: [],
    pr: null,
  };
  if (!existsSync(worktreePath)) return degraded;
  if ((await tryGitAsync(worktreePath, ["rev-parse", "--git-dir"])) === null) return degraded;
  try {
    const branchRaw = await tryGitAsync(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = !branchRaw || branchRaw === "HEAD" ? null : branchRaw;
    const upstream =
      (await tryGitAsync(worktreePath, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{u}",
      ])) || null;
    // Commits beyond the base branch: what a PR would contain.
    const base = await branchBaseAsync(worktreePath);
    const baseCount = base
      ? await tryGitAsync(worktreePath, ["rev-list", "--count", `${base}..HEAD`])
      : null;
    const aheadOfBase = baseCount && Number.isFinite(Number(baseCount)) ? Number(baseCount) : 0;
    let ahead = 0;
    let behind = 0;
    if (upstream) {
      const counts = await tryGitAsync(worktreePath, [
        "rev-list",
        "--left-right",
        "--count",
        "HEAD...@{u}",
      ]);
      if (counts) {
        const [a, b] = counts.split(/\s+/).map(Number);
        ahead = Number.isFinite(a) ? a : 0;
        behind = Number.isFinite(b) ? b : 0;
      }
    } else {
      // No upstream yet: "ahead" means commits a first push would publish.
      // Keeps local-only work visible as unpushed instead of reading like a
      // fresh worktree.
      ahead = aheadOfBase;
    }
    const [{ files, truncated }, origin] = await Promise.all([
      parseStatusFiles(worktreePath),
      remoteOrigin(worktreePath),
    ]);
    const host = origin.host;
    let staged = 0;
    let unstaged = 0;
    let untracked = 0;
    for (const file of files) {
      if (file.status === "untracked") untracked += 1;
      else if (file.staged) staged += 1;
      else unstaged += 1;
    }
    const pr = host === "github.com" ? await lookupPr(worktreePath, branch, origin.url) : NO_PR;
    return {
      isRepo: true,
      branch,
      upstream,
      ahead,
      behind,
      aheadOfBase,
      staged,
      unstaged,
      untracked,
      files,
      truncated,
      remoteHost: host,
      ghAvailable: isGhAvailable(),
      openPrNumber: pr.number,
      openPrUrl: pr.url,
      isDraftPr: pr.isDraft,
      mergedPrNumber: pr.mergedNumber,
      mergedPrUrl: pr.mergedUrl,
      checksState: pr.checksState,
      checks: pr.checks,
      pr: pr.pr,
    };
  } catch {
    return degraded;
  }
}

/** Stage everything and commit. Returns the short hash on success. */
export function commitWorkspace(worktreePath: string, message: string): string {
  const trimmed = message.trim();
  if (!trimmed) throw new Error("Commit message is empty.");
  assertInsideRepo(worktreePath);
  // Fail fast with a readable error instead of git's "Author identity unknown"
  // wall. Env-provided identity (CI, tests) counts — same rule git applies.
  const ident = tryGit(worktreePath, ["var", "GIT_AUTHOR_IDENT"]);
  if (!ident) {
    throw new Error(
      "Git identity is missing: set user.name and user.email (repo-local config or global) before committing.",
    );
  }
  git(worktreePath, ["add", "-A"]);
  git(worktreePath, ["commit", "-m", trimmed]);
  return git(worktreePath, ["rev-parse", "--short", "HEAD"]);
}

/** Push the current branch; sets upstream on first push. */
export async function pushWorkspace(worktreePath: string): Promise<void> {
  assertInsideRepo(worktreePath);
  const upstream = await tryGitAsync(worktreePath, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ]);
  const branch = await gitAsync(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  // Generous timeout: first pushes and slow networks take a while, but a
  // credential prompt must never hang the UI forever (stdin is ignored).
  if (upstream) await gitAsync(worktreePath, ["push"], 120_000);
  else await gitAsync(worktreePath, ["push", "-u", "origin", branch], 120_000);
}

/** Create a GitHub PR for the workspace branch via `gh`. Returns the PR URL. */
export async function createWorkspacePr(
  worktreePath: string,
  title: string,
  body?: string,
  draft = false,
): Promise<string> {
  assertInsideRepo(worktreePath);
  if (!isGhAvailable()) throw new Error("GitHub CLI (gh) is not installed.");
  const branch = await gitAsync(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  // A PR with zero unique commits is rejected server-side with GraphQL noise —
  // catch it here with a message that says what to do instead.
  const base = await branchBaseAsync(worktreePath);
  const unique = base
    ? await tryGitAsync(worktreePath, ["rev-list", "--count", `${base}..HEAD`])
    : null;
  if (unique !== null && Number(unique) === 0) {
    const dirty = await tryGitAsync(worktreePath, ["status", "--porcelain"]);
    throw new Error(
      dirty
        ? `Branch "${branch}" has no commits beyond ${base ?? "the base branch"} — commit your changes first, then create the PR.`
        : `Branch "${branch}" has no commits beyond ${base ?? "the base branch"} — nothing to open a PR for.`,
    );
  }
  // Draft PRs require an explicit body when non-interactive — derive one from
  // the branch commits when the caller has none.
  const finalBody = body?.trim() || (await defaultPrBody(worktreePath, branch, base));
  const args = ["pr", "create", "--head", branch, "--title", title.trim() || branch];
  if (draft) args.push("--draft");
  args.push("--body", finalBody);
  const out = await gh(worktreePath, args, 120_000);
  return out.split("\n").at(-1) ?? "";
}

/** Base ref for branch comparisons: advertised remote default, else local main. */
async function branchBaseAsync(worktreePath: string): Promise<string | null> {
  return (
    (await tryGitAsync(worktreePath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])) ??
    ((await tryGitAsync(worktreePath, ["rev-parse", "--verify", "--quiet", "main"]))
      ? "main"
      : null)
  );
}

/** Fallback PR body: the branch's commit subjects, else the branch name. */
async function defaultPrBody(
  worktreePath: string,
  branch: string,
  base: string | null,
): Promise<string> {
  const range = base ? `${base}..HEAD` : "-n 10 HEAD";
  const log = await tryGitAsync(worktreePath, ["log", "--pretty=format:- %s", range]);
  if (log) return log.split("\n").slice(0, 20).join("\n");
  return branch;
}

/**
 * Merge the open PR for the workspace branch on GitHub (`gh pr merge`).
 * The branch itself is kept — the worktree stays checked out on it.
 */
export async function mergeWorkspacePr(worktreePath: string, prNumber: number): Promise<string> {
  assertInsideRepo(worktreePath);
  if (!isGhAvailable()) throw new Error("GitHub CLI (gh) is not installed.");
  await gh(worktreePath, ["pr", "merge", String(prNumber), "--merge"], 120_000);
  return `PR #${prNumber} merged.`;
}

/** Flip a draft PR to "ready for review" (`gh pr ready`). */
export async function markWorkspacePrReady(
  worktreePath: string,
  prNumber: number,
): Promise<string> {
  assertInsideRepo(worktreePath);
  if (!isGhAvailable()) throw new Error("GitHub CLI (gh) is not installed.");
  await gh(worktreePath, ["pr", "ready", String(prNumber)], 60_000);
  return `PR #${prNumber} marked ready for review.`;
}

/**
 * Merge the workspace branch into the repo's base branch inside the project
 * root checkout. Refuses when either side is dirty so agent work is never
 * merged over uncommitted state.
 */
export function mergeWorkspaceBranch(projectPath: string, branch: string): string {
  assertInsideRepo(projectPath);
  if (!branch.trim()) throw new Error("No branch to merge.");
  const dirty = tryGit(projectPath, ["status", "--porcelain"]);
  if (dirty) throw new Error("Project checkout has uncommitted changes — commit or stash first.");
  const base =
    tryGit(projectPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])?.replace(
      /^origin\//,
      "",
    ) ??
    tryGit(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"]) ??
    "main";
  const current = tryGit(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (current !== base) git(projectPath, ["checkout", base]);
  try {
    git(projectPath, ["merge", "--no-ff", branch]);
  } catch (err) {
    // Never leave the project checkout wedged in MERGING state — a failed
    // panel merge must read as an error, not a broken repo.
    try {
      git(projectPath, ["merge", "--abort"]);
    } catch {
      // Best effort: the original error below is what matters.
    }
    throw err;
  }
  return base;
}

/** Initialize a fresh repo at the project path and wire the user's identity. */
export function initProjectRepo(
  projectPath: string,
  identity: { name?: string | null; email?: string | null },
  defaultBranch = "main",
): void {
  if (!existsSync(projectPath)) throw new Error(`Project path does not exist: ${projectPath}`);
  git(projectPath, ["init", "-b", defaultBranch]);
  if (identity.name) git(projectPath, ["config", "user.name", identity.name]);
  if (identity.email) git(projectPath, ["config", "user.email", identity.email]);
}

function assertInsideRepo(cwd: string): void {
  try {
    git(cwd, ["rev-parse", "--git-dir"]);
  } catch {
    throw new Error(`Not a git repository: ${cwd}`);
  }
}
