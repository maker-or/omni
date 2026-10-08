import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CloudflaredBinary, type CloudflaredAsset } from "./cloudflared-binary.ts";
import { writeFakeCloudflared } from "./cloudflared-test-fixtures.ts";

const VERSION = "2026.9.3";

describe.skipIf(process.platform === "win32")("cloudflared binary", () => {
  let dir: string;
  let server: http.Server;
  let base: string;
  let hits: number;
  let tgz: Buffer;
  let raw: Buffer;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cf-binary-"));
    const src = join(dir, "src");
    mkdirSync(src);
    writeFakeCloudflared(src, VERSION);
    execFileSync("tar", ["-czf", join(dir, "fixture.tgz"), "-C", src, "cloudflared"]);
    tgz = readFileSync(join(dir, "fixture.tgz"));
    raw = readFileSync(join(src, "cloudflared"));
    hits = 0;
    server = http.createServer((req, res) => {
      hits++;
      const body = req.url?.endsWith(".tgz") ? tgz : raw;
      res.writeHead(200, { "Content-Length": String(body.length) });
      res.end(body);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });

  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const make = (asset: Partial<CloudflaredAsset> & { archive: "tgz" | "raw" }) =>
    new CloudflaredBinary({
      installRoot: join(dir, "tools"),
      platform: "darwin",
      arch: "arm64",
      version: VERSION,
      downloadBaseUrl: base,
      assets: {
        "darwin-arm64": {
          file: asset.archive === "tgz" ? "cf.tgz" : "cf",
          sha256: asset.sha256 ?? sha(asset.archive === "tgz" ? tgz : raw),
          archive: asset.archive,
        },
      },
    });

  it("downloads, verifies, and installs the pinned build once", async () => {
    const binary = make({ archive: "tgz" });
    const [first, second] = await Promise.all([binary.resolve(), binary.resolve()]);
    expect(first).toBe(second);
    expect(first).toBe(join(dir, "tools", VERSION, "darwin-arm64", "cloudflared"));
    expect(execFileSync(first, ["--version"]).toString()).toContain(VERSION);
    expect(hits).toBe(1);
    // A later launch reuses the install without downloading again.
    expect(await make({ archive: "tgz" }).resolve()).toBe(first);
    expect(hits).toBe(1);
  });

  it("installs raw (non-archive) builds", async () => {
    const path = await make({ archive: "raw" }).resolve();
    expect(execFileSync(path, ["--version"]).toString()).toContain("cloudflared version");
  });

  it("rejects a download whose checksum does not match and leaves nothing behind", async () => {
    const binary = make({ archive: "tgz", sha256: "0".repeat(64) });
    await expect(binary.resolve()).rejects.toThrow(/checksum mismatch/);
    expect(existsSync(binary.managedPath())).toBe(false);
    const versionDir = join(dir, "tools", VERSION);
    expect(existsSync(versionDir) ? readdirSync(versionDir) : []).toEqual([]);
  });

  it("uses an explicit override without downloading", async () => {
    const override = writeFakeCloudflared(mkdtempSync(join(dir, "override-")), "1.0.0");
    const binary = new CloudflaredBinary({
      installRoot: join(dir, "tools"),
      overridePath: override,
      downloadBaseUrl: base,
    });
    expect(await binary.resolve()).toBe(override);
    expect(hits).toBe(0);
  });

  it("refuses an override that is not cloudflared", async () => {
    const binary = new CloudflaredBinary({
      installRoot: join(dir, "tools"),
      overridePath: "/bin/echo",
    });
    await expect(binary.resolve()).rejects.toThrow(/not a cloudflared binary/);
  });
});
