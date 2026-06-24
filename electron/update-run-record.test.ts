import { afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UpdateRunRecord } from "../contracts/updates.ts";

mock.module("electron", () => ({ app: { getPath: () => tmpdir() } }));

afterEach(() => {
  rmSync(join(tmpdir(), "pipper"), { recursive: true, force: true });
});

function record(runId: string): UpdateRunRecord {
  return {
    run_id: runId,
    started_at: "2026-06-24T00:00:00.000Z",
    installed_version_at_start: "0.1.0",
    target_version: "0.2.0",
    pr_url: "https://github.com/company/pipper/pull/1",
    pr_number: 1,
    git_ref: "refs/pipper-update/pr-1",
    files_changes: ["src/App.tsx"],
    active_head_at_start: "active",
    agent: { status: "pending" },
    promotion: { status: "pending" },
  };
}

describe("update run records", () => {
  test("writes, reads, and appends logs", async () => {
    const {
      appendUpdateRunLog,
      getRunLogPath,
      getRunRecordPath,
      readUpdateRunRecord,
      writeUpdateRunRecordAtomic,
    } = await import("./update-run-record.ts");
    writeUpdateRunRecordAtomic("run-1", record("run-1"));
    appendUpdateRunLog("run-1", "phase=preparing");
    expect(readUpdateRunRecord("run-1")?.target_version).toBe("0.2.0");
    expect(existsSync(getRunRecordPath("run-1"))).toBeTrue();
    expect(readFileSync(getRunLogPath("run-1"), "utf8")).toContain("phase=preparing");
  });
});
