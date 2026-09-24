import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  antigravityCacheRoot,
  antigravityRelease,
  ensureAntigravityInstalled,
  type AntigravityRelease,
} from "./antigravity-official.ts";
import { getAgentDescriptor, resolveAgentSpawn } from "./registry.ts";

const originalPlatform = process.platform;
let temporary: string | null = null;
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  Object.defineProperty(process, "platform", { value: originalPlatform });
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = null;
});

function zipAvailable(): boolean {
  try {
    execFileSync("zip", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Build a real zip fixture with the given entries, then return its bytes. */
function makeFixtureZip(directory: string, files: Record<string, string>): Buffer {
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(directory, name), content);
  }
  execFileSync("zip", ["-q", "fixture.zip", ...Object.keys(files)], { cwd: directory });
  return readFileSync(join(directory, "fixture.zip"));
}

function fixtureRelease(archive: Buffer): AntigravityRelease {
  return {
    archive: "https://dl.google.com/agy-extensions/releases/fixture.zip",
    sha256: createHash("sha256").update(archive).digest("hex"),
    executable: "agy_acp_server.exe",
    files: ["agy_acp_server.exe", "localharness_external.exe"],
    args: [],
  };
}

function stubArchiveFetch(archive: Buffer) {
  const fetch = vi.fn(async () => {
    const response = new Response(new Uint8Array(archive));
    Object.defineProperty(response, "url", {
      value: "https://dl.google.com/agy-extensions/releases/fixture.zip",
    });
    return response;
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

test.skipIf(!antigravityRelease())(
  "reuses a verified cached server without a download",
  async () => {
    const release = antigravityRelease()!;
    temporary = await mkdtemp(join(tmpdir(), "pipper-agy-acp-test-"));
    vi.stubEnv("PIPPER_ACP_AGENT_CACHE", temporary);
    const root = antigravityCacheRoot();
    await mkdir(root, { recursive: true });
    const sizes: Record<string, number> = {};
    for (const file of release.files) {
      await writeFile(join(root, file), "fixture");
      sizes[file] = (await stat(join(root, file))).size;
    }
    await writeFile(
      join(root, "install.json"),
      JSON.stringify({ version: "1.2.1", sha256: release.sha256, files: sizes }),
    );
    const fetch = vi.fn(() => Promise.reject(new Error("Unexpected download")));
    vi.stubGlobal("fetch", fetch);
    const executable = await ensureAntigravityInstalled();
    expect(executable).toBe(join(root, release.executable));
    expect(resolveAgentSpawn(getAgentDescriptor("antigravity-acp")!).command).toBe(executable);
    expect(fetch).not.toHaveBeenCalled();
  },
);

test.skipIf(!antigravityRelease())("repairs a cache whose executable was truncated", async () => {
  const release = antigravityRelease()!;
  temporary = await mkdtemp(join(tmpdir(), "pipper-agy-acp-test-"));
  vi.stubEnv("PIPPER_ACP_AGENT_CACHE", temporary);
  const root = antigravityCacheRoot();
  await mkdir(root, { recursive: true });
  const sizes: Record<string, number> = {};
  for (const file of release.files) {
    await writeFile(join(root, file), "fixture");
    sizes[file] = (await stat(join(root, file))).size;
  }
  await writeFile(
    join(root, "install.json"),
    JSON.stringify({ version: "1.2.1", sha256: release.sha256, files: sizes }),
  );
  // A present-but-damaged executable must not pass the cache check: the
  // truncated file fails the recorded size and triggers a reinstall.
  await writeFile(join(root, release.executable), "trunc");
  const fetch = vi.fn(() => Promise.reject(new Error("Unexpected download")));
  vi.stubGlobal("fetch", fetch);
  await expect(ensureAntigravityInstalled()).rejects.toThrow("Unexpected download");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.skipIf(!antigravityRelease())(
  "reclaims a stale installer lock instead of waiting it out",
  async () => {
    temporary = await mkdtemp(join(tmpdir(), "pipper-agy-acp-test-"));
    vi.stubEnv("PIPPER_ACP_AGENT_CACHE", temporary);
    const root = antigravityCacheRoot();
    await mkdir(join(root, ".."), { recursive: true });
    const lockPath = `${root}.lock`;
    await writeFile(lockPath, "dead-installer-nonce");
    const stale = new Date(Date.now() - 10 * 60_000);
    await utimes(lockPath, stale, stale);
    const fetch = vi.fn(() => Promise.reject(new Error("Unexpected download")));
    vi.stubGlobal("fetch", fetch);
    // Reaching the download proves the stale lock was reclaimed; otherwise the
    // installer would sit on its 6-minute wait.
    await expect(ensureAntigravityInstalled()).rejects.toThrow("Unexpected download");
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

test.skipIf(process.platform !== "darwin" || !zipAvailable())(
  "installs through the Windows tar layout",
  async () => {
    // Exercise the win32 branch (tar -tf / tar -xOf, no chmod) with macOS
    // bsdtar, which reads the same zip archive the Windows release ships.
    Object.defineProperty(process, "platform", { value: "win32" });
    temporary = await mkdtemp(join(tmpdir(), "pipper-agy-acp-test-"));
    vi.stubEnv("PIPPER_ACP_AGENT_CACHE", temporary);
    const fixtureDir = join(temporary, "fixture");
    await mkdir(fixtureDir, { recursive: true });
    const archive = makeFixtureZip(fixtureDir, {
      "agy_acp_server.exe": "server-binary",
      "localharness_external.exe": "harness-binary",
    });
    const release = fixtureRelease(archive);
    const fetch = stubArchiveFetch(archive);

    const executable = await ensureAntigravityInstalled({ release });
    const root = antigravityCacheRoot();
    expect(executable).toBe(join(root, "agy_acp_server.exe"));
    expect(await readFile(executable, "utf8")).toBe("server-binary");
    expect(await readFile(join(root, "localharness_external.exe"), "utf8")).toBe("harness-binary");
    // The promoted cache carries per-file sizes and is reused without a fetch.
    const marker = JSON.parse(await readFile(join(root, "install.json"), "utf8"));
    expect(marker.files["agy_acp_server.exe"]).toBe("server-binary".length);
    await expect(ensureAntigravityInstalled({ release })).resolves.toBe(executable);
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

test.skipIf(!antigravityRelease())("rejects an archive with the wrong checksum", async () => {
  temporary = await mkdtemp(join(tmpdir(), "pipper-agy-acp-test-"));
  vi.stubEnv("PIPPER_ACP_AGENT_CACHE", temporary);
  const fetch = vi.fn(async () => {
    const response = new Response("not the pinned archive");
    Object.defineProperty(response, "url", { value: antigravityRelease()!.archive });
    return response;
  });
  vi.stubGlobal("fetch", fetch);
  await expect(ensureAntigravityInstalled()).rejects.toThrow("checksum");
  expect(fetch).toHaveBeenCalledTimes(1);
});
