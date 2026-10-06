import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { RemoteDevice, RemoteScope } from "../contracts/remote.ts";

/** A device unused for this long must pair again. */
export const REMOTE_DEVICE_IDLE_EXPIRY_MS = 30 * 24 * 60 * 60_000;
/** last_seen_at is a display hint; don't write it on every poll. */
const TOUCH_INTERVAL_MS = 60_000;
const MAX_NAME_LENGTH = 60;
const KNOWN_SCOPES: readonly RemoteScope[] = ["read", "run"];

export function ensureRemoteDeviceSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS remote_devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      scopes TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER
    );
  `);
}

interface DeviceRow {
  id: string;
  name: string;
  scopes: string;
  created_at: number;
  last_seen_at: number | null;
}

/** Only a digest is stored, so a copied database cannot be replayed as a token. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseScopes(raw: string): RemoteScope[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? KNOWN_SCOPES.filter((scope) => value.includes(scope)) : [];
  } catch {
    return [];
  }
}

function toDevice(row: DeviceRow): RemoteDevice {
  return {
    id: row.id,
    name: row.name,
    scopes: parseScopes(row.scopes),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function sanitizeDeviceName(name: string | undefined): string {
  // eslint-disable-next-line no-control-regex
  const clean = (name ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return clean.slice(0, MAX_NAME_LENGTH) || "Phone";
}

/**
 * Paired phones. Each device has its own long random token, so one device can
 * be revoked without touching the others; revocation deletes the row, and a
 * device idle past REMOTE_DEVICE_IDLE_EXPIRY_MS stops authenticating.
 */
export class RemoteDeviceStore {
  private readonly db: DatabaseSync;
  private readonly lastTouched = new Map<string, number>();

  constructor(db: DatabaseSync) {
    this.db = db;
    ensureRemoteDeviceSchema(db);
  }

  create(input: { name?: string; scopes: RemoteScope[] }, now = Date.now()) {
    const token = randomBytes(32).toString("base64url");
    const device: RemoteDevice = {
      id: randomUUID(),
      name: sanitizeDeviceName(input.name),
      scopes: KNOWN_SCOPES.filter((scope) => input.scopes.includes(scope)),
      createdAt: now,
      lastSeenAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO remote_devices (id, name, token_hash, scopes, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        device.id,
        device.name,
        hashToken(token),
        JSON.stringify(device.scopes),
        device.createdAt,
        device.lastSeenAt,
      );
    this.lastTouched.set(device.id, now);
    return { device, token };
  }

  /**
   * The device a bearer token belongs to, or null. Lookup is by SHA-256 of a
   * 256-bit random token, so index timing reveals nothing usable about it.
   */
  authenticate(token: string, now = Date.now()): RemoteDevice | null {
    if (!token) return null;
    const row = this.db
      .prepare(
        `SELECT id, name, scopes, created_at, last_seen_at
         FROM remote_devices WHERE token_hash = ?`,
      )
      .get(hashToken(token)) as DeviceRow | undefined;
    if (!row) return null;
    const lastActive = row.last_seen_at ?? row.created_at;
    if (now - lastActive > REMOTE_DEVICE_IDLE_EXPIRY_MS) {
      this.revoke(row.id);
      return null;
    }
    this.touch(row.id, now);
    return toDevice({
      ...row,
      last_seen_at: Math.max(lastActive, this.lastTouched.get(row.id) ?? 0),
    });
  }

  list(now = Date.now()): RemoteDevice[] {
    this.db
      .prepare(`DELETE FROM remote_devices WHERE COALESCE(last_seen_at, created_at) < ?`)
      .run(now - REMOTE_DEVICE_IDLE_EXPIRY_MS);
    const rows = this.db
      .prepare(
        `SELECT id, name, scopes, created_at, last_seen_at
         FROM remote_devices ORDER BY created_at DESC`,
      )
      .all() as unknown as DeviceRow[];
    return rows.map(toDevice);
  }

  /** Returns true when a device was removed. */
  revoke(id: string): boolean {
    this.lastTouched.delete(id);
    const result = this.db.prepare(`DELETE FROM remote_devices WHERE id = ?`).run(id);
    return Number(result.changes) > 0;
  }

  private touch(id: string, now: number): void {
    const last = this.lastTouched.get(id) ?? 0;
    if (now - last < TOUCH_INTERVAL_MS) return;
    this.lastTouched.set(id, now);
    this.db.prepare(`UPDATE remote_devices SET last_seen_at = ? WHERE id = ?`).run(now, id);
  }
}
