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
    repository_url: "https://github.com/company/pipper",
    base_commit: "a".repeat(40),
    target_commit: "b".repeat(40),
    published_at: "2026-06-19T10:00:00.000Z",
    minimum_version: "0.1.0",
    validation_commands: ["bun run build"],
  },
  installation: {
    installed_version: "0.1.0",
    official_base_commit: "a".repeat(40),
    customized_head_commit: "c".repeat(40),
    last_healthy_at: "2026-06-19T09:00:00.000Z",
  },
  candidate_path: "/tmp/pipper/candidate",
  upstream_diff_path: "/tmp/pipper/updates/context/upstream.diff",
  customization_diff_path: "/tmp/pipper/updates/context/customization.diff",
  changed_files_path: "/tmp/pipper/updates/context/changed-files.json",
  upstream_changed_files: ["src/App.tsx"],
};

describe("update agent prompt", () => {
  test("contains pinned context and explicit write boundaries", async () => {
    const { buildUpdaterPrompt } = await import("./update-git.ts");
    const prompt = buildUpdaterPrompt(context);
    expect(prompt).toContain(context.candidate_path);
    expect(prompt).toContain(context.manifest.target_commit);
    expect(prompt).toContain(context.upstream_diff_path);
    expect(prompt).toContain("Do not modify files outside the candidate directory");
    expect(prompt).toContain("Do not commit or push");
  });
});
