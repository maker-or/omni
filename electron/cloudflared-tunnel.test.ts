import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteTunnelStatus } from "../contracts/remote.ts";
import { CloudflaredTunnel, type TunnelMode } from "./cloudflared-tunnel.ts";
import { writeFakeCloudflared } from "./cloudflared-test-fixtures.ts";

describe.skipIf(process.platform === "win32")("cloudflared tunnel supervisor", () => {
  let dir: string;
  let fake: string;
  let argsFile: string;
  let tunnel: CloudflaredTunnel | null;
  let statuses: RemoteTunnelStatus[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cf-tunnel-"));
    fake = writeFakeCloudflared(dir);
    argsFile = join(dir, "args.txt");
    writeFileSync(join(dir, "config.yml"), "");
    vi.stubEnv("FAKE_CF_ARGS", argsFile);
    statuses = [];
    tunnel = null;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await tunnel?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const make = (mode: TunnelMode, binary: () => Promise<string> = async () => fake) =>
    new CloudflaredTunnel({
      binary,
      mode,
      configPath: join(dir, "config.yml"),
      onStatus: (s) => statuses.push(s),
      initialBackoffMs: 20,
      maxBackoffMs: 80,
    });

  it("reports the quick tunnel URL once the connection registers", async () => {
    tunnel = make({ kind: "quick", originUrl: "http://127.0.0.1:4173" });
    tunnel.start();
    await vi.waitFor(() => expect(tunnel!.url).toBe("https://quiet-fox-1234.trycloudflare.com"));
    const args = readFileSync(argsFile, "utf8");
    expect(args).toContain("--url http://127.0.0.1:4173");
    expect(args).toContain(`--config ${join(dir, "config.yml")}`);
    expect(args).toContain("--no-autoupdate");
    expect(statuses.map((s) => s.state)).toEqual(["installing", "starting", "connected"]);
  });

  it("passes a named tunnel's token through the environment, never argv", async () => {
    tunnel = make({ kind: "token", token: "secret-connector-token", hostname: "abc.example.com" });
    tunnel.start();
    await vi.waitFor(() => expect(tunnel!.url).toBe("https://abc.example.com"));
    const args = readFileSync(argsFile, "utf8");
    expect(args.split("\n")[0]).not.toContain("secret-connector-token");
    expect(args).toContain("token=secret-connector-token");
  });

  it("restarts a crashing connector with growing backoff and surfaces the error", async () => {
    vi.stubEnv("FAKE_CF_MODE", "crash");
    tunnel = make({ kind: "quick", originUrl: "http://127.0.0.1:4173" });
    tunnel.start();
    await vi.waitFor(() => {
      const retries = statuses.filter((s) => s.state === "reconnecting");
      expect(retries.length).toBeGreaterThanOrEqual(3);
    });
    const retries = statuses.filter(
      (s): s is Extract<RemoteTunnelStatus, { state: "reconnecting" }> =>
        s.state === "reconnecting",
    );
    expect(retries.map((r) => r.attempt).slice(0, 3)).toEqual([1, 2, 3]);
    expect(retries[0]!.lastError).toBe("failed to dial edge");
    expect(tunnel.url).toBeNull();
  });

  it("retries when cloudflared cannot be installed", async () => {
    tunnel = make({ kind: "quick", originUrl: "http://127.0.0.1:4173" }, async () => {
      throw new Error("offline");
    });
    tunnel.start();
    await vi.waitFor(() =>
      expect(statuses.find((s) => s.state === "reconnecting")).toMatchObject({
        lastError: "offline",
      }),
    );
  });

  it("resolves the tunnel on launch, and stops retrying on a fatal setup error", async () => {
    let calls = 0;
    tunnel = new CloudflaredTunnel({
      binary: async () => fake,
      mode: async () => {
        calls++;
        throw Object.assign(new Error("Sign in to Pipper to use the Cloudflare tunnel."), {
          fatal: true,
        });
      },
      configPath: join(dir, "config.yml"),
      onStatus: (s) => statuses.push(s),
      initialBackoffMs: 10,
    });
    tunnel.start();
    await vi.waitFor(() => expect(tunnel!.status.state).toBe("error"));
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toBe(1);
    expect(tunnel.status).toEqual({
      state: "error",
      message: "Sign in to Pipper to use the Cloudflare tunnel.",
    });
  });

  it("stops the connector and does not restart it", async () => {
    tunnel = make({ kind: "quick", originUrl: "http://127.0.0.1:4173" });
    tunnel.start();
    await vi.waitFor(() => expect(tunnel!.url).not.toBeNull());
    await tunnel.stop();
    expect(tunnel.status).toEqual({ state: "stopped" });
    await new Promise((r) => setTimeout(r, 150));
    expect(tunnel.status).toEqual({ state: "stopped" });
  });
});
