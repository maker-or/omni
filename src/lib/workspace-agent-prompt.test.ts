import { describe, expect, test } from "vitest";
import { buildCommitPrompt, buildPrCommentsPrompt } from "./workspace-agent-prompt";

describe("buildCommitPrompt", () => {
  test("commit-only names the branch, forbids hook bypass, and says not to push", () => {
    const prompt = buildCommitPrompt({ branch: "pipper/fix-login", push: false });
    expect(prompt).toContain("`pipper/fix-login`");
    expect(prompt).toContain("--no-verify");
    expect(prompt).toContain("Do not push");
    expect(prompt).not.toContain("push the branch");
  });

  test("commit-and-push adds the push step with upstream handling", () => {
    const prompt = buildCommitPrompt({ branch: null, push: true });
    expect(prompt).toContain("the current branch");
    expect(prompt).toContain("push the branch to origin, setting the upstream");
    expect(prompt).not.toContain("Do not push");
  });
});

describe("buildPrCommentsPrompt", () => {
  test("includes author, file:line for inline comments, and the body", () => {
    const prompt = buildPrCommentsPrompt({
      prNumber: 16,
      comments: [
        {
          id: "r1",
          author: "greptile-apps",
          avatarUrl: null,
          body: "Unused variable here.",
          url: null,
          createdAt: "",
          path: "electron/worktree-manager.ts",
          line: 735,
        },
        {
          id: "c1",
          author: "coderabbitai",
          avatarUrl: null,
          body: "Looks good overall.",
          url: null,
          createdAt: "",
          path: null,
          line: null,
        },
      ],
    });
    expect(prompt).toContain("Address these 2 comments from PR #16");
    expect(prompt).toContain("@greptile-apps on electron/worktree-manager.ts:735");
    expect(prompt).toContain("Unused variable here.");
    expect(prompt).toContain("@coderabbitai\nLooks good overall.");
    expect(prompt).toContain("Do not commit.");
  });
});
