import { describe, expect, mock, test } from "bun:test";
import { tmpdir } from "node:os";
import type { UpdateContext } from "../contracts/updates.ts";

mock.module("electron", () => ({ app: { getPath: () => tmpdir() } }));

const context: UpdateContext = {
  manifest: {
    schema_version: 1,
    version: "0.2.0",
    description: "Update",
    pr_url: "https://github.com/company/pipper/pull/1",
    files_changes: ["src/App.tsx"],
  },
  candidate_path: "/tmp/pipper/candidate",
  upstream_diff_path: "/tmp/pipper/updates/context/upstream.diff",
  changed_files_path: "/tmp/pipper/updates/context/changed-files.json",
  upstream_changed_files: ["src/App.tsx"],
};

describe("update agent prompt", () => {
  test("contains pinned context and explicit write boundaries", async () => {
    const { buildUpdaterPrompt } = await import("./update-git.ts");
    const prompt = buildUpdaterPrompt(context);
    expect(prompt).toContain(context.candidate_path);
    expect(prompt).toContain(context.upstream_diff_path);
    expect(prompt).toContain("Do not modify files outside the candidate directory");
    expect(prompt).toContain("Do not commit or push");
  });
});
