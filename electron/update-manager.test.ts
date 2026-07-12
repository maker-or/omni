import { afterEach, describe, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UpdateRunRecord, UpdateState } from "../contracts/updates.ts";
import { createIdleUpdateState, writeUpdateStateAtomic } from "./update-state.ts";

vi.mock("electron", () => ({
  app: { getPath: () => process.env.PIPPER_LIBRARY_PATH ?? process.env.TMPDIR ?? "/tmp" },
}));

let root: string | null = null;
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.PIPPER_LIBRARY_PATH;
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

function fakeAgent() {
  return {
    activateUpdater: async () => {},
    sendUpdaterPrompt: async () => "done",
    abortUpdater: async () => {},
    disposeUpdater: async () => {},
    getUpdaterState: () => ({}) as any,
    setUpdaterEventHandler: () => {},
    isEditorActive: () => false,
    isEditorBusy: () => false,
  };
}

function writeInstallation(rootPath: string): void {
  writeFileSync(
    join(rootPath, "installation.json"),
    `${JSON.stringify({
      installed_version: "0.1.0",
      customized_head_commit: "head",
      last_healthy_at: "2026-06-23T00:00:00.000Z",
    })}\n`,
  );
}

function writeFailedState(rootPath: string): void {
  const failed: UpdateState = {
    ...createIdleUpdateState(),
    phase: "failed",
    error: "previous failure",
    run_id: "run-1",
  };
  writeUpdateStateAtomic(join(rootPath, "updates", "state.json"), failed);
}

function writeManifest(rootPath: string): void {
  writeFileSync(
    join(rootPath, "updates", "manifest.json"),
    `${JSON.stringify({
      schema_version: 1,
      version: "0.2.0",
      description: "Update",
      pr_url: "https://github.com/company/pipper/pull/1",
      files_changes: ["src/App.tsx"],
    })}\n`,
  );
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Pipper",
  GIT_AUTHOR_EMAIL: "pipper@internal",
  GIT_COMMITTER_NAME: "Pipper",
  GIT_COMMITTER_EMAIL: "pipper@internal",
};

// Simulates a crash after the promoted app reported healthy: state.json is
// frozen at awaiting-health-check and the run record already says health_ok.
// Returns the active workspace HEAD used as the candidate commit.
function setupHealthOkCrashScenario(
  rootPath: string,
  options: { previousExists: boolean; candidateCommit?: string },
): string {
  const active = join(rootPath, "active");
  mkdirSync(active, { recursive: true });
  execFileSync("git", ["init"], { cwd: active });
  writeFileSync(join(active, "package.json"), '{"version":"0.2.0"}\n');
  execFileSync("git", ["add", "."], { cwd: active });
  execFileSync("git", ["commit", "-m", "candidate"], { cwd: active, env: GIT_ENV });
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: active,
    encoding: "utf8",
  }).trim();
  const candidateCommit = options.candidateCommit ?? head;

  if (options.previousExists) {
    const previous = join(rootPath, "previous");
    mkdirSync(previous, { recursive: true });
    writeFileSync(join(previous, "package.json"), '{"version":"0.1.0"}\n');
  }

  writeUpdateStateAtomic(join(rootPath, "updates", "state.json"), {
    ...createIdleUpdateState(),
    phase: "awaiting-health-check",
    run_id: "run-h",
  });
  const record: UpdateRunRecord = {
    run_id: "run-h",
    started_at: "2026-07-01T00:00:00.000Z",
    installed_version_at_start: "0.1.0",
    target_version: "0.2.0",
    pr_url: "https://github.com/company/pipper/pull/1",
    pr_number: 1,
    git_ref: "refs/pipper-update/pr-1",
    files_changes: ["src/App.tsx"],
    active_head_at_start: "before-head",
    candidate_commit: candidateCommit,
    agent: { status: "completed" },
    promotion: { status: "health_ok", candidate_commit: candidateCommit },
  };
  mkdirSync(join(rootPath, "updates", "runs"), { recursive: true });
  writeFileSync(
    join(rootPath, "updates", "runs", "run-h.json"),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return head;
}

async function createManager(rootPath: string) {
  process.env.PIPPER_LIBRARY_PATH = rootPath;
  mkdirSync(join(rootPath, "updates"), { recursive: true });
  writeInstallation(rootPath);
  const { UpdateManager } = await import("./update-manager.ts");
  return new UpdateManager({
    manifestUrl: "https://updates.example.test/manifest.json",
    repositoryUrl: "https://github.com/company/pipper",
    agent: fakeAgent(),
    broadcastState: () => {},
    broadcastProgress: () => {},
    broadcastUpdaterEvent: () => {},
    prepareForUpdate: async () => {},
    restartPromotedApp: async () => {},
  });
}

describe("update manager", () => {
  test("check preserves failed state and error while refreshing manifest", async () => {
    root = mkdtempSync(join(tmpdir(), "pipper-manager-"));
    mkdirSync(join(root, "updates"), { recursive: true });
    writeFailedState(root);
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        schema_version: 1,
        version: "0.2.0",
        description: "Update",
        pr_url: "https://github.com/company/pipper/pull/1",
        files_changes: ["src/App.tsx"],
      }),
    })) as any;

    const manager = await createManager(root);

    const state = await manager.check();
    expect(state.phase).toBe("failed");
    expect(state.error).toBe("previous failure");
    expect(manager.getManifest()?.version).toBe("0.2.0");
  });

  test("dismiss does not clear failed workspace update state", async () => {
    root = mkdtempSync(join(tmpdir(), "pipper-manager-"));
    mkdirSync(join(root, "updates"), { recursive: true });
    writeFailedState(root);
    const manager = await createManager(root);

    const state = manager.dismiss();
    expect(state.phase).toBe("failed");
    expect(state.error).toBe("previous failure");
  });

  test("startNow refuses retry while failed state is unresolved", async () => {
    root = mkdtempSync(join(tmpdir(), "pipper-manager-"));
    mkdirSync(join(root, "updates"), { recursive: true });
    writeFailedState(root);
    const manager = await createManager(root);

    const result = await manager.startNow();
    expect(result.success).toBe(false);
    expect(manager.getState().phase).toBe("failed");
    expect(result.error).toContain("failed");
  });

  test("retryFailedUpdate moves failed state back to available when manifest exists", async () => {
    root = mkdtempSync(join(tmpdir(), "pipper-manager-"));
    mkdirSync(join(root, "updates"), { recursive: true });
    writeFailedState(root);
    writeManifest(root);
    const manager = await createManager(root);

    const state = await manager.retryFailedUpdate();
    expect(state.phase).toBe("available");
    expect(state.error).toBeNull();
    expect(state.run_id).toBe("run-1");
  });

  test("retryFailedUpdate clears failed state to idle when no update remains", async () => {
    root = mkdtempSync(join(tmpdir(), "pipper-manager-"));
    mkdirSync(join(root, "updates"), { recursive: true });
    writeFailedState(root);
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 204 })) as any;
    const manager = await createManager(root);

    const state = await manager.retryFailedUpdate();
    expect(state.phase).toBe("idle");
    expect(state.error).toBeNull();
    expect(state.run_id).toBeNull();
  });

  test("retryFailedUpdate preserves failed state when manifest refresh fails", async () => {
    root = mkdtempSync(join(tmpdir(), "pipper-manager-"));
    mkdirSync(join(root, "updates"), { recursive: true });
    writeFailedState(root);
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as any;
    const manager = await createManager(root);

    const state = await manager.retryFailedUpdate();
    expect(state.phase).toBe("failed");
    expect(state.error).toBe("previous failure");
    expect(state.run_id).toBe("run-1");
  });

  test("startNow resolves with a failure instead of rejecting when the cached manifest is corrupt", async () => {
    root = mkdtempSync(join(tmpdir(), "pipper-manager-"));
    mkdirSync(join(root, "updates"), { recursive: true });
    writeFileSync(join(root, "updates", "manifest.json"), "{ truncated");
    const manager = await createManager(root);

    await expect(manager.startNow()).resolves.toMatchObject({ success: false });
    expect(manager.getState().phase).toBe("failed");
    // The corrupt manifest is quarantined so the next check() can re-fetch it.
    expect(existsSync(join(root, "updates", "manifest.json"))).toBe(false);
    expect(
      readdirSync(join(root, "updates")).some((entry) => entry.startsWith("manifest.corrupt-")),
    ).toBe(true);
    expect(manager.getManifest()).toBeNull();
  });

  test("recover finalizes a health-confirmed update interrupted before finalization", async () => {
    root = mkdtempSync(join(tmpdir(), "pipper-manager-"));
    const head = setupHealthOkCrashScenario(root, { previousExists: true });
    const manager = await createManager(root);

    await expect(manager.recover()).resolves.toBeUndefined();

    expect(manager.getState().phase).toBe("completed");
    expect(existsSync(join(root, "previous"))).toBe(false);
    expect(existsSync(join(root, "backup"))).toBe(true);
    const installation = JSON.parse(readFileSync(join(root, "installation.json"), "utf8"));
    expect(installation.installed_version).toBe("0.2.0");
    expect(installation.customized_head_commit).toBe(head);
  });

  test("recover completes without re-finalizing after a crash between finalization and state persist", async () => {
    root = mkdtempSync(join(tmpdir(), "pipper-manager-"));
    setupHealthOkCrashScenario(root, { previousExists: false });
    const manager = await createManager(root);

    // `previous` is already gone (finalizePromotion ran before the crash);
    // recover must treat finalization as done rather than calling the
    // non-idempotent finalizePromotion again, which would throw and block startup.
    await expect(manager.recover()).resolves.toBeUndefined();
    expect(manager.getState().phase).toBe("completed");
  });

  test("recover fails safely when the finalized workspace does not match the recovered candidate", async () => {
    root = mkdtempSync(join(tmpdir(), "pipper-manager-"));
    setupHealthOkCrashScenario(root, {
      previousExists: false,
      candidateCommit: "0000000000000000000000000000000000000000",
    });
    const manager = await createManager(root);

    await expect(manager.recover()).resolves.toBeUndefined();
    const state = manager.getState();
    expect(state.phase).toBe("failed");
    expect(state.error).toContain("could not confirm");
  });

  test("recovers corrupt persisted update state without crashing", async () => {
    root = mkdtempSync(join(tmpdir(), "pipper-manager-"));
    mkdirSync(join(root, "updates"), { recursive: true });
    writeFileSync(
      join(root, "updates", "state.json"),
      JSON.stringify({ phase: "installing", scheduled_for_quit: "yes" }),
    );

    const manager = await createManager(root);
    const state = manager.getState();
    expect(state.phase).toBe("idle");
    expect(state.error).toContain("Recovered unreadable workspace update state");
    expect(existsSync(join(root, "updates", "state.json"))).toBe(true);
    expect(
      readdirSync(join(root, "updates")).some((entry) => entry.startsWith("state.corrupt-")),
    ).toBe(true);
  });
});
