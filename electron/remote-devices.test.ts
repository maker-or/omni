import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  REMOTE_DEVICE_IDLE_EXPIRY_MS,
  RemoteDeviceStore,
  sanitizeDeviceName,
} from "./remote-devices.ts";

function store() {
  const db = new DatabaseSync(":memory:");
  return { db, devices: new RemoteDeviceStore(db) };
}

describe("remote device store", () => {
  it("authenticates a device by its token and never stores the token itself", () => {
    const { db, devices } = store();
    const { device, token } = devices.create({ name: "iPhone", scopes: ["read", "run"] }, 0);
    expect(devices.authenticate(token, 1)).toMatchObject({
      id: device.id,
      scopes: ["read", "run"],
    });
    expect(devices.authenticate(`${token}x`, 1)).toBeNull();
    const dump = JSON.stringify(db.prepare("SELECT * FROM remote_devices").all());
    expect(dump).not.toContain(token);
  });

  it("gives every device its own token and revokes them independently", () => {
    const { devices } = store();
    const a = devices.create({ name: "A", scopes: ["read"] }, 0);
    const b = devices.create({ name: "B", scopes: ["read"] }, 0);
    expect(a.token).not.toBe(b.token);
    expect(devices.revoke(a.device.id)).toBe(true);
    expect(devices.authenticate(a.token, 1)).toBeNull();
    expect(devices.authenticate(b.token, 1)?.name).toBe("B");
    expect(devices.list(1).map((d) => d.name)).toEqual(["B"]);
  });

  it("expires devices left unused and keeps active ones alive", () => {
    const { devices } = store();
    const idle = devices.create({ name: "Idle", scopes: ["read"] }, 0);
    const active = devices.create({ name: "Active", scopes: ["read"] }, 0);
    const halfway = REMOTE_DEVICE_IDLE_EXPIRY_MS / 2;
    expect(devices.authenticate(active.token, halfway)).not.toBeNull();
    const later = REMOTE_DEVICE_IDLE_EXPIRY_MS + 1;
    expect(devices.authenticate(idle.token, later)).toBeNull();
    expect(devices.authenticate(active.token, later)).not.toBeNull();
    expect(devices.list(later).map((d) => d.name)).toEqual(["Active"]);
  });

  it("drops unknown scopes and cleans device names", () => {
    const { devices } = store();
    const { device } = devices.create(
      { name: "Evil\nphone", scopes: ["read", "admin" as never] },
      0,
    );
    expect(device.scopes).toEqual(["read"]);
    expect(device.name).toBe("Evil phone");
    expect(sanitizeDeviceName("   ")).toBe("Phone");
  });
});
