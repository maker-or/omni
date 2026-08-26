import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AcpToolCallState } from "../../contracts/acp.ts";
import { resetToolPayloadStore } from "../store/tool-payload-store.ts";
import { resolveToolCalls } from "./resolve-tool-calls.ts";

beforeEach(() => {
  resetToolPayloadStore();
});

describe("resolveToolCalls", () => {
  test("requests only payload ids needed by the current view", async () => {
    const calls: Record<string, AcpToolCallState> = {
      a: { toolCallId: "a", title: "Read", hasPayload: true },
      b: { toolCallId: "b", title: "Search", hasPayload: true },
    };
    const getToolCalls = vi.fn(async (_threadId: string, _ids?: string[]) => ({
      a: { ...calls.a!, rawOutput: "alpha" },
    }));
    (globalThis as any).window = { omni: { agent: { getToolCalls } } };

    const resolved = await resolveToolCalls("thread-1", calls, ["a"]);

    expect(getToolCalls).toHaveBeenCalledWith("thread-1", ["a"]);
    expect(resolved.a?.rawOutput).toBe("alpha");
    expect(resolved.b?.rawOutput).toBeUndefined();
  });

  test("does not cross the bridge when no requested call needs hydration", async () => {
    const getToolCalls = vi.fn();
    (globalThis as any).window = { omni: { agent: { getToolCalls } } };
    const calls: Record<string, AcpToolCallState> = {
      a: { toolCallId: "a", title: "Read", hasPayload: true },
      b: { toolCallId: "b", title: "Search", hasPayload: true },
    };

    await resolveToolCalls("thread-1", calls, []);

    expect(getToolCalls).not.toHaveBeenCalled();
  });
});
