import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { AcpAgentDescriptor } from "../../contracts/acp.ts";
import { probeAgentById, probeAgentHandshake } from "./handshake-probe.ts";

function writeScript(dir: string, name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

/** A descriptor that runs `node <script>` directly, bypassing PATH detection entirely. */
function nodeScriptDescriptor(scriptPath: string): AcpAgentDescriptor {
  return {
    id: "test-agent",
    name: "test-agent",
    displayName: "Test Agent",
    command: process.execPath,
    args: [scriptPath],
    installKind: "binary",
  };
}

describe("probeAgentHandshake", () => {
  test("pipper-mock reports ready", async () => {
    const result = await probeAgentById("pipper-mock");
    expect(result.status).toBe("ready");
  });

  test("descriptor already marked unavailable short-circuits to needs-install without spawning", async () => {
    const result = await probeAgentHandshake({
      id: "missing-agent",
      name: "missing-agent",
      displayName: "Missing Agent",
      command: "definitely-not-a-real-binary-xyz",
      args: [],
      available: false,
      installHint: "Install the thing first.",
    });
    expect(result.status).toBe("needs-install");
    expect(result.message).toContain("Install the thing first");
  });

  test("agent reporting supported authMethods is still classified ready", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pipper-probe-"));
    const script = writeScript(
      dir,
      "auth-required-agent.mjs",
      `
      import { createInterface } from "node:readline";
      const rl = createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              protocolVersion: 1,
              authMethods: [{ id: "login", name: "Log in" }],
            },
          }) + "\\n");
        }
      });
      `,
    );

    const result = await probeAgentHandshake(nodeScriptDescriptor(script));
    expect(result).toEqual({ agentId: "test-agent", status: "ready" });
  });

  test("agent that never responds is classified as an error after the timeout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pipper-probe-"));
    const script = writeScript(
      dir,
      "silent-agent.mjs",
      `
      // Never responds to stdin; just idles.
      setInterval(() => {}, 1000);
      `,
    );

    const result = await probeAgentHandshake(nodeScriptDescriptor(script), { timeoutMs: 300 });
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/did not respond/i);
  });

  test("agent that crashes immediately is classified as an error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pipper-probe-"));
    const script = writeScript(
      dir,
      "crashing-agent.mjs",
      `
      console.error("boom: missing dependency");
      process.exit(1);
      `,
    );

    const result = await probeAgentHandshake(nodeScriptDescriptor(script));
    expect(result.status).toBe("error");
    expect(result.message).toBeTruthy();
  });

  test("probeAgentById returns an error for an unknown agent id", async () => {
    const result = await probeAgentById("not-a-real-agent-id");
    expect(result.status).toBe("error");
  });
});
