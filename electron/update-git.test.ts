import { describe, expect, test } from "bun:test";
import type { UpdatePromptContext } from "../contracts/updates.ts";

const context: UpdatePromptContext = {
  candidate_path: "/tmp/pipper/candidate",
  pr_url: "https://github.com/company/pipper/pull/1",
  pr_number: 1,
  git_ref: "refs/pipper-update/pr-1",
  files_changes: ["src/App.tsx"],
};

describe("update agent prompt", () => {
  test("uses git ref context instead of disk context files", async () => {
    const { buildUpdaterPrompt } = await import("./update-git.ts");
    const prompt = buildUpdaterPrompt(context);
    expect(prompt).toContain(context.candidate_path);
    expect(prompt).toContain(context.git_ref);
    expect(prompt).toContain("git show refs/pipper-update/pr-1:<path>");
    expect(prompt).toContain("Do not modify files outside the candidate directory");
    expect(prompt).toContain("Do not commit or push");
    expect(prompt).not.toContain("updates/context");
  });

  test("extracts PR number from configured repository URL", async () => {
    const { getUpdatePrNumber } = await import("./update-git.ts");
    expect(
      getUpdatePrNumber(
        {
          schema_version: 1,
          version: "0.2.0",
          description: "Update",
          pr_url: "https://github.com/company/pipper/pull/42",
          files_changes: ["src/App.tsx"],
        },
        "https://github.com/company/pipper.git",
      ),
    ).toBe(42);
  });
});
