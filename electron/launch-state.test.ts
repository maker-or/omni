import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  app: { getPath: () => process.env.PIPPER_LIBRARY_PATH ?? process.env.TMPDIR ?? "/tmp" },
}));

let root: string | null = null;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pipper-launch-state-"));
  process.env.PIPPER_LIBRARY_PATH = root;
});

afterEach(() => {
  delete process.env.PIPPER_LIBRARY_PATH;
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe("workspace selections in launch state", () => {
  test("selections persist per project and round-trip through disk", async () => {
    const { updateWorkspaceSelection, readWorkspaceSelections } = await import("./launch-state.ts");
    await updateWorkspaceSelection("project-1", "/worktrees/feature");
    await updateWorkspaceSelection("project-2", "/repo-b");
    expect(await readWorkspaceSelections()).toEqual({
      "project-1": "/worktrees/feature",
      "project-2": "/repo-b",
    });
  });

  test("a null selection clears the project's entry", async () => {
    const { updateWorkspaceSelection, readWorkspaceSelections } = await import("./launch-state.ts");
    await updateWorkspaceSelection("project-1", "/worktrees/feature");
    await updateWorkspaceSelection("project-1", null);
    expect(await readWorkspaceSelections()).toEqual({});
  });

  test("markLaunchComplete resets tab state but keeps workspace selections", async () => {
    const { updateWorkspaceSelection, markLaunchComplete, readLaunchState } =
      await import("./launch-state.ts");
    await updateWorkspaceSelection("project-1", "/worktrees/feature");
    await markLaunchComplete("project-1");
    const state = await readLaunchState();
    expect(state.openThreadIds).toEqual([]);
    expect(state.activeThreadId).toBeNull();
    expect(state.selectedWorktreePathByProject).toEqual({
      "project-1": "/worktrees/feature",
    });
  });

  test("concurrent selection updates for different projects both land", async () => {
    const { updateWorkspaceSelection, readWorkspaceSelections } = await import("./launch-state.ts");
    await Promise.all([
      updateWorkspaceSelection("project-1", "/a"),
      updateWorkspaceSelection("project-2", "/b"),
    ]);
    expect(await readWorkspaceSelections()).toEqual({ "project-1": "/a", "project-2": "/b" });
  });

  test("malformed selections on disk parse to an empty map", async () => {
    const { parseWorkspaceSelections } = await import("./launch-state.ts");
    expect(parseWorkspaceSelections(undefined)).toEqual({});
    expect(parseWorkspaceSelections(["/a"])).toEqual({});
    expect(parseWorkspaceSelections({ p1: 42, p2: "", p3: "/ok" })).toEqual({ p3: "/ok" });
  });
});
