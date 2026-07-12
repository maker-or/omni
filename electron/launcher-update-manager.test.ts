import { afterEach, describe, expect, test, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LauncherUpdateState } from "../contracts/launcher-updates.ts";
import { LauncherUpdateManager } from "./launcher-update-manager.ts";
import {
  createIdleLauncherUpdateState,
  writeLauncherUpdateStateAtomic,
} from "./launcher-update-state.ts";

vi.mock("electron", () => ({
  clipboard: { writeText: vi.fn() },
  shell: { showItemInFolder: vi.fn(), openExternal: vi.fn() },
}));

let root: string | null = null;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

const MANIFEST = {
  schema_version: 1 as const,
  version: "0.2.0",
  url: "https://releases.example.test/pipper-0.2.0-arm64.dmg",
  sha256: "a".repeat(64),
};

function createManager(rootPath: string) {
  return new LauncherUpdateManager({
    currentVersion: "0.1.0",
    manifestUrl: "https://releases.example.test/latest.json",
    rootPath,
    enabled: true,
    platform: "darwin",
    broadcastState: () => {},
    broadcastProgress: () => {},
  });
}

function writeState(rootPath: string, patch: Partial<LauncherUpdateState>): void {
  writeLauncherUpdateStateAtomic(join(rootPath, "state.json"), {
    ...createIdleLauncherUpdateState("0.1.0"),
    ...patch,
  });
}

describe("launcher update manager recovery", () => {
  test("recovery from a crashed download deletes the partial and clears its stale path", async () => {
    root = mkdtempSync(join(tmpdir(), "pipper-launcher-"));
    const downloads = join(root, "downloads");
    mkdirSync(downloads, { recursive: true });
    const partial = join(downloads, "pipper-0.2.0-arm64.dmg.partial");
    writeFileSync(partial, "half a dmg");
    writeState(root, {
      phase: "downloading",
      manifest: MANIFEST,
      downloaded_path: partial,
    });

    const state = await createManager(root).recover();

    expect(state.phase).toBe("available");
    expect(state.manifest?.version).toBe("0.2.0");
    // Neither the state nor the filesystem may keep pointing at the dead partial.
    expect(state.downloaded_path).toBeNull();
    expect(state.downloaded_sha256).toBeNull();
    expect(existsSync(partial)).toBe(false);
  });

  test("recovery preserves a verified downloaded installer that still exists", async () => {
    root = mkdtempSync(join(tmpdir(), "pipper-launcher-"));
    const downloads = join(root, "downloads");
    mkdirSync(downloads, { recursive: true });
    const dmg = join(downloads, "pipper-0.2.0-arm64.dmg");
    writeFileSync(dmg, "the dmg");
    writeState(root, {
      phase: "downloaded",
      manifest: MANIFEST,
      downloaded_path: dmg,
      downloaded_sha256: MANIFEST.sha256,
    });

    const state = await createManager(root).recover();

    expect(state.phase).toBe("downloaded");
    expect(state.downloaded_path).toBe(dmg);
    expect(existsSync(dmg)).toBe(true);
  });

  test("recovery downgrades downloaded state to available when the installer was removed", async () => {
    root = mkdtempSync(join(tmpdir(), "pipper-launcher-"));
    writeState(root, {
      phase: "downloaded",
      manifest: MANIFEST,
      downloaded_path: join(root, "downloads", "pipper-0.2.0-arm64.dmg"),
      downloaded_sha256: MANIFEST.sha256,
    });

    const state = await createManager(root).recover();

    expect(state.phase).toBe("available");
    expect(state.downloaded_path).toBeNull();
    expect(state.error).toContain("removed");
  });

  test("recovery quarantines corrupt state and starts idle without blocking startup", async () => {
    root = mkdtempSync(join(tmpdir(), "pipper-launcher-"));
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "state.json"), "{ not json");

    const state = await createManager(root).recover();

    expect(state.phase).toBe("idle");
    expect(state.error).toContain("Recovered unreadable launcher update state");
    expect(readdirSync(root).some((entry) => entry.startsWith("state.corrupt-"))).toBe(true);
  });

  test("recovery clears pending state after the newer launcher version is running", async () => {
    root = mkdtempSync(join(tmpdir(), "pipper-launcher-"));
    const downloads = join(root, "downloads");
    mkdirSync(downloads, { recursive: true });
    const dmg = join(downloads, "pipper-0.2.0-arm64.dmg");
    writeFileSync(dmg, "the dmg");
    writeState(root, {
      phase: "downloaded",
      manifest: MANIFEST,
      downloaded_path: dmg,
      downloaded_sha256: MANIFEST.sha256,
    });

    const manager = new LauncherUpdateManager({
      currentVersion: "0.2.0",
      manifestUrl: "https://releases.example.test/latest.json",
      rootPath: root,
      enabled: true,
      platform: "darwin",
      broadcastState: () => {},
      broadcastProgress: () => {},
    });
    const state = await manager.recover();

    expect(state.phase).toBe("idle");
    expect(state.manifest).toBeNull();
    expect(existsSync(dmg)).toBe(false);
  });
});
