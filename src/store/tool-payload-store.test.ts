import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AcpToolCallState } from "../../contracts/acp.ts";
import { resolveToolCalls } from "../lib/resolve-tool-calls";
import {
  hydrateStoredToolCalls,
  rememberHydratedToolCalls,
  rememberToolPayloadFromUpdate,
  resetToolPayloadStore,
  setActiveToolPayloadThread,
  setToolPayloadBudgetBytes,
  toolPayloadStoreStats,
} from "./tool-payload-store";

const BODY_CHARS = 64 * 1024;

/** Distinct, position-dependent body so a wrong or truncated refetch cannot match. */
function body(threadId: string, length = BODY_CHARS): string {
  let out = `${threadId}:`;
  while (out.length < length) out += `${out.length.toString(36)}|`;
  return out.slice(0, length);
}

function completed(id: string, rawOutput?: string): AcpToolCallState {
  return {
    toolCallId: id,
    title: "Read",
    status: "completed",
    hasPayload: true,
    ...(rawOutput === undefined ? {} : { rawOutput }),
  };
}

/** What main would return from `agent.getToolCalls`: the authoritative bodies. */
function mainBodies(threads: number) {
  const bodies = new Map<string, string>();
  for (let i = 0; i < threads; i++) bodies.set(`thread-${i}`, body(`thread-${i}`));
  const getToolCalls = vi.fn(async (threadId: string, ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, completed(id, bodies.get(threadId))])),
  );
  (globalThis as { window?: unknown }).window = { omni: { agent: { getToolCalls } } };
  return { bodies, getToolCalls };
}

beforeEach(() => resetToolPayloadStore());
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("tool payload store byte budget", () => {
  test("expanding bodies across many threads stays within the budget", () => {
    const budget = 8 * BODY_CHARS;
    setToolPayloadBudgetBytes(budget);
    setActiveToolPayloadThread("thread-0");
    for (let i = 0; i < 40; i++) {
      rememberHydratedToolCalls(`thread-${i}`, { read: completed("read", body(`thread-${i}`)) });
      expect(toolPayloadStoreStats().retainedBytes).toBeLessThanOrEqual(budget);
    }
    const stats = toolPayloadStoreStats();
    expect(stats.bodies).toBeLessThan(40);
    // The displayed thread is pinned even though it is the oldest.
    const active = hydrateStoredToolCalls("thread-0", { read: completed("read") });
    expect(active.read!.rawOutput).toBe(body("thread-0"));
    // The most recent background thread is still cached.
    const recent = hydrateStoredToolCalls("thread-39", { read: completed("read") });
    expect(recent.read!.rawOutput).toBe(body("thread-39"));
  });

  test("evicted bodies refetch from main with exact content", async () => {
    const { bodies, getToolCalls } = mainBodies(30);
    setToolPayloadBudgetBytes(4 * BODY_CHARS);
    for (let i = 0; i < 30; i++) {
      rememberHydratedToolCalls(`thread-${i}`, {
        read: completed("read", bodies.get(`thread-${i}`)),
      });
    }
    const evicted = hydrateStoredToolCalls("thread-1", { read: completed("read") });
    expect(evicted.read!.rawOutput).toBeUndefined();

    for (let i = 0; i < 30; i++) {
      const resolved = await resolveToolCalls(`thread-${i}`, { read: completed("read") }, ["read"]);
      expect(resolved.read!.rawOutput).toBe(bodies.get(`thread-${i}`));
    }
    expect(getToolCalls).toHaveBeenCalledWith("thread-1", ["read"]);
    expect(toolPayloadStoreStats().retainedBytes).toBeLessThanOrEqual(4 * BODY_CHARS);
  });

  test("in-flight bodies are pinned until the tool settles", () => {
    setToolPayloadBudgetBytes(2 * BODY_CHARS);
    setActiveToolPayloadThread("active");
    rememberToolPayloadFromUpdate("background", {
      sessionUpdate: "tool_call",
      toolCallId: "run",
      title: "Run",
      status: "in_progress",
      rawInput: { command: "build" },
    });
    rememberToolPayloadFromUpdate("background", {
      sessionUpdate: "tool_call_update",
      toolCallId: "run",
      rawOutput: body("background"),
    });
    for (let i = 0; i < 6; i++) {
      rememberHydratedToolCalls(`other-${i}`, { read: completed("read", body(`other-${i}`)) });
    }
    const streaming = hydrateStoredToolCalls("background", {
      run: { toolCallId: "run", title: "Run", status: "in_progress" },
    });
    expect(streaming.run!.rawInput).toEqual({ command: "build" });
    expect(streaming.run!.rawOutput).toBe(body("background"));

    // Settling unpins it, so newer bodies can now push it out.
    rememberToolPayloadFromUpdate("background", {
      sessionUpdate: "tool_call_update",
      toolCallId: "run",
      status: "completed",
    });
    for (let i = 6; i < 8; i++) {
      rememberHydratedToolCalls(`other-${i}`, { read: completed("read", body(`other-${i}`)) });
    }
    expect(toolPayloadStoreStats().retainedBytes).toBeLessThanOrEqual(2 * BODY_CHARS);
    const settled = hydrateStoredToolCalls("background", { run: completed("run") });
    expect(settled.run!.rawOutput).toBeUndefined();
  });

  test("a partial update for an evicted body is not stored as complete", async () => {
    setToolPayloadBudgetBytes(BODY_CHARS * 1.5);
    rememberHydratedToolCalls("old", { read: completed("read", body("old")) });
    rememberHydratedToolCalls("new", { read: completed("read", body("new")) });
    expect(hydrateStoredToolCalls("old", { read: completed("read") }).read!.rawOutput).toBe(
      undefined,
    );
    // A late content-only update must not masquerade as the whole body.
    rememberToolPayloadFromUpdate("old", {
      sessionUpdate: "tool_call_update",
      toolCallId: "read",
      content: [{ type: "content", content: { type: "text", text: "late" } }],
    });
    const getToolCalls = vi.fn(async () => ({
      read: {
        ...completed("read", body("old")),
        content: [{ type: "content" as const, content: { type: "text" as const, text: "late" } }],
      },
    }));
    (globalThis as { window?: unknown }).window = { omni: { agent: { getToolCalls } } };
    const resolved = await resolveToolCalls("old", { read: completed("read") }, ["read"]);
    expect(getToolCalls).toHaveBeenCalledOnce();
    expect(resolved.read!.rawOutput).toBe(body("old"));
    expect(resolved.read!.content).toEqual([
      { type: "content", content: { type: "text", text: "late" } },
    ]);
  });
});
