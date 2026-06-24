import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UpdateState } from "../contracts/updates.ts";
import { createIdleUpdateState, writeUpdateStateAtomic } from "./update-state.ts";

mock.module("electron", () => ({ app: { getPath: () => tmpdir() } }));

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

describe("update manager", () => {
  test("check preserves failed state and error while refreshing manifest", async () => {
    root = mkdtempSync(join(tmpdir(), "pipper-manager-"));
    process.env.PIPPER_LIBRARY_PATH = root;
    mkdirSync(join(root, "updates"), { recursive: true });
    writeFileSync(
      join(root, "installation.json"),
      `${JSON.stringify({
        installed_version: "0.1.0",
        customized_head_commit: "head",
        last_healthy_at: "2026-06-23T00:00:00.000Z",
      })}\n`,
    );
    const failed: UpdateState = {
      ...createIdleUpdateState(),
      phase: "failed",
      error: "previous failure",
      run_id: "run-1",
    };
    writeUpdateStateAtomic(join(root, "updates", "state.json"), failed);
    globalThis.fetch = mock(async () => ({
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

    const { UpdateManager } = await import("./update-manager.ts");
    const manager = new UpdateManager({
      manifestUrl: "https://updates.example.test/manifest.json",
      repositoryUrl: "https://github.com/company/pipper",
      agent: fakeAgent(),
      broadcastState: () => {},
      broadcastProgress: () => {},
      broadcastUpdaterEvent: () => {},
      prepareForUpdate: async () => {},
      restartPromotedApp: async () => {},
    });

    const state = await manager.check();
    expect(state.phase).toBe("failed");
    expect(state.error).toBe("previous failure");
    expect(manager.getManifest()?.version).toBe("0.2.0");
  });
});
