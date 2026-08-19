import { describe, expect, test, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => process.env.PIPPER_LIBRARY_PATH ?? process.env.TMPDIR ?? "/tmp",
    connect: vi.fn(),
  },
}));

import { AgentConnectionManager } from "./agent-connection-manager.ts";
import { createEmptySessionSlice } from "../src/lib/acp-session-reducer.ts";
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
      sessions: Map<string, Record<string, unknown>>;
      activeThreadId: string | null;
    }
  ).sessions;
  sessions.set(threadId, {
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
    const { manager } = makeManager();
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
      manager as unknown as { sessions: Map<string, { slice: { toolCalls: Record<string, any> } }> }
    ).sessions;
    const stored = sessions.get("t1")!.slice.toolCalls.tc1;
    expect(stored.content).toBeUndefined();
    expect(stored.rawOutput).toBeUndefined();
    expect(stored.hasPayload).toBe(true);
    expect(stored.outputPreview).toBe("hit");

    const hydrated = manager.getToolCalls("t1");
    expect(hydrated.tc1?.content).toEqual(update.content);
    expect(hydrated.tc1?.rawOutput).toEqual({ padding: "xxxx" });
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
});
