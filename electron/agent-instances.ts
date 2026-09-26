import { join } from "node:path";
import { app, safeStorage } from "electron";
import type {
  AcpAgentDescriptor,
  AcpAgentInstance,
  AcpAgentInstanceEnvVar,
  AcpAgentInstanceInput,
  AgentAccountSchema,
} from "../contracts/acp.ts";
import { getDb } from "./db.ts";
import { listRegisteredAgents, setInstanceDescriptorProvider } from "./agents/registry.ts";

interface AgentInstanceRow {
  id: string;
  driver_id: string;
  display_name: string;
  enabled: number;
  env_json: string | null;
  config_json: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * The environment variable that points a given CLI at an isolated credential
 * root. Providers absent from this map are isolated with explicit keys/tokens
 * instead of a directory (e.g. Cursor's CURSOR_API_KEY, Gemini's API key).
 */
export const PROFILE_ENV_BY_DRIVER: Record<string, string> = {
  "codex-acp": "CODEX_HOME",
  "claude-agent-acp": "CLAUDE_CONFIG_DIR",
  "grok-acp": "GROK_HOME",
  "copilot-acp": "COPILOT_HOME",
  "opencode-acp": "XDG_DATA_HOME",
  "antigravity-acp": "AGY_HOME",
};

/**
 * Drivers that are isolated with an explicit key/token rather than a profile
 * directory. Used to prompt for a credential when adding an account.
 */
export const AUTH_ENV_BY_DRIVER: Record<string, string> = {
  "cursor-acp": "CURSOR_API_KEY",
  "gemini-acp": "GEMINI_API_KEY",
};

/**
 * Interactive sign-in command per driver, run once per account inside the
 * user's terminal (never in-process) so the CLI performs its own OAuth flow
 * and owns its credentials. Drivers that authenticate purely via an API key
 * are absent. Best-effort: verify against each CLI's current docs.
 */
export const LOGIN_COMMAND_BY_DRIVER: Record<string, string> = {
  "codex-acp": "codex login",
  "claude-agent-acp": "claude auth login",
  "grok-acp": "grok login",
  "copilot-acp": "copilot",
  "opencode-acp": "opencode auth login",
  "antigravity-acp": "agy",
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The shell command a user runs to sign an account in, with its credential
 * root exported inline. Returns null when the driver has no interactive login
 * (API-key providers) so the UI can prompt for a key instead.
 */
export function buildInstanceLoginCommand(instance: AcpAgentInstance): string | null {
  const login = LOGIN_COMMAND_BY_DRIVER[instance.driverId];
  if (!login) return null;
  const profileVar = PROFILE_ENV_BY_DRIVER[instance.driverId];
  if (!profileVar) return login;
  const entry = (instance.env ?? []).find((item) => item.name === profileVar);
  if (!entry?.value) return login;
  return `${profileVar}=${shellQuote(entry.value)} ${login}`;
}

function parseEnv(raw: string | null): AcpAgentInstanceEnvVar[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as AcpAgentInstanceEnvVar[];
    if (!Array.isArray(parsed)) return undefined;
    return parsed.map((entry) =>
      entry.sensitive ? { ...entry, value: decryptSecret(entry.value) } : entry,
    );
  } catch {
    return undefined;
  }
}

/** Marker for values protected with the OS keychain via `safeStorage`. */
const ENC_PREFIX = "enc:";

function encryptSecret(value: string): string {
  if (!value) return value;
  try {
    if (safeStorage?.isEncryptionAvailable()) {
      return ENC_PREFIX + safeStorage.encryptString(value).toString("base64");
    }
  } catch {
    // Fall through to plaintext (e.g. unsupported platform).
  }
  return value;
}

function decryptSecret(value: string): string {
  if (!value.startsWith(ENC_PREFIX)) return value;
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), "base64"));
  } catch {
    return "";
  }
}

/** Encrypt sensitive values before they touch disk. */
function serializeEnv(env: AcpAgentInstanceEnvVar[] | undefined): string | null {
  if (!env?.length) return null;
  return JSON.stringify(
    env.map((entry) => (entry.sensitive ? { ...entry, value: encryptSecret(entry.value) } : entry)),
  );
}

function parseConfig(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function rowToInstance(row: AgentInstanceRow): AcpAgentInstance {
  return {
    id: row.id,
    driverId: row.driver_id,
    displayName: row.display_name,
    enabled: row.enabled !== 0,
    env: parseEnv(row.env_json),
    config: parseConfig(row.config_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function slug(input: string): string {
  const value = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return value || "account";
}

/** Redact sensitive env values before sending an instance to the renderer. */
export function redactInstance(instance: AcpAgentInstance): AcpAgentInstance {
  if (!instance.env?.some((entry) => entry.sensitive)) return instance;
  return {
    ...instance,
    env: instance.env.map((entry) => (entry.sensitive ? { ...entry, value: "" } : entry)),
  };
}

export function listAgentInstances(): AcpAgentInstance[] {
  const rows = getDb()
    .prepare("SELECT * FROM agent_instances ORDER BY driver_id ASC, created_at ASC, rowid ASC")
    .all() as unknown as AgentInstanceRow[];
  return rows.map(rowToInstance);
}

/** Renderer-facing copy with sensitive env values redacted. */
export function listAgentInstancesForRenderer(): AcpAgentInstance[] {
  return listAgentInstances().map(redactInstance);
}

export function getAgentInstance(id: string): AcpAgentInstance | null {
  const row = getDb().prepare("SELECT * FROM agent_instances WHERE id = ?").get(id) as
    | AgentInstanceRow
    | undefined;
  return row ? rowToInstance(row) : null;
}

function instanceIdFor(driverId: string, label: string): string {
  const base = `${driverId}:${slug(label)}`;
  const db = getDb();
  let candidate = base;
  let suffix = 2;
  // Ids are the spawn routing key; collisions would alias two accounts.
  while (db.prepare("SELECT 1 FROM agent_instances WHERE id = ?").get(candidate)) {
    candidate = `${base}-${suffix++}`;
  }
  return candidate;
}

/** Directory an account's CLI should treat as its isolated credential root. */
export function profileDirForInstance(driverId: string, instanceId: string): string {
  return join(app.getPath("userData"), "accounts", driverId, slug(instanceId));
}

/**
 * Default env for a fresh non-default account: point the driver's credential
 * root at a Pipper-owned directory. Returns `[]` for key/token-based providers.
 */
export function suggestProfileEnv(driverId: string, instanceId: string): AcpAgentInstanceEnvVar[] {
  const envVar = PROFILE_ENV_BY_DRIVER[driverId];
  if (!envVar) return [];
  return [{ name: envVar, value: profileDirForInstance(driverId, instanceId), sensitive: false }];
}

export function createAgentInstance(input: AcpAgentInstanceInput): AcpAgentInstance {
  const driverId = input.driverId.trim();
  if (!driverId) throw new Error("driverId is required");
  const displayName = input.displayName.trim() || driverId;
  const id = (input.id?.trim() || instanceIdFor(driverId, displayName)).trim();
  // Additional accounts default to an isolated credential root so two logins
  // of the same driver cannot share the ambient config. The default instance
  // (id === driverId) intentionally keeps the ambient login.
  const env =
    input.env && input.env.length
      ? input.env
      : id === driverId
        ? undefined
        : suggestProfileEnv(driverId, id);
  const now = Date.now();
  const row: AgentInstanceRow = {
    id,
    driver_id: driverId,
    display_name: displayName,
    enabled: input.enabled === false ? 0 : 1,
    env_json: serializeEnv(env),
    config_json: input.config ? JSON.stringify(input.config) : null,
    created_at: now,
    updated_at: now,
  };
  getDb()
    .prepare(
      `INSERT INTO agent_instances (id, driver_id, display_name, enabled, env_json, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.driver_id,
      row.display_name,
      row.enabled,
      row.env_json,
      row.config_json,
      row.created_at,
      row.updated_at,
    );
  return rowToInstance(row);
}

export function updateAgentInstance(
  id: string,
  input: Partial<AcpAgentInstanceInput>,
): AcpAgentInstance | null {
  const existing = getAgentInstance(id);
  if (!existing) return null;
  const updated: AcpAgentInstance = {
    ...existing,
    displayName: input.displayName?.trim() || existing.displayName,
    enabled: input.enabled ?? existing.enabled,
    env: input.env ?? existing.env,
    config: input.config ?? existing.config,
    updatedAt: Date.now(),
  };
  getDb()
    .prepare(
      `UPDATE agent_instances SET display_name = ?, enabled = ?, env_json = ?, config_json = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      updated.displayName,
      updated.enabled ? 1 : 0,
      serializeEnv(updated.env),
      updated.config ? JSON.stringify(updated.config) : null,
      updated.updatedAt ?? Date.now(),
      id,
    );
  return updated;
}

export function deleteAgentInstance(id: string): void {
  // The default instance (id === driver id) is structurally required: it backs
  // the driver's ambient login and legacy thread rows.
  const existing = getAgentInstance(id);
  if (existing && existing.id === existing.driverId) {
    throw new Error("Cannot delete a driver's default instance");
  }
  getDb().prepare("DELETE FROM agent_instances WHERE id = ?").run(id);
}

function driverDescriptorById(): Map<string, AcpAgentDescriptor> {
  return new Map(listRegisteredAgents().map((descriptor) => [descriptor.id, descriptor]));
}

function materialize(instance: AcpAgentInstance, driver: AcpAgentDescriptor): AcpAgentDescriptor {
  const env: Record<string, string> = { ...driver.env };
  for (const entry of instance.env ?? []) {
    if (entry.name) env[entry.name] = entry.value;
  }
  return {
    ...driver,
    id: instance.id,
    driverId: instance.driverId,
    displayName: instance.displayName,
    env,
  };
}

/** Resolve an instance id to a spawnable descriptor with merged env. */
export function resolveAgentInstanceDescriptor(instanceId: string): AcpAgentDescriptor | null {
  const instance = getAgentInstance(instanceId);
  if (!instance || !instance.enabled) return null;
  const driver = driverDescriptorById().get(instance.driverId);
  if (!driver) return null;
  return materialize(instance, driver);
}

/** Every enabled instance as a descriptor, for agent/account pickers. */
export function listAgentInstanceDescriptors(): AcpAgentDescriptor[] {
  const drivers = driverDescriptorById();
  const out: AcpAgentDescriptor[] = [];
  for (const instance of listAgentInstances()) {
    if (!instance.enabled) continue;
    const driver = drivers.get(instance.driverId);
    if (!driver) continue;
    out.push(materialize(instance, driver));
  }
  return out;
}

/** Per-driver account-creation capabilities, for the settings UI. */
export function listAgentAccountSchemas(): AgentAccountSchema[] {
  return listRegisteredAgents().map((driver) => ({
    driverId: driver.id,
    displayName: driver.displayName,
    icon: driver.icon,
    profileEnvVar: PROFILE_ENV_BY_DRIVER[driver.id] ?? null,
    authEnvVar: AUTH_ENV_BY_DRIVER[driver.id] ?? null,
    supportsMultipleAccounts: Boolean(
      PROFILE_ENV_BY_DRIVER[driver.id] ?? AUTH_ENV_BY_DRIVER[driver.id],
    ),
    supportsLogin: Boolean(LOGIN_COMMAND_BY_DRIVER[driver.id]),
  }));
}

/**
 * Backfill the required default instance for every known driver. The default
 * instance reuses the driver id so existing threads, selections, and ambient
 * CLI logins keep working with no migration.
 */
export function ensureDefaultAgentInstances(): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO agent_instances (id, driver_id, display_name, enabled, env_json, config_json, created_at, updated_at)
     VALUES (?, ?, ?, 1, NULL, NULL, ?, ?)`,
  );
  const now = Date.now();
  for (const driver of listRegisteredAgents()) {
    insert.run(driver.id, driver.id, driver.displayName, now, now);
  }
}

/**
 * Seed defaults and register the instance resolver with the registry. Call
 * once after the database is ready (agent-instances.ts owns the only writer).
 */
export function installAgentInstanceProvider(): void {
  ensureDefaultAgentInstances();
  setInstanceDescriptorProvider((instanceId) => resolveAgentInstanceDescriptor(instanceId));
}
