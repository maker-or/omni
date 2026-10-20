import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  app: {
    getPath: () => process.env.PIPPER_LIBRARY_PATH ?? process.env.TMPDIR ?? "/tmp",
    connect: vi.fn(),
  },
}));
vi.mock("./agent-instances.ts", () => ({
  listAgentInstanceDescriptors: () => [{ id: "pipper-mock" }],
}));

import type { WorktreeSetupProgress } from "../contracts/worktrees.ts";
import type { AgentManager } from "./agent-connection-manager.ts";
import { prepareIsolatedAgentTask } from "./isolated-agent-task.ts";
import { createProject } from "./projects.ts";
import { createThread } from "./threads.ts";
import {
  createWorkspace,
  setWorkspaceInstallRunnerForTests,
  setWorkspaceSetupProgressSink,
  type WorkspaceSetupJob,
} from "./workspace-lifecycle.ts";
import { setWorktreeAutoInstall } from "./worktree-preferences.ts";

// One library root for the file: db.ts caches its handle on first use.
const root = mkdtempSync(join(tmpdir(), "pipper-workspace-lifecycle-"));
process.env.PIPPER_LIBRARY_PATH = root;
process.env.PIPPER_WORKTREES_PATH = join(root, "worktrees");

afterAll(async () => {
  const { closeDb } = await import("./db.ts");
  closeDb();
  delete process.env.PIPPER_LIBRARY_PATH;
  delete process.env.PIPPER_WORKTREES_PATH;
  rmSync(root, { recursive: true, force: true });
});

const GIT_ENV: NodeJS.ProcessEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

let repoCount = 0;
function nodeProject() {
  const path = join(root, `repo-${++repoCount}`);
  mkdirSync(path, { recursive: true });
  const git = (args: string[]) => execFileSync("git", args, { cwd: path, env: GIT_ENV });
  git(["init", "-q", "-b", "main"]);
  writeFileSync(join(path, "package.json"), "{}\n");
  writeFileSync(join(path, "bun.lock"), "{}\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  return createProject({ name: `repo-${repoCount}`, path, icon: "folder" });
}

function fakeAgentManager(options: { fail?: boolean } = {}): AgentManager {
  return {
    createThread: async (
      projectId: string,
      title: string | null,
      _after: string | null,
      agentId: string,
      worktreePath: string,
    ) => {
      if (options.fail) throw new Error("agent unavailable");
      return createThread(
        projectId,
        title,
        agentId,
        `session-${Date.now()}`,
        undefined,
        worktreePath,
      );
    },
    sendPrompt: async () => {},
  } as unknown as AgentManager;
}

let progress: WorktreeSetupProgress[];
let installs: WorkspaceSetupJob[];

beforeEach(() => {
  progress = [];
  installs = [];
  setWorkspaceSetupProgressSink((event) => progress.push(event));
  setWorkspaceInstallRunnerForTests(async (job) => {
    installs.push(job);
    return { status: "installed", manager: "bun" };
  });
});

afterEach(() => {
  setWorkspaceSetupProgressSink(null);
  setWorkspaceInstallRunnerForTests(null);
  setWorktreeAutoInstall(true);
});

function setupSummary(worktreePath: string) {
  return progress
    .filter((event) => event.worktreePath === worktreePath)
    .map(({ status, policy, manager }) => ({ status, policy, manager }));
}

async function createBoth() {
  const project = nodeProject();
  const desktop = await createWorkspace({
    projectId: project.id,
    name: "desktop-feature",
    activation: "foreground",
  });
  await desktop.setup;
  const agentId = "pipper-mock";
  const remote = await prepareIsolatedAgentTask(fakeAgentManager(), project.id, agentId, "hi");
  const remotePath = remote.result.thread.worktreePath!;
  // The remote setup runs in the background behind the create call.
  await vi.waitFor(() => expect(setupSummary(remotePath).at(-1)?.status).not.toBe("installing"));
  return { desktopPath: desktop.worktree.path, remotePath, desktopPolicy: desktop.policy };
}

describe("shared workspace lifecycle", () => {
  test("desktop and remote creation apply the same prepared setup", async () => {
    const { desktopPath, remotePath, desktopPolicy } = await createBoth();
    expect(desktopPolicy).toBe("prepared");
    expect(setupSummary(remotePath)).toEqual(setupSummary(desktopPath));
    expect(setupSummary(desktopPath)).toEqual([
      { status: "installing", policy: "prepared", manager: "bun" },
      { status: "installed", policy: "prepared", manager: "bun" },
    ]);
    expect(installs.map((job) => job.worktreePath)).toEqual([desktopPath, remotePath]);
    // Only the activation differs, so remote progress stays out of the way.
    expect(progress.find((event) => event.worktreePath === remotePath)?.activation).toBe(
      "background",
    );
    expect(progress.find((event) => event.worktreePath === desktopPath)?.activation).toBe(
      "foreground",
    );
  });

  test("with automatic install off both entry points stay source-only", async () => {
    setWorktreeAutoInstall(false);
    const { desktopPath, remotePath, desktopPolicy } = await createBoth();
    expect(desktopPolicy).toBe("source-only");
    expect(setupSummary(remotePath)).toEqual(setupSummary(desktopPath));
    expect(setupSummary(desktopPath)).toEqual([
      { status: "skipped", policy: "source-only", manager: "bun" },
    ]);
    expect(installs).toEqual([]);
  });

  test("a remote task that cannot bind a thread removes only its own workspace", async () => {
    const project = nodeProject();
    const kept = await createWorkspace({
      projectId: project.id,
      name: "kept",
      activation: "foreground",
    });
    const agentId = "pipper-mock";
    await expect(
      prepareIsolatedAgentTask(fakeAgentManager({ fail: true }), project.id, agentId, "hi"),
    ).rejects.toThrow("agent unavailable");
    const remoteJob = progress.find(
      (event) => event.activation === "background" && event.projectId === project.id,
    );
    expect(remoteJob).toBeDefined();
    expect(existsSync(remoteJob!.worktreePath)).toBe(false);
    expect(existsSync(kept.worktree.path)).toBe(true);
  });
});
