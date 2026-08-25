import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createEmptySessionSlice } from "../src/lib/acp-session-reducer.ts";
import { ThreadSessionRegistry, type ThreadSessionRuntime } from "./thread-session-registry.ts";

/** Reverse-index behavior: O(1) lookup, rebind tracking, lifecycle hygiene. */

function makeRuntime(threadId: string, agentSessionId: string): ThreadSessionRuntime {
  return {
    threadId,
    agentSessionId,
    agentId: "agent-a",
    projectId: "proj",
    cwd: "/tmp",
    slice: createEmptySessionSlice(),
    editorText: "",
    promptInFlight: false,
    activeTurnId: null,
    monitorUpdateCount: 0,
    emittedToolCalls: null,
  };
}

describe("ThreadSessionRegistry", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("resolves session ids to threads without scanning", () => {
    const registry = new ThreadSessionRegistry();
    registry.register(makeRuntime("t1", "s1"));
    registry.register(makeRuntime("t2", "s2"));

    expect(registry.threadIdForSession("s1")).toBe("t1");
    expect(registry.threadIdForSession("s2")).toBe("t2");
    expect(registry.threadIdForSession("missing")).toBeNull();
    expect(registry.size).toBe(2);
  });

  test("rebind moves the index so streaming follows the NEW session id", () => {
    const registry = new ThreadSessionRegistry();
    const runtime = makeRuntime("t1", "stale-id");
    registry.register(runtime);

    // The load→resume→new fallback chain settles on a different session id.
    registry.rebindSession("t1", "fresh-id");

    expect(runtime.agentSessionId).toBe("fresh-id");
    expect(registry.threadIdForSession("fresh-id")).toBe("t1");
    expect(registry.threadIdForSession("stale-id")).toBeNull();
  });

  test("rebind to the same id is a no-op", () => {
    const registry = new ThreadSessionRegistry();
    registry.register(makeRuntime("t1", "s1"));

    registry.rebindSession("t1", "s1");

    expect(registry.threadIdForSession("s1")).toBe("t1");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("rebind displaces a colliding owner and warns", () => {
    const registry = new ThreadSessionRegistry();
    registry.register(makeRuntime("t1", "shared"));
    const t2 = makeRuntime("t2", "other");
    registry.register(t2);

    registry.rebindSession("t2", "shared");

    // Caller intent wins on explicit rebind.
    expect(registry.threadIdForSession("shared")).toBe("t2");
    expect(registry.threadIdForSession("other")).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("displaces"));
  });

  test("duplicate registration keeps the first owner of a session id", () => {
    const registry = new ThreadSessionRegistry();
    registry.register(makeRuntime("t1", "dup"));
    registry.register(makeRuntime("t2", "dup"));

    // Matches the insertion-order scan semantics this index replaced.
    expect(registry.threadIdForSession("dup")).toBe("t1");
    expect(warnSpy).toHaveBeenCalled();
  });

  test("remove cleans both the runtime and its index entry", () => {
    const registry = new ThreadSessionRegistry();
    registry.register(makeRuntime("t1", "s1"));
    registry.register(makeRuntime("t2", "s2"));

    expect(registry.remove("t1")).toBe(true);

    expect(registry.has("t1")).toBe(false);
    expect(registry.threadIdForSession("s1")).toBeNull();
    expect(registry.threadIdForSession("s2")).toBe("t2");
  });

  test("remove of an unknown thread reports nothing removed", () => {
    const registry = new ThreadSessionRegistry();
    expect(registry.remove("ghost")).toBe(false);
  });

  test("rebind for an unknown thread does not throw or index anything", () => {
    const registry = new ThreadSessionRegistry();
    registry.rebindSession("ghost", "s9");
    expect(registry.threadIdForSession("s9")).toBeNull();
  });

  test("clear empties both structures", () => {
    const registry = new ThreadSessionRegistry();
    registry.register(makeRuntime("t1", "s1"));
    registry.clear();

    expect(registry.size).toBe(0);
    expect(registry.threadIdForSession("s1")).toBeNull();
  });
});
