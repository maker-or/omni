import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BASE_FETCH_INTERVAL_MS,
  commitWorkspace,
  getWorkspaceGitStatus,
  initProjectRepo,
  isGhAvailable,
  mergeWorkspaceBranch,
  parseGitHubRepo,
  parseNumstat,
  refreshBaseBranch,
  resetBaseFetchesForTests,
  resolvePrWithCache,
  summarizeChecks,
  summarizePrNodes,
  summarizeStatusPorcelain,
} from "./git-workspace.ts";

const GIT_ENV: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
Object.assign(GIT_ENV, {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
});

let dir: string;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV }).trim();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "git-workspace-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("getWorkspaceGitStatus", () => {
  test("non-repo degrades to isRepo:false without throwing", async () => {
    const status = await getWorkspaceGitStatus(dir);
    expect(status.isRepo).toBe(false);
    expect(status.branch).toBeNull();
  });

  test("clean repo reports branch with zero counts", async () => {
    initProjectRepo(dir, { name: "Test", email: "test@example.com" });
    writeFileSync(join(dir, "a.txt"), "hi");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "init"]);
    const status = await getWorkspaceGitStatus(dir);
    expect(status.isRepo).toBe(true);
    expect(status.branch).toBe("main");
    expect(status.upstream).toBeNull();
    expect(status.staged + status.unstaged + status.untracked).toBe(0);
    expect(status.files).toEqual([]);
  });

  test("dirty files are counted and listed", async () => {
    initProjectRepo(dir, { name: "Test", email: "test@example.com" });
    writeFileSync(join(dir, "a.txt"), "hi");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "init"]);
    writeFileSync(join(dir, "a.txt"), "changed");
    writeFileSync(join(dir, "new.txt"), "untracked");
    const status = await getWorkspaceGitStatus(dir);
    expect(status.unstaged).toBe(1);
    expect(status.untracked).toBe(1);
    expect(status.files.map((f) => f.path).sort()).toEqual(["a.txt", "new.txt"]);
    const modified = status.files.find((f) => f.path === "a.txt");
    expect(modified).toMatchObject({ additions: 1, deletions: 1 });
    const untracked = status.files.find((f) => f.path === "new.txt");
    expect(untracked).toMatchObject({ additions: 1, deletions: 0 });
  });

  test("branch without upstream counts commits beyond main as ahead", async () => {
    initProjectRepo(dir, { name: "Test", email: "test@example.com" });
    writeFileSync(join(dir, "a.txt"), "base");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "base"]);
    git(dir, ["checkout", "-b", "side"]);
    expect((await getWorkspaceGitStatus(dir)).ahead).toBe(0);
    writeFileSync(join(dir, "b.txt"), "side");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "side change"]);
    const status = await getWorkspaceGitStatus(dir);
    expect(status.upstream).toBeNull();
    expect(status.ahead).toBe(1);
    expect(status.aheadOfBase).toBe(1);
  });

  test("a request issued mid-flight still sees state from its own request time", async () => {
    initProjectRepo(dir, { name: "Test", email: "test@example.com" });
    writeFileSync(join(dir, "a.txt"), "hi");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "init"]);
    // Kick off a run, mutate the worktree, then ask again while the first
    // run may still be in flight: coalescing must queue a follow-up run, not
    // hand back the stale in-flight answer.
    const first = getWorkspaceGitStatus(dir);
    writeFileSync(join(dir, "late.txt"), "late");
    const second = await getWorkspaceGitStatus(dir);
    expect(second.files.map((f) => f.path)).toContain("late.txt");
    await first;
  });

  test("in-sync branch still reports commits beyond base", async () => {
    initProjectRepo(dir, { name: "Test", email: "test@example.com" });
    writeFileSync(join(dir, "a.txt"), "base");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "base"]);
    git(dir, ["checkout", "-b", "side"]);
    writeFileSync(join(dir, "b.txt"), "side");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "side change"]);
    // Fake a pushed branch: a remote-tracking ref plus tracking config.
    git(dir, ["remote", "add", "origin", dir]);
    git(dir, ["update-ref", "refs/remotes/origin/side", "HEAD"]);
    git(dir, ["config", "branch.side.remote", "origin"]);
    git(dir, ["config", "branch.side.merge", "refs/heads/side"]);
    const status = await getWorkspaceGitStatus(dir);
    expect(status.upstream).toBe("origin/side");
    expect(status.ahead).toBe(0);
    expect(status.aheadOfBase).toBe(1);
  });

  test("counts commits on a local base branch the workspace lacks, with no fetch", async () => {
    initProjectRepo(dir, { name: "Test", email: "test@example.com" });
    writeFileSync(join(dir, "a.txt"), "base");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "base"]);
    git(dir, ["checkout", "-b", "side"]);
    git(dir, ["checkout", "main"]);
    writeFileSync(join(dir, "b.txt"), "moved on");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "main moved"]);
    git(dir, ["checkout", "side"]);
    const status = await getWorkspaceGitStatus(dir);
    expect(status.baseBranch).toBe("main");
    expect(status.behindBase).toBe(1);
    expect(status.aheadOfBase).toBe(0);
    expect(status.baseFetchedAt).toBeNull();
  });
});

/**
 * A bare origin plus two clones: `work` is the user's workspace, `other` is
 * a teammate who pushes to main behind their back.
 */
function setUpTeamRepo(): { work: string; other: string } {
  git(dir, ["init", "--bare", "--initial-branch=main", "origin.git"]);
  const origin = join(dir, "origin.git");
  const work = join(dir, "work");
  mkdirSync(work);
  initProjectRepo(work, { name: "Test", email: "test@example.com" });
  writeFileSync(join(work, "a.txt"), "base");
  git(work, ["add", "-A"]);
  git(work, ["commit", "-m", "base"]);
  git(work, ["remote", "add", "origin", origin]);
  git(work, ["push", "-u", "origin", "main"]);
  git(work, ["remote", "set-head", "origin", "main"]);
  git(work, ["checkout", "-b", "side"]);
  git(dir, ["clone", "--quiet", origin, "other"]);
  return { work, other: join(dir, "other") };
}

function teammatePushes(other: string, file: string): void {
  writeFileSync(join(other, file), "teammate");
  git(other, ["add", "-A"]);
  git(other, ["commit", "-m", `teammate adds ${file}`]);
  git(other, ["push", "--quiet", "origin", "main"]);
}

describe("base branch fetch", () => {
  afterEach(() => {
    resetBaseFetchesForTests();
  });

  test("a teammate's push to main shows up as behindBase after a fetch", async () => {
    const { work, other } = setUpTeamRepo();
    teammatePushes(other, "b.txt");
    // Nothing has fetched yet: the remote-tracking ref is still at "base".
    const before = await getWorkspaceGitStatus(work);
    expect(before.baseBranch).toBe("origin/main");
    expect(before.behindBase).toBe(0);
    await refreshBaseBranch(work, { base: "origin/main", upstream: null }, { force: true });
    const after = await getWorkspaceGitStatus(work);
    expect(after.behindBase).toBe(1);
    expect(after.aheadOfBase).toBe(0);
    expect(after.baseFetchedAt).not.toBeNull();
  });

  test("status kicks off a fetch in the background and the next poll sees it", async () => {
    const { work, other } = setUpTeamRepo();
    teammatePushes(other, "b.txt");
    resetBaseFetchesForTests();
    const first = await getWorkspaceGitStatus(work);
    expect(first.behindBase).toBe(0);
    // The fetch started by the poll above is still running; await it via the
    // throttle (same window, so this returns the in-flight promise).
    await refreshBaseBranch(work, { base: "origin/main", upstream: null });
    const second = await getWorkspaceGitStatus(work);
    expect(second.behindBase).toBe(1);
  });

  test("fetches are throttled per workspace until forced", async () => {
    const { work, other } = setUpTeamRepo();
    const now = Date.now();
    await refreshBaseBranch(work, { base: "origin/main", upstream: null }, { force: true, now });
    teammatePushes(other, "b.txt");
    // Inside the interval: no network round-trip, so the ref does not move.
    await refreshBaseBranch(work, { base: "origin/main", upstream: null }, { now: now + 1_000 });
    expect(git(work, ["rev-list", "--count", "HEAD..origin/main"])).toBe("0");
    await refreshBaseBranch(
      work,
      { base: "origin/main", upstream: null },
      { now: now + BASE_FETCH_INTERVAL_MS + 1 },
    );
    expect(git(work, ["rev-list", "--count", "HEAD..origin/main"])).toBe("1");
  });

  test("an unreachable origin resolves without throwing and leaves fetchedAt null", async () => {
    initProjectRepo(dir, { name: "Test", email: "test@example.com" });
    writeFileSync(join(dir, "a.txt"), "base");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "base"]);
    git(dir, ["remote", "add", "origin", join(dir, "does-not-exist.git")]);
    await expect(
      refreshBaseBranch(dir, { base: "origin/main", upstream: null }, { force: true }),
    ).resolves.toBeUndefined();
    const status = await getWorkspaceGitStatus(dir);
    expect(status.baseFetchedAt).toBeNull();
  });

  test("nothing under origin/ means no fetch at all", async () => {
    await expect(
      refreshBaseBranch(dir, { base: "main", upstream: null }, { force: true }),
    ).resolves.toBeUndefined();
  });
});

describe("summarizeStatusPorcelain", () => {
  const record = (code: string, path: string) => `${code} ${path}`;

  test("counts index and worktree columns independently", () => {
    const out = [
      record("MM", "both.ts"),
      record("M ", "staged.ts"),
      record(" M", "unstaged.ts"),
      record("A ", "new.ts"),
      record("??", "loose.ts"),
    ].join("\0");
    const summary = summarizeStatusPorcelain(out);
    // MM contributes to both totals; ?? only to untracked.
    expect(summary).toMatchObject({ staged: 3, unstaged: 2, untracked: 1, truncated: false });
    expect(summary.files.find((f) => f.path === "both.ts")).toMatchObject({
      staged: true,
      status: "modified",
    });
  });

  test("totals cover every record even when the file list is capped", () => {
    const records: string[] = [];
    for (let i = 0; i < 40; i += 1) records.push(record(" M", `m${i}.ts`));
    for (let i = 0; i < 5; i += 1) records.push(record("??", `u${i}.ts`));
    const summary = summarizeStatusPorcelain(records.join("\0"));
    expect(summary.files).toHaveLength(30);
    expect(summary.truncated).toBe(true);
    // Untracked files sit entirely past the cap yet still count.
    expect(summary).toMatchObject({ staged: 0, unstaged: 40, untracked: 5 });
  });
});

describe("parseNumstat", () => {
  test("parses additions and deletions per path", () => {
    const stats = parseNumstat("10\t2\tsrc/a.ts\0" + "0\t5\tsrc/b.ts\0");
    expect(stats.get("src/a.ts")).toEqual({ additions: 10, deletions: 2 });
    expect(stats.get("src/b.ts")).toEqual({ additions: 0, deletions: 5 });
  });

  test("attributes renames to the destination path", () => {
    const stats = parseNumstat("3\t4\t\0old.ts\0new.ts\0");
    expect(stats.get("new.ts")).toEqual({ additions: 3, deletions: 4 });
    expect(stats.has("old.ts")).toBe(false);
  });

  test("treats binary files as unknown line counts", () => {
    const stats = parseNumstat("-\t-\timg.png\0");
    expect(stats.get("img.png")).toEqual({ additions: null, deletions: null });
  });
});

describe("commitWorkspace", () => {
  test("stages everything and commits", () => {
    initProjectRepo(dir, { name: "Test", email: "test@example.com" });
    writeFileSync(join(dir, "a.txt"), "hi");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "init"]);
    writeFileSync(join(dir, "b.txt"), "more");
    const hash = commitWorkspace(dir, "second commit");
    expect(hash).toMatch(/^[0-9a-f]{7,}$/);
    expect(git(dir, ["log", "--oneline", "-1"])).toContain("second commit");
  });

  test("empty message throws", () => {
    initProjectRepo(dir, { name: "Test", email: "test@example.com" });
    expect(() => commitWorkspace(dir, "   ")).toThrow("Commit message is empty");
  });
});

describe("isGhAvailable", () => {
  test("resolves to a boolean without throwing", async () => {
    expect(typeof (await isGhAvailable())).toBe("boolean");
  });

  test("concurrent callers share one probe", async () => {
    const [first, second] = await Promise.all([isGhAvailable(), isGhAvailable()]);
    expect(first).toBe(second);
  });
});

describe("resolvePrWithCache", () => {
  test("returns the last successful PR snapshot when a refresh fails", async () => {
    const repository = `owner/repo-${Date.now()}`;
    const freshSummary = summarizePrNodes([
      { number: 42, url: "https://github.com/owner/repo/pull/42", state: "OPEN" },
    ]);

    const fresh = await resolvePrWithCache(repository, "feature", async () => freshSummary, 1000);
    expect(fresh).toMatchObject({
      dataState: "fresh",
      updatedAt: 1000,
      summary: { number: 42 },
    });

    const stale = await resolvePrWithCache(
      repository,
      "feature",
      async () => {
        throw new Error("network down");
      },
      2000,
    );
    expect(stale).toMatchObject({
      dataState: "stale",
      updatedAt: 1000,
      summary: { number: 42 },
    });
  });

  test("reports unavailable when refresh fails before any successful response", async () => {
    const result = await resolvePrWithCache(
      `owner/uncached-${Date.now()}`,
      "feature",
      async () => {
        throw new Error("offline");
      },
      2000,
    );
    expect(result).toMatchObject({
      dataState: "unavailable",
      updatedAt: null,
      summary: { number: null, pr: null },
    });
  });
});

describe("mergeWorkspaceBranch", () => {
  test("conflict aborts instead of wedging the checkout in MERGING state", () => {
    initProjectRepo(dir, { name: "Test", email: "test@example.com" });
    writeFileSync(join(dir, "a.txt"), "base");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "base"]);
    git(dir, ["checkout", "-b", "side"]);
    writeFileSync(join(dir, "a.txt"), "side");
    git(dir, ["commit", "-am", "side change"]);
    git(dir, ["checkout", "main"]);
    writeFileSync(join(dir, "a.txt"), "main");
    git(dir, ["commit", "-am", "main change"]);

    expect(() => mergeWorkspaceBranch(dir, "side")).toThrow();
    expect(existsSync(join(dir, ".git", "MERGE_HEAD"))).toBe(false);
    expect(git(dir, ["status", "--porcelain"])).toBe("");
  });

  test("merges into the conventional base even when another feature branch is checked out", () => {
    initProjectRepo(dir, { name: "Test", email: "test@example.com" });
    writeFileSync(join(dir, "a.txt"), "base");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "base"]);
    git(dir, ["checkout", "-b", "side"]);
    writeFileSync(join(dir, "b.txt"), "side");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "side change"]);
    // The project root is parked on an unrelated feature branch: that must
    // never become the merge target.
    git(dir, ["checkout", "-b", "other-feature", "main"]);

    expect(mergeWorkspaceBranch(dir, "side")).toBe("main");
    expect(git(dir, ["branch", "--show-current"])).toBe("main");
    expect(git(dir, ["log", "--oneline", "-1", "other-feature"])).toContain("base");
    expect(git(dir, ["log", "--oneline", "-1", "main"])).toContain("side");
  });

  test("refuses when no base branch can be determined", () => {
    initProjectRepo(dir, { name: "Test", email: "test@example.com" }, "trunk");
    writeFileSync(join(dir, "a.txt"), "base");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "base"]);
    git(dir, ["checkout", "-b", "side"]);
    writeFileSync(join(dir, "b.txt"), "side");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "side change"]);
    git(dir, ["checkout", "trunk"]);

    expect(() => mergeWorkspaceBranch(dir, "side")).toThrow(/base branch/);
    expect(git(dir, ["log", "--oneline", "-1", "trunk"])).toContain("base");
  });

  test("clean merge returns the base branch", () => {
    initProjectRepo(dir, { name: "Test", email: "test@example.com" });
    writeFileSync(join(dir, "a.txt"), "base");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "base"]);
    git(dir, ["checkout", "-b", "side"]);
    writeFileSync(join(dir, "b.txt"), "side");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "side change"]);
    git(dir, ["checkout", "main"]);

    expect(mergeWorkspaceBranch(dir, "side")).toBe("main");
    expect(git(dir, ["log", "--oneline", "-1"])).toContain("side");
  });
});

describe("summarizeChecks", () => {
  test("empty rollup means none", () => {
    expect(summarizeChecks([])).toEqual({ checksState: "none", checks: [] });
  });

  test("all completed successes means passing; skipped is not a failure", () => {
    const { checksState, checks } = summarizeChecks([
      {
        __typename: "CheckRun",
        name: "build",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:00:20Z",
        detailsUrl: "https://ci/1",
      },
      { __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "SKIPPED" },
      { __typename: "StatusContext", context: "CodeRabbit", state: "SUCCESS" },
    ]);
    expect(checksState).toBe("passing");
    expect(checks).toEqual([
      { name: "build", state: "passing", durationMs: 20_000, url: "https://ci/1" },
      { name: "lint", state: "skipped", durationMs: null, url: null },
      { name: "CodeRabbit", state: "passing", durationMs: null, url: null },
    ]);
  });

  test("incomplete runs mean pending", () => {
    expect(
      summarizeChecks([
        { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
        { __typename: "CheckRun", name: "e2e", status: "IN_PROGRESS" },
      ]).checksState,
    ).toBe("pending");
  });

  test("failures surface with names", () => {
    const { checksState, checks } = summarizeChecks([
      { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
      { __typename: "CheckRun", name: "e2e", status: "COMPLETED", conclusion: "FAILURE" },
    ]);
    expect(checksState).toBe("failing");
    expect(checks.map((c) => [c.name, c.state])).toEqual([
      ["build", "passing"],
      ["e2e", "failing"],
    ]);
  });

  test("re-runs dedupe by name with the latest start winning", () => {
    const { checksState, checks } = summarizeChecks([
      {
        __typename: "CheckRun",
        name: "react-doctor",
        status: "COMPLETED",
        conclusion: "FAILURE",
        startedAt: "2026-01-01T00:00:00Z",
      },
      {
        __typename: "CheckRun",
        name: "react-doctor",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        startedAt: "2026-01-01T00:05:00Z",
      },
    ]);
    expect(checks).toHaveLength(1);
    expect(checksState).toBe("passing");
  });
});

describe("summarizePrNodes", () => {
  const openNode = {
    number: 12,
    title: "Feature",
    body: "## Summary\nthing",
    isDraft: true,
    state: "OPEN",
    url: "https://github.com/o/r/pull/12",
    commits: {
      nodes: [
        {
          commit: {
            deployments: {
              nodes: [
                {
                  environment: "Preview",
                  state: "ACTIVE",
                  latestStatus: { state: "SUCCESS", environmentUrl: "https://preview" },
                },
              ],
            },
            statusCheckRollup: {
              contexts: {
                nodes: [
                  {
                    __typename: "CheckRun",
                    name: "build",
                    status: "COMPLETED",
                    conclusion: "SUCCESS",
                  },
                ],
              },
            },
          },
        },
      ],
    },
    comments: {
      nodes: [
        {
          id: "c1",
          author: { login: "bot", avatarUrl: null },
          body: "hi",
          url: "https://c/1",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    },
    reviewThreads: {
      nodes: [
        {
          isResolved: false,
          comments: {
            nodes: [
              {
                id: "r1",
                author: { login: "reviewer" },
                body: "fix this",
                path: "src/a.ts",
                line: 7,
              },
            ],
          },
        },
        { isResolved: true, comments: { nodes: [{ id: "r2", body: "done" }] } },
      ],
    },
  };

  test("open PR wins over an older merged one and carries full detail", () => {
    const summary = summarizePrNodes([openNode, { number: 7, url: "u7", state: "MERGED" }]);
    expect(summary.number).toBe(12);
    expect(summary.isDraft).toBe(true);
    expect(summary.checksState).toBe("passing");
    expect(summary.mergedNumber).toBeNull();
    expect(summary.pr?.state).toBe("open");
    expect(summary.pr?.title).toBe("Feature");
    expect(summary.pr?.deployments).toEqual([
      { environment: "Preview", state: "success", url: "https://preview" },
    ]);
    // Issue comment first, then only the unresolved review thread opener.
    expect(summary.pr?.comments.map((c) => c.id)).toEqual(["c1", "r1"]);
    expect(summary.pr?.comments[1]).toMatchObject({ path: "src/a.ts", line: 7 });
  });

  test("merged PR is reported only when nothing is open", () => {
    const summary = summarizePrNodes([{ number: 7, url: "u7", state: "MERGED", title: "Landed" }]);
    expect(summary.number).toBeNull();
    expect(summary.mergedNumber).toBe(7);
    expect(summary.pr).toMatchObject({ state: "merged", title: "Landed" });
  });

  test("no nodes means no PR", () => {
    expect(summarizePrNodes([])).toMatchObject({ number: null, mergedNumber: null, pr: null });
  });

  test("a fork's PR with the same head branch name is never selected", () => {
    const forkPr = {
      number: 99,
      state: "OPEN",
      url: "https://github.com/o/r/pull/99",
      isCrossRepository: true,
    };
    expect(summarizePrNodes([forkPr])).toMatchObject({
      number: null,
      mergedNumber: null,
      pr: null,
    });
    // Our own PR is still found behind it.
    expect(summarizePrNodes([forkPr, { ...openNode, isCrossRepository: false }]).number).toBe(12);
  });
});

describe("parseGitHubRepo", () => {
  test("parses ssh and https forms", () => {
    expect(parseGitHubRepo("git@github.com:maker-or/omni.git")).toEqual({
      owner: "maker-or",
      name: "omni",
    });
    expect(parseGitHubRepo("https://github.com/maker-or/omni.git")).toEqual({
      owner: "maker-or",
      name: "omni",
    });
    expect(parseGitHubRepo("https://github.com/maker-or/omni")).toEqual({
      owner: "maker-or",
      name: "omni",
    });
  });

  test("rejects non-GitHub remotes", () => {
    expect(parseGitHubRepo("git@gitlab.com:o/r.git")).toBeNull();
  });
});
