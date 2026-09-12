import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commitWorkspace,
  getWorkspaceGitStatus,
  initProjectRepo,
  isGhAvailable,
  mergeWorkspaceBranch,
  parseGitHubRepo,
  summarizeChecks,
  summarizePrNodes,
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
  test("returns a boolean without throwing", () => {
    expect(typeof isGhAvailable()).toBe("boolean");
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
