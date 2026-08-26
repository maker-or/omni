import { describe, expect, test, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => process.env.PIPPER_LIBRARY_PATH ?? process.env.TMPDIR ?? "/tmp",
    connect: vi.fn(),
  },
}));

import { AgentConnectionManager } from "./agent-connection-manager.ts";
import {
  appendLocalUserMessage,
  createEmptySessionSlice,
  type AcpSessionSlice,
} from "../src/lib/acp-session-reducer.ts";
import type { AcpBridgeEvent } from "../contracts/acp.ts";
import type { SessionUpdate } from "@agentclientprotocol/sdk";

function makeManager() {
  const events: AcpBridgeEvent[] = [];
  const manager = new AgentConnectionManager({
    sendToRenderer: (event: AcpBridgeEvent) => events.push(event),
    setWindowTitle: () => {},
  });
  return { manager, events };
}

function seedSession(manager: AgentConnectionManager, threadId: string, sessionId: string) {
  const sessions = (
    manager as unknown as {
      sessions: { register: (runtime: Record<string, unknown>) => void };
      activeThreadId: string | null;
    }
  ).sessions;
  sessions.register({
    threadId,
    agentSessionId: sessionId,
    agentId: "agent-a",
    projectId: "proj",
    cwd: "/tmp",
    slice: createEmptySessionSlice(),
    editorText: "",
    promptInFlight: false,
    activeTurnId: null,
    monitorUpdateCount: 0,
    toolPayloads: new Map(),
    emittedToolCalls: null,
  });
  (manager as unknown as { activeThreadId: string | null }).activeThreadId = threadId;
}

describe("activation snapshot", () => {
  test("pushState emits session-state only, not a second tool-call copy", () => {
    const { manager, events } = makeManager();
    seedSession(manager, "t1", "s1");

    (
      manager as unknown as {
        pushState: (threadId: string) => void;
      }
    ).pushState("t1");

    expect(events.map((event) => event.type)).toEqual(["session-state"]);
    expect(events.some((event) => event.type === "thread-tool-calls")).toBe(false);
  });

  test("session slice stays lean while getToolCalls returns parked bodies", async () => {
    const { manager, events } = makeManager();
    seedSession(manager, "t1", "s1");
    const update: SessionUpdate = {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc1",
      title: "Search",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "hit" } }],
      rawOutput: { padding: "xxxx" },
    };

    await (
      manager as unknown as {
        handleSessionUpdate: (id: string, u: SessionUpdate) => Promise<void>;
      }
    ).handleSessionUpdate("s1", update);

    const sessions = (
      manager as unknown as {
        sessions: { get: (id: string) => { slice: { toolCalls: Record<string, any> } } };
      }
    ).sessions;
    const stored = sessions.get("t1")!.slice.toolCalls.tc1;
    expect(stored.content).toBeUndefined();
    expect(stored.rawOutput).toBeUndefined();
    expect(stored.hasPayload).toBe(true);
    expect(stored.outputPreview).toBe("hit");

    const streamed = events.find((event) => event.type === "session-update");
    expect(
      streamed?.type === "session-update" ? streamed.update.rawOutput : undefined,
    ).toBeUndefined();
    const leanMap = events.find((event) => event.type === "thread-tool-calls");
    expect(
      leanMap?.type === "thread-tool-calls" ? leanMap.toolCalls.tc1?.outputPreview : undefined,
    ).toBe("hit");

    const hydrated = await manager.getToolCalls("t1");
    expect(hydrated.tc1?.content).toEqual(update.content);
    expect(hydrated.tc1?.rawOutput).toEqual({ padding: "xxxx" });
  });

  test("updates follow the rebound session id after load→resume→new", async () => {
    const { manager } = makeManager();
    seedSession(manager, "t1", "stale-id");
    const sessions = (
      manager as unknown as {
        sessions: {
          rebindSession: (threadId: string, sessionId: string) => void;
          get: (id: string) => { slice: { entries: unknown[] } };
        };
      }
    ).sessions;

    // The switchThreadCore fallback chain settles on a different session id.
    sessions.rebindSession("t1", "fresh-id");

    // Streaming under the NEW id routes into the same thread's slice...
    await (
      manager as unknown as {
        handleSessionUpdate: (id: string, u: SessionUpdate) => Promise<void>;
      }
    ).handleSessionUpdate("fresh-id", {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "after rebind" },
    } as SessionUpdate);
    expect(sessions.get("t1")!.slice.entries).toHaveLength(1);

    // ...and the stale id no longer routes anywhere.
    await (
      manager as unknown as {
        handleSessionUpdate: (id: string, u: SessionUpdate) => Promise<void>;
      }
    ).handleSessionUpdate("stale-id", {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "stray" },
    } as SessionUpdate);
    expect(sessions.get("t1")!.slice.entries).toHaveLength(1);
  });

  test("session_load applies unbounded until load finishes", async () => {
    const { manager } = makeManager();
    seedSession(manager, "t1", "s1");
    const loading = (manager as unknown as { loadingSessionThreads: Set<string> })
      .loadingSessionThreads;
    loading.add("t1");

    for (let index = 0; index < 505; index += 1) {
      await (
        manager as unknown as {
          handleSessionUpdate: (id: string, u: SessionUpdate) => Promise<void>;
        }
      ).handleSessionUpdate("s1", {
        sessionUpdate: "tool_call",
        toolCallId: `tc-${index}`,
        title: "Read",
        status: "completed",
      });
    }

    const sessions = (
      manager as unknown as {
        sessions: Map<string, { slice: { toolCalls: Record<string, unknown> } }>;
      }
    ).sessions;
    expect(Object.keys(sessions.get("t1")!.slice.toolCalls).length).toBe(505);
  });

  test("snapshot replay accumulates offscreen until reconciliation", async () => {
    const { manager } = makeManager();
    seedSession(manager, "t1", "s1");
    const internal = manager as unknown as {
      sessions: {
        get: (id: string) => {
          slice: AcpSessionSlice;
          replaySlice?: AcpSessionSlice;
          replayToolPayloads?: Map<string, unknown>;
        };
      };
      loadingSessionThreads: Set<string>;
      handleSessionUpdate: (id: string, update: SessionUpdate) => Promise<void>;
    };
    const runtime = internal.sessions.get("t1")!;
    runtime.slice = appendLocalUserMessage(runtime.slice, "cached history", "cached");
    runtime.replaySlice = createEmptySessionSlice();
    runtime.replayToolPayloads = new Map();
    internal.loadingSessionThreads.add("t1");

    await internal.handleSessionUpdate("s1", {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "authoritative history" },
    });

    expect(runtime.slice.entries).toHaveLength(1);
    expect(runtime.slice.entries[0]).toMatchObject({ text: "cached history" });
    expect(runtime.replaySlice?.entries).toHaveLength(1);
    expect(runtime.replaySlice?.entries[0]).toMatchObject({ text: "authoritative history" });
  });

  test("snapshot reconciliation does not retain already-persisted tool bodies", async () => {
    const { manager } = makeManager();
    seedSession(manager, "t1", "s1");
    const internal = manager as unknown as {
      sessions: {
        get: (id: string) => {
          replaySlice?: AcpSessionSlice;
          replayToolPayloads?: Map<string, unknown>;
          snapshotPayloadSource?: {
            slice: AcpSessionSlice;
            threadId: string;
            agentSessionId: string;
            agentId: string;
            payloadPath: string;
            payloadBytes: number;
            updatedAt: number;
          };
        };
      };
      loadingSessionThreads: Set<string>;
      handleSessionUpdate: (id: string, update: SessionUpdate) => Promise<void>;
    };
    const runtime = internal.sessions.get("t1")!;
    const persistedSlice = createEmptySessionSlice({
      toolCalls: { tc1: { toolCallId: "tc1", title: "Read", hasPayload: true } },
    });
    runtime.snapshotPayloadSource = {
      threadId: "t1",
      agentSessionId: "s1",
      agentId: "agent-a",
      slice: persistedSlice,
      payloadPath: "/tmp/not-read-during-replay.gz",
      payloadBytes: 1_000_000,
      updatedAt: 1,
    };
    runtime.replaySlice = createEmptySessionSlice();
    runtime.replayToolPayloads = new Map();
    internal.loadingSessionThreads.add("t1");

    await internal.handleSessionUpdate("s1", {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc1",
      title: "Read",
      status: "completed",
      rawOutput: { body: "x".repeat(100_000) },
    } as SessionUpdate);

    expect(runtime.replaySlice.toolCalls.tc1).toMatchObject({ hasPayload: true });
    expect(runtime.replaySlice.toolCalls.tc1?.rawOutput).toBeUndefined();
    expect(runtime.replayToolPayloads?.size).toBe(0);
  });

  test("coalesces background tool-call IPC while active updates stay direct", async () => {
    const { manager, events } = makeManager();
    seedSession(manager, "active", "active-session");
    seedSession(manager, "background", "background-session");
    (manager as unknown as { activeThreadId: string | null }).activeThreadId = "active";
    const handle = (
      manager as unknown as {
        handleSessionUpdate: (id: string, update: SessionUpdate) => Promise<void>;
      }
    ).handleSessionUpdate.bind(manager);
    events.length = 0;
    vi.useFakeTimers();
    try {
      await handle("background-session", {
        sessionUpdate: "tool_call",
        toolCallId: "bg-1",
        title: "Read",
        status: "in_progress",
      });
      await handle("background-session", {
        sessionUpdate: "tool_call_update",
        toolCallId: "bg-1",
        title: "Read",
        status: "completed",
      });
      expect(events.some((event) => event.type === "session-update")).toBe(false);
      expect(events.some((event) => event.type === "thread-tool-calls")).toBe(false);

      await vi.advanceTimersByTimeAsync(100);
      expect(events.filter((event) => event.type === "thread-tool-calls")).toHaveLength(1);

      events.length = 0;
      await handle("active-session", {
        sessionUpdate: "tool_call",
        toolCallId: "active-1",
        title: "Search",
        status: "in_progress",
      });
      expect(events.some((event) => event.type === "session-update")).toBe(true);
      expect(events.some((event) => event.type === "thread-tool-calls")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("optimistic prompt entries survive authoritative replay reconciliation", () => {
    const { manager } = makeManager();
    seedSession(manager, "t1", "s1");
    const internal = manager as unknown as {
      sessions: {
        get: (id: string) => {
          pendingLocalEntries?: AcpSessionSlice["entries"];
        };
      };
      mergePendingLocalEntries: (
        runtime: { pendingLocalEntries?: AcpSessionSlice["entries"] },
        slice: AcpSessionSlice,
      ) => AcpSessionSlice;
    };
    const runtime = internal.sessions.get("t1")!;
    const replay = appendLocalUserMessage(createEmptySessionSlice(), "history", "history");
    const optimistic = appendLocalUserMessage(
      createEmptySessionSlice(),
      "send while loading",
      "pending",
    );
    runtime.pendingLocalEntries = optimistic.entries;

    const reconciled = internal.mergePendingLocalEntries(runtime, replay);

    expect(reconciled.entries.map((entry) => entry.id)).toEqual(["history", "pending"]);
    expect(reconciled.isStreaming).toBe(true);
    expect(runtime.pendingLocalEntries).toEqual([]);
  });

  test("trimmed tool calls do not leak their parked payloads", async () => {
    const { manager } = makeManager();
    seedSession(manager, "t1", "s1");

    // Exceed the 500-tool-call cap so the reducer trims the record down.
    for (let index = 0; index < 505; index += 1) {
      await (
        manager as unknown as {
          handleSessionUpdate: (id: string, u: SessionUpdate) => Promise<void>;
        }
      ).handleSessionUpdate("s1", {
        sessionUpdate: "tool_call",
        toolCallId: `tc-${index}`,
        title: "Read",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "body" } }],
      } as SessionUpdate);
    }

    const runtime = (
      manager as unknown as {
        sessions: {
          get: (id: string) => {
            slice: { toolCalls: Record<string, unknown> };
            toolPayloads?: Map<string, unknown>;
          };
        };
      }
    ).sessions.get("t1")!;

    const liveIds = Object.keys(runtime.slice.toolCalls);
    expect(liveIds.length).toBeLessThanOrEqual(500);
    // Every parked payload must belong to a live tool call — an orphan here is
    // a per-thread memory leak on long-running sessions.
    for (const payloadId of runtime.toolPayloads?.keys() ?? []) {
      expect(runtime.slice.toolCalls[payloadId as string]).toBeTruthy();
    }
  });
});
