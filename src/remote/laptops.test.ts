import { describe, expect, it } from "vitest";
import {
  activeLaptop,
  forgetLaptop,
  isAllowedLaptopHost,
  laptopLabel,
  loadLaptops,
  migrateLegacyToken,
  otherOwners,
  parsePairingLink,
  rememberLaptop,
  setActiveLaptop,
  type KeyValueStore,
  type PairedLaptop,
} from "./laptops.ts";

function memoryStore(
  seed: Record<string, string> = {},
): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const laptop = (id: string, token = `tok-${id}`): PairedLaptop => ({
  id,
  apiBase: id === "self" ? "" : `https://${id}`,
  token,
  deviceName: "iPhone · Safari",
  pairedAt: 1,
});

describe("phone laptop list", () => {
  it("only lets pairing links point at reserved laptop hosts", () => {
    expect(isAllowedLaptopHost("lt-3f9a0c1d2e4b5a6c7d8e.pipper.dev", "pipper.dev")).toBe(true);
    expect(isAllowedLaptopHost("LT-DEVTEST.pipper.dev", "pipper.dev")).toBe(true);
    for (const host of [
      "www.pipper.dev",
      "accounts.pipper.dev",
      "lt-x.pipper.dev.evil.example",
      "lt-x.evilpipper.dev",
      "lt-.pipper.dev",
      "a.lt-x.pipper.dev",
      "evil.example",
    ]) {
      expect(isAllowedLaptopHost(host, "pipper.dev"), host).toBe(false);
    }
  });

  it("parses laptop-served and hosted pairing links", () => {
    expect(parsePairingLink("https://x/remote#pair=ABCDE12345")).toEqual({
      code: "ABCDE12345",
      host: null,
    });
    expect(parsePairingLink("#pair=ABCDE12345&host=LT-abc.pipper.dev")).toEqual({
      code: "ABCDE12345",
      host: "lt-abc.pipper.dev",
    });
    expect(parsePairingLink("#token=old")).toBeNull();
    expect(parsePairingLink("#pair=<script>")).toBeNull();
  });

  it("carries a pre-existing single token over as this laptop", () => {
    const store = memoryStore({ "omni:remote-token": "legacy" });
    migrateLegacyToken(store, 5);
    expect(activeLaptop(store)).toMatchObject({ id: "self", apiBase: "", token: "legacy" });
    expect(store.data.has("omni:remote-token")).toBe(false);
    migrateLegacyToken(store);
    expect(loadLaptops(store)).toHaveLength(1);
  });

  it("remembers several laptops, switches, and forgets one at a time", () => {
    const store = memoryStore();
    rememberLaptop(store, laptop("lt-a.pipper.dev"));
    rememberLaptop(store, laptop("lt-b.pipper.dev"));
    expect(activeLaptop(store)?.id).toBe("lt-b.pipper.dev");
    setActiveLaptop(store, "lt-a.pipper.dev");
    expect(activeLaptop(store)?.id).toBe("lt-a.pipper.dev");
    // Re-pairing replaces the token instead of duplicating the laptop.
    rememberLaptop(store, laptop("lt-a.pipper.dev", "new-token"));
    expect(
      loadLaptops(store)
        .map((l) => l.id)
        .sort(),
    ).toEqual(["lt-a.pipper.dev", "lt-b.pipper.dev"]);
    expect(activeLaptop(store)?.token).toBe("new-token");
    forgetLaptop(store, "lt-a.pipper.dev");
    expect(activeLaptop(store)?.id).toBe("lt-b.pipper.dev");
    forgetLaptop(store, "lt-b.pipper.dev");
    expect(activeLaptop(store)).toBeNull();
  });

  it("labels laptops by verified owner, else by their own name", () => {
    expect(
      laptopLabel({
        ...laptop("lt-a.pipper.dev"),
        name: "MacBook",
        owner: { sub: "u1", email: "me@x.dev", name: "Me" },
      }),
    ).toBe("MacBook · me@x.dev");
    expect(laptopLabel({ ...laptop("lt-a.pipper.dev"), name: "MacBook", owner: null })).toBe(
      "MacBook",
    );
    expect(laptopLabel(laptop("self"))).toBe("This laptop");
  });

  it("names other accounts' laptops so a stranger's laptop stands out", () => {
    const mine = {
      ...laptop("lt-a.pipper.dev"),
      owner: { sub: "me", email: "me@x.dev", name: null },
    };
    const unverified = { ...laptop("lt-b.pipper.dev"), owner: null };
    expect(otherOwners([mine, unverified], "me")).toEqual([]);
    expect(otherOwners([mine, unverified], "attacker")).toEqual(["me@x.dev"]);
    expect(otherOwners([mine], null)).toEqual(["me@x.dev"]);
  });

  it("survives corrupt or unavailable storage", () => {
    expect(loadLaptops(memoryStore({ "omni:remote-laptops": "{not json" }))).toEqual([]);
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => rememberLaptop(broken, laptop("lt-a.pipper.dev"))).not.toThrow();
    expect(activeLaptop(broken)).toBeNull();
  });
});
