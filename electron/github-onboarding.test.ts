import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Project } from "../contracts/projects.ts";
import { foreignGitEnv } from "./worktree-manager.ts";

const fixture = vi.hoisted(() => ({ home: "", projects: [] as Project[], gh: vi.fn() }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: () => fixture.home,
}));
vi.mock("./git-workspace.ts", () => ({ ghBinary: () => "test-gh" }));
vi.mock("./projects.ts", () => ({
  listProjects: () => fixture.projects,
  createProject: (input: Omit<Project, "id">) => {
    const project = { ...input, id: `project-${fixture.projects.length}` };
    fixture.projects.push(project);
    return project;
  },
}));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  const exec = Object.assign(vi.fn(actual.execFile), {
    [promisify.custom]: async (file: string, args: string[], options: object) =>
      file === "test-gh"
        ? { stdout: await fixture.gh(args, options), stderr: "" }
        : promisify(actual.execFile)(file, args, options),
  });
  return { ...actual, execFile: exec };
});

import {
  cloneGitHubRepository,
  getGitHubCliStatus,
  listGitHubRepositories,
} from "./github-onboarding.ts";

function initCheckout(path: string, fullName = "Team/App") {
  mkdirSync(path, { recursive: true });
  const env = foreignGitEnv();
  execFileSync("git", ["init", path], { stdio: "ignore", env });
  execFileSync(
    "git",
    ["-C", path, "remote", "add", "origin", `https://github.com/${fullName}.git`],
    { env },
  );
  writeFileSync(join(path, "README.md"), "local work");
}

beforeEach(() => {
  fixture.home = mkdtempSync(join(tmpdir(), "pipper-github-"));
  fixture.projects = [];
  fixture.gh.mockReset();
});
afterEach(() => rmSync(fixture.home, { recursive: true, force: true }));

describe("GitHub CLI readiness", () => {
  test("detects a fresh installation without waiting for an availability cache", async () => {
    fixture.gh.mockRejectedValueOnce(new Error("ENOENT"));
    expect((await getGitHubCliStatus()).state).toBe("missing");
    fixture.gh.mockImplementation(async (args) =>
      args[0] === "--version" ? "gh version" : "octocat",
    );
    expect(await getGitHubCliStatus()).toMatchObject({ state: "ready", username: "octocat" });
  });

  test("prompts login for missing credentials, but preserves network errors", async () => {
    fixture.gh
      .mockResolvedValueOnce("gh version")
      .mockRejectedValueOnce({ stderr: "run: gh auth login" });
    expect((await getGitHubCliStatus()).state).toBe("signed-out");
    fixture.gh
      .mockResolvedValueOnce("gh version")
      .mockRejectedValueOnce({ stderr: "connection refused" });
    await expect(getGitHubCliStatus()).rejects.toThrow("Check your connection");
  });

  test("lists private, collaborator and organization repositories with pagination", async () => {
    fixture.gh.mockResolvedValue(
      JSON.stringify(
        Array.from({ length: 50 }, (_, id) => ({
          id,
          full_name: `team/repo-${id}`,
          description: "A repository",
          private: true,
        })),
      ),
    );
    const result = await listGitHubRepositories(2);
    expect(result.hasMore).toBe(true);
    expect(result.repositories[0]).toEqual({
      id: 0,
      fullName: "team/repo-0",
      description: "A repository",
      isPrivate: true,
    });
    expect(fixture.gh.mock.calls[0][0][1]).toContain(
      "affiliation=owner,collaborator,organization_member",
    );
    expect(fixture.gh.mock.calls[0][0][1]).toContain("page=2");
    await expect(listGitHubRepositories(-1)).rejects.toThrow("Invalid repository page");
  });
});

describe("managed GitHub checkouts", () => {
  test("clones once, registers the final path, and preserves work on reopening", async () => {
    fixture.gh.mockImplementation(async (args) => {
      expect(args.slice(0, 3)).toEqual(["repo", "clone", "Team/App"]);
      initCheckout(args[3]);
      return "";
    });
    const first = cloneGitHubRepository("Team/App");
    const concurrent = cloneGitHubRepository("team/app");
    expect(first).toBe(concurrent);
    const project = await first;
    const expected = realpathSync(
      join(fixture.home, ".pipper", "repos", "github.com", "team", "app"),
    );
    expect(project.path).toBe(expected);
    expect(project.name).toBe("Team/App");
    writeFileSync(join(project.path, "uncommitted.txt"), "keep me");
    expect(await cloneGitHubRepository("team/app")).toEqual(project);
    expect(fixture.gh).toHaveBeenCalledOnce();
    expect(fixture.projects).toHaveLength(1);
    expect(existsSync(join(project.path, "uncommitted.txt"))).toBe(true);
    expect(readdirSync(join(expected, ".."))).toEqual(["app"]);
  });

  test("cleans a partial clone and allows a successful retry", async () => {
    fixture.gh.mockImplementationOnce(async (args) => {
      mkdirSync(args[3]);
      writeFileSync(join(args[3], "partial.txt"), "partial clone");
      throw new Error("network interruption");
    });
    await expect(cloneGitHubRepository("Team/App")).rejects.toThrow("Could not clone");
    const parent = join(fixture.home, ".pipper", "repos", "github.com", "team");
    expect(readdirSync(parent)).toEqual([]);
    expect(fixture.projects).toHaveLength(0);
    fixture.gh.mockImplementationOnce(async (args) => {
      initCheckout(args[3]);
      return "";
    });
    expect((await cloneGitHubRepository("Team/App")).name).toBe("Team/App");
  });

  test("refuses to reuse a checkout from a different origin without deleting it", async () => {
    const path = join(fixture.home, ".pipper", "repos", "github.com", "team", "app");
    initCheckout(path, "Other/Repo");
    await expect(cloneGitHubRepository("Team/App")).rejects.toThrow("does not match");
    expect(existsSync(join(path, "README.md"))).toBe(true);
    expect(fixture.gh).not.toHaveBeenCalled();
    expect(fixture.projects).toHaveLength(0);
  });

  test.each([
    "../../escape",
    "Team/..",
    "Team/.",
    "--help",
    "Team/App;echo",
    "Team/App/extra",
    "Team/App\n",
    "Team/App\\file",
  ])("rejects invalid repository input %s", (input) => {
    expect(() => cloneGitHubRepository(input)).toThrow("valid GitHub repository");
    expect(fixture.gh).not.toHaveBeenCalled();
    expect(readdirSync(fixture.home)).toEqual([]);
  });
});
