import { afterEach, describe, expect, it, vi } from "vitest";

import { RemoteClient, RemoteClientError } from "./client";
import { parsePairingLink } from "./pairing-link";
import { SubmissionStore } from "./submissions";
import type { RemoteConfig } from "./types";

const config: RemoteConfig = {
  baseURL: "https://lt-ab12cd.pipper.dev",
  token: "device-token",
  laptopName: "Studio",
  owner: null,
  deviceName: "iPhone · Pipper app",
};

function respond(status: number, body: unknown) {
  const fetch = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("remote client", () => {
  it("sends the device token to the paired laptop only", async () => {
    const fetch = respond(200, { threads: [] });
    await new RemoteClient(config).listThreads();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://lt-ab12cd.pipper.dev/api/remote/threads");
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer device-token");
  });

  it("unpairs when the laptop refuses this phone", async () => {
    respond(401, { error: "Unauthorized" });
    const onUnauthorized = vi.fn();
    const error = await new RemoteClient(config, onUnauthorized).listThreads().catch((e) => e);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(error).toBeInstanceOf(RemoteClientError);
    expect((error as Error).message).toContain("Pair again");
  });

  it("marks confirmed rejections as safe to retry and surfaces server messages", async () => {
    respond(409, { error: "Worktree could not be created", retryable: true });
    const rejected = await new RemoteClient(config).sendPrompt("t", "hi", "r").catch((e) => e);
    expect(rejected).toMatchObject({ kind: "rejected", message: "Worktree could not be created" });

    respond(500, { error: "Internal error" });
    const failed = await new RemoteClient(config).sendPrompt("t", "hi", "r").catch((e) => e);
    expect(failed).toMatchObject({ kind: "http", status: 500 });
    expect((failed as Error).message).toBe("Mac returned HTTP 500: Internal error");
  });

  it("never hits the network without a pairing", async () => {
    const fetch = respond(200, {});
    const error = await new RemoteClient({ ...config, token: "" }).health().catch((e) => e);
    expect(error).toMatchObject({ kind: "notPaired" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("explains a wrong or expired pairing code", async () => {
    respond(401, { error: "Invalid code" });
    const link = parsePairingLink(
      "https://remote.pipper.dev/#pair=ABCDE&host=lt-ab12cd.pipper.dev",
    )!;
    const error = await RemoteClient.previewPairing(link).catch((e) => e);
    expect((error as Error).message).toMatch(/wrong or has expired/);
  });
});

describe("submission store", () => {
  function makeStore() {
    const data = new Map<string, string>();
    let next = 0;
    return new SubmissionStore(
      {
        getItem: async (k) => data.get(k) ?? null,
        setItem: async (k, v) => void data.set(k, v),
      },
      // Identity stands in for SHA-256: only key equality matters here.
      async (text) => text,
      () => `id-${++next}`,
    );
  }

  it("reuses the request ID until the Mac acknowledges it", async () => {
    const store = makeStore();
    const scope = ["https://lt-ab12cd.pipper.dev", "prompt", "thread", "hello"];
    const [first, again] = await Promise.all([store.requestId(scope), store.requestId(scope)]);
    expect(again).toBe(first);
    await store.acknowledge(scope, first);
    expect(await store.requestId(scope)).not.toBe(first);
  });

  it("keeps separate IDs for separate submissions", async () => {
    const store = makeStore();
    const a = await store.requestId(["x", "prompt", "t", "one"]);
    const b = await store.requestId(["x", "prompt", "t", "two"]);
    expect(a).not.toBe(b);
  });
});
