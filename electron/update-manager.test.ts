import { afterEach, describe, expect, test, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UpdateState } from "../contracts/updates.ts";
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
