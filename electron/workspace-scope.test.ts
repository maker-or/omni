import { describe, expect, test } from "vitest";
import {
  isThreadInWorkspace,
  normalizeWorkspacePath,
  pickWorkspaceThread,
} from "../contracts/workspace-scope.ts";
import type { Thread } from "../contracts/threads.ts";

function thread(id: string, worktreePath: string | null, projectId = "project-1"): Thread {
  return {
    id,
    project_id: projectId,
    agent_id: "agent",
    agent_session_id: `session-${id}`,
    title: id,
    worktree_path: worktreePath,
    created_at: 1,
    last_used_at: 1,
  };
}

describe("normalizeWorkspacePath", () => {
  test("missing selection means the project root", () => {
    expect(normalizeWorkspacePath(undefined, "/repo")).toBeNull();
    expect(normalizeWorkspacePath(null, "/repo")).toBeNull();
    expect(normalizeWorkspacePath("", "/repo")).toBeNull();
  });

  test("the project root path normalizes to null", () => {
    expect(normalizeWorkspacePath("/repo", "/repo")).toBeNull();
  });

  test("a worktree path stays itself", () => {
    expect(normalizeWorkspacePath("/worktrees/feature", "/repo")).toBe("/worktrees/feature");
  });
});

describe("isThreadInWorkspace", () => {
  test("root threads match the root workspace only", () => {
    expect(isThreadInWorkspace(thread("t", null), null)).toBe(true);
    expect(isThreadInWorkspace(thread("t", null), "/worktrees/feature")).toBe(false);
  });

  test("worktree threads match their own workspace only", () => {
    expect(isThreadInWorkspace(thread("t", "/worktrees/feature"), "/worktrees/feature")).toBe(true);
    expect(isThreadInWorkspace(thread("t", "/worktrees/feature"), null)).toBe(false);
    expect(isThreadInWorkspace(thread("t", "/worktrees/feature"), "/worktrees/other")).toBe(false);
  });

  test("an undefined worktree_path behaves like the root", () => {
    const legacy = thread("t", null);
    delete (legacy as { worktree_path?: string | null }).worktree_path;
    expect(isThreadInWorkspace(legacy, null)).toBe(true);
  });
});

describe("pickWorkspaceThread", () => {
  const feature = "/worktrees/feature";

  test("prefers the most-recently-switched open tab in the workspace", () => {
    const threads = [
      thread("open-old", feature),
      thread("open-mru", feature),
      thread("root", null),
    ];
    const picked = pickWorkspaceThread({
      projectId: "project-1",
      workspacePath: feature,
      openThreadIds: ["open-old", "open-mru", "root"],
      threadSwitchHistory: ["root", "open-mru", "open-old"],
      threads,
    });
    expect(picked?.id).toBe("open-mru");
  });

  test("falls back to open-tab order when no history entry matches", () => {
    const threads = [thread("a", feature), thread("b", feature)];
    const picked = pickWorkspaceThread({
      projectId: "project-1",
      workspacePath: feature,
      openThreadIds: ["b", "a"],
      threadSwitchHistory: [],
      threads,
    });
    expect(picked?.id).toBe("b");
  });

  test("falls back to the workspace's most recent thread when none are open", () => {
    const threads = [thread("root", null), thread("closed", feature)];
    const picked = pickWorkspaceThread({
      projectId: "project-1",
      workspacePath: feature,
      openThreadIds: ["root"],
      threadSwitchHistory: ["root"],
      threads,
    });
    expect(picked?.id).toBe("closed");
  });

  test("never picks a thread from another workspace or another project", () => {
    const threads = [
      thread("root", null),
      thread("other-workspace", "/worktrees/other"),
      thread("other-project", feature, "project-2"),
    ];
    const picked = pickWorkspaceThread({
      projectId: "project-1",
      workspacePath: feature,
      openThreadIds: ["root", "other-workspace", "other-project"],
      threadSwitchHistory: ["other-project", "other-workspace", "root"],
      threads,
    });
    expect(picked).toBeNull();
  });

  test("the root workspace picks root-bound threads", () => {
    const threads = [thread("feature", feature), thread("root", null)];
    const picked = pickWorkspaceThread({
      projectId: "project-1",
      workspacePath: null,
      openThreadIds: [],
      threadSwitchHistory: [],
      threads,
    });
    expect(picked?.id).toBe("root");
  });
});
