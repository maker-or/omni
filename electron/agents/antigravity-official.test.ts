import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  antigravityCacheRoot,
  antigravityRelease,
  ensureAntigravityInstalled,
} from "./antigravity-official.ts";
import { getAgentDescriptor, resolveAgentSpawn } from "./registry.ts";

let temporary: string | null = null;
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = null;
});

test.skipIf(!antigravityRelease())(
  "reuses a verified cached server without a download",
  async () => {
    const release = antigravityRelease()!;
    temporary = await mkdtemp(join(tmpdir(), "pipper-agy-acp-test-"));
    vi.stubEnv("PIPPER_ACP_AGENT_CACHE", temporary);
    const root = antigravityCacheRoot();
    await mkdir(root, { recursive: true });
    await Promise.all(release.files.map((file) => writeFile(join(root, file), "fixture")));
    await writeFile(
      join(root, "install.json"),
      JSON.stringify({ version: "1.2.1", sha256: release.sha256 }),
    );
    const fetch = vi.fn(() => Promise.reject(new Error("Unexpected download")));
    vi.stubGlobal("fetch", fetch);
    const executable = await ensureAntigravityInstalled();
    expect(executable).toBe(join(root, release.executable));
    expect(resolveAgentSpawn(getAgentDescriptor("antigravity-acp")!).command).toBe(executable);
    expect(fetch).not.toHaveBeenCalled();
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
