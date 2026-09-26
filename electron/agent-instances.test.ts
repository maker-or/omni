import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AcpAgentDescriptor } from "../contracts/acp.ts";

const safeStorageState = vi.hoisted(() => ({ available: true }));

vi.mock("electron", () => ({
  app: { getPath: () => process.env.PIPPER_LIBRARY_PATH ?? process.env.TMPDIR ?? "/tmp" },
  // Reversible stand-in so the encryption round-trip is observable without a
  // real OS keychain. `available` is togglable to exercise the refusal path.
  safeStorage: {
    isEncryptionAvailable: () => safeStorageState.available,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`, "utf8"),
    decryptString: (buffer: Buffer) => buffer.toString("utf8").replace(/^sealed:/, ""),
  },
}));

// Deterministic driver catalog; the real registry probes PATH, which we don't
// want to depend on here. Mirrors the shape agent-instances consumes.
vi.mock("./agents/registry.ts", () => {
  const drivers: AcpAgentDescriptor[] = [
    {
      id: "codex-acp",
      name: "codex-cli",
      displayName: "Codex",
      command: "codex-acp",
      args: [],
      env: { SHARED: "driver" },
    },
    {
      id: "claude-agent-acp",
      name: "claude-code",
      displayName: "Claude",
      command: "npx",
      args: [],
    },
    {
      id: "cursor-acp",
      name: "cursor",
      displayName: "Cursor",
      command: "agent",
      args: ["acp"],
    },
  ];
  return {
    listRegisteredAgents: () => drivers.map((driver) => ({ ...driver })),
    setInstanceDescriptorProvider: () => {},
    descriptorDriverId: (descriptor: AcpAgentDescriptor) => descriptor.driverId ?? descriptor.id,
  };
});

let root: string | null = null;

beforeEach(() => {
  vi.resetModules();
  safeStorageState.available = true;
  root = mkdtempSync(join(tmpdir(), "pipper-agent-instances-"));
  process.env.PIPPER_LIBRARY_PATH = root;
});

afterEach(async () => {
  const { closeDb } = await import("./db.ts");
  closeDb();
  delete process.env.PIPPER_LIBRARY_PATH;
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

async function load() {
  const db = await import("./db.ts");
  db.getDb();
  const mod = await import("./agent-instances.ts");
  return mod;
}

describe("agent instances", () => {
  test("seeds one default instance per driver", async () => {
    const mod = await load();
    mod.ensureDefaultAgentInstances();
    const ids = mod.listAgentInstances().map((instance) => instance.id);
    expect(ids).toContain("codex-acp");
    expect(ids).toContain("claude-agent-acp");
    // Defaults reuse the driver id so legacy threads/selections resolve.
    const codex = mod.getAgentInstance("codex-acp");
    expect(codex?.driverId).toBe("codex-acp");
  });

  test("creates a named account with a distinct id", async () => {
    const mod = await load();
    mod.ensureDefaultAgentInstances();
    const created = mod.createAgentInstance({
      driverId: "codex-acp",
      displayName: "Work",
      env: [{ name: "CODEX_HOME", value: "/tmp/work" }],
    });
    expect(created.id).toBe("codex-acp:work");
    expect(created.driverId).toBe("codex-acp");
  });

  test("auto-isolates a new account's credential root when env is omitted", async () => {
    const mod = await load();
    mod.ensureDefaultAgentInstances();
    const created = mod.createAgentInstance({ driverId: "codex-acp", displayName: "Work" });
    const profileVar = (created.env ?? []).find((entry) => entry.name === "CODEX_HOME");
    expect(profileVar?.value).toContain("accounts");
    // The CLI refuses to start if the credential root doesn't exist, so the
    // directory must be materialized at creation time.
    expect(existsSync(profileVar?.value ?? "")).toBe(true);
    // The default instance keeps the ambient login (no forced profile dir).
    const defaultInstance = mod.getAgentInstance("codex-acp");
    expect(defaultInstance?.env).toBeUndefined();
  });

  test("resolves an instance descriptor with merged env", async () => {
    const mod = await load();
    mod.ensureDefaultAgentInstances();
    mod.createAgentInstance({
      driverId: "codex-acp",
      displayName: "Work",
      env: [{ name: "CODEX_HOME", value: "/tmp/work" }],
    });
    const descriptor = mod.resolveAgentInstanceDescriptor("codex-acp:work");
    expect(descriptor?.id).toBe("codex-acp:work");
    expect(descriptor?.driverId).toBe("codex-acp");
    // Driver env survives; instance env overlays it.
    expect(descriptor?.env).toEqual({ SHARED: "driver", CODEX_HOME: "/tmp/work" });
  });

  test("returns null for an unknown instance", async () => {
    const mod = await load();
    mod.ensureDefaultAgentInstances();
    expect(mod.resolveAgentInstanceDescriptor("does-not-exist")).toBeNull();
  });

  test("redacts sensitive env values for the renderer", async () => {
    const mod = await load();
    mod.ensureDefaultAgentInstances();
    const created = mod.createAgentInstance({
      driverId: "codex-acp",
      displayName: "Work",
      env: [
        { name: "CODEX_HOME", value: "/tmp/work" },
        { name: "CODEX_API_KEY", value: "secret", sensitive: true },
      ],
    });
    const redacted = mod.redactInstance(created);
    const byName = Object.fromEntries((redacted.env ?? []).map((e) => [e.name, e.value]));
    expect(byName.CODEX_HOME).toBe("/tmp/work");
    expect(byName.CODEX_API_KEY).toBe("");
  });

  test("refuses to delete a driver's default instance", async () => {
    const mod = await load();
    mod.ensureDefaultAgentInstances();
    expect(() => mod.deleteAgentInstance("codex-acp")).toThrow(/default instance/);
  });

  test("encrypts sensitive env at rest and decrypts on read", async () => {
    const mod = await load();
    mod.ensureDefaultAgentInstances();
    const created = mod.createAgentInstance({
      driverId: "cursor-acp",
      displayName: "Work",
      env: [{ name: "CURSOR_API_KEY", value: "super-secret", sensitive: true }],
    });
    // Raw row holds ciphertext (safeStorage marker), never the cleartext.
    const db = (await import("./db.ts")).getDb();
    const row = db.prepare("SELECT env_json FROM agent_instances WHERE id = ?").get(created.id) as {
      env_json: string;
    };
    expect(row.env_json).toContain("enc:");
    expect(row.env_json).not.toContain("super-secret");
    // Round-trips back to the original value for spawn env.
    const read = mod.getAgentInstance(created.id);
    expect((read?.env ?? []).find((e) => e.name === "CURSOR_API_KEY")?.value).toBe("super-secret");
  });

  test("builds a login command that exports the account's credential root", async () => {
    const mod = await load();
    mod.ensureDefaultAgentInstances();
    const created = mod.createAgentInstance({ driverId: "codex-acp", displayName: "Work" });
    const command = mod.buildInstanceLoginCommand(created);
    expect(command).toContain("CODEX_HOME=");
    expect(command).toContain("codex login");
    // API-key providers have no interactive login.
    expect(mod.buildInstanceLoginCommand({ ...created, driverId: "cursor-acp" })).toBeNull();
  });

  test("builds a Windows-compatible login command", async () => {
    const mod = await load();
    mod.ensureDefaultAgentInstances();
    const created = mod.createAgentInstance({ driverId: "codex-acp", displayName: "Work" });
    const command = mod.buildInstanceLoginCommand(created, "win32");
    expect(command).toMatch(/^set "CODEX_HOME=.*" && codex login$/);
  });

  test("rejects an unknown driverId", async () => {
    const mod = await load();
    mod.ensureDefaultAgentInstances();
    expect(() => mod.createAgentInstance({ driverId: "nope", displayName: "X" })).toThrow(
      /Unknown driverId/,
    );
  });

  test("refuses to store a secret when encryption is unavailable", async () => {
    const mod = await load();
    mod.ensureDefaultAgentInstances();
    safeStorageState.available = false;
    expect(() =>
      mod.createAgentInstance({
        driverId: "cursor-acp",
        displayName: "Work",
        env: [{ name: "CURSOR_API_KEY", value: "plaintext", sensitive: true }],
      }),
    ).toThrow(/plaintext/);
  });

  test("preserves a stored secret when a redacted empty value round-trips", async () => {
    const mod = await load();
    mod.ensureDefaultAgentInstances();
    const created = mod.createAgentInstance({
      driverId: "cursor-acp",
      displayName: "Work",
      env: [{ name: "CURSOR_API_KEY", value: "keep-me", sensitive: true }],
    });
    // Renderer got "", then sends the account back while editing another field.
    mod.updateAgentInstance(created.id, {
      displayName: "Work Renamed",
      env: [{ name: "CURSOR_API_KEY", value: "", sensitive: true }],
    });
    const stored = mod.getAgentInstance(created.id);
    expect(stored?.displayName).toBe("Work Renamed");
    expect((stored?.env ?? []).find((e) => e.name === "CURSOR_API_KEY")?.value).toBe("keep-me");
  });

  test("strips ambient credentials for a non-default account", async () => {
    const mod = await load();
    mod.ensureDefaultAgentInstances();
    mod.createAgentInstance({ driverId: "codex-acp", displayName: "Work" });
    const descriptor = mod.resolveAgentInstanceDescriptor("codex-acp:work");
    expect(descriptor?.unsetEnv).toContain("OPENAI_API_KEY");
    expect(descriptor?.unsetEnv).toContain("CODEX_API_KEY");
    // The default instance keeps the ambient environment.
    expect(mod.resolveAgentInstanceDescriptor("codex-acp")?.unsetEnv).toBeUndefined();
  });

  test("re-points threads at the driver default when an account is removed", async () => {
    const mod = await load();
    mod.ensureDefaultAgentInstances();
    const created = mod.createAgentInstance({ driverId: "codex-acp", displayName: "Work" });
    const db = (await import("./db.ts")).getDb();
    db.prepare("INSERT INTO projects (id, path, name) VALUES (?, ?, ?)").run("p1", "/repo", "Repo");
    db.prepare(
      "INSERT INTO threads (id, project_id, agent_id, agent_session_id) VALUES (?, ?, ?, ?)",
    ).run("t1", "p1", created.id, "s1");

    mod.deleteAgentInstance(created.id);

    const row = db.prepare("SELECT agent_id FROM threads WHERE id = ?").get("t1") as {
      agent_id: string;
    };
    expect(row.agent_id).toBe("codex-acp");
  });
});
