import { describe, expect, test, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/nonexistent-userdata", connect: vi.fn() },
}));

import * as acp from "@agentclientprotocol/sdk";
import { AgentConnectionManager } from "./agent-connection-manager.ts";
import { createEmptySessionSlice } from "../src/lib/acp-session-reducer.ts";
import type { AcpBridgeEvent } from "../contracts/acp.ts";

/**
 * Regression: an agent chunk that lands OUTSIDE an active prompt turn must not
 * turn the tab's working indicator back on. `applySessionUpdate` sets
 * isStreaming=true for every chunk, but only the prompt request resolving
 * clears it — a late flush (or an agent streaming background work out-of-band)
 * after end_turn would otherwise stick the loader forever with nothing left to
 * clear it. `getRunningThreadIds()` is the source of truth the renderer's tab
 * loader reads, so we assert against it.
 */
function makeManager() {
  const events: AcpBridgeEvent[] = [];
  const manager = new AgentConnectionManager({
    sendToRenderer: (event: AcpBridgeEvent) => events.push(event),
    setWindowTitle: () => {},
  });
  return { manager, events };
}

/** Inject a thread session runtime the way switchThread/createThread would. */
function seedSession(
  manager: AgentConnectionManager,
  threadId: string,
  sessionId: string,
  promptInFlight: boolean,
) {
  const sessions = (manager as unknown as { sessions: Map<string, unknown> }).sessions;
  sessions.set(threadId, {
    threadId,
    agentSessionId: sessionId,
    agentId: "agent-a",
    projectId: "proj",
    cwd: "/tmp",
    slice: createEmptySessionSlice(),
    editorText: "",
    promptInFlight,
  });
}

const chunk = (text: string): acp.SessionUpdate => ({
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text },
});

describe("turn-boundary streaming clamp", () => {
  test("a chunk during an active turn marks the thread running", async () => {
    const { manager } = makeManager();
    seedSession(manager, "t1", "s1", /* promptInFlight */ true);

    await (
      manager as unknown as {
        handleSessionUpdate: (id: string, u: acp.SessionUpdate) => Promise<void>;
      }
    ).handleSessionUpdate("s1", chunk("hello"));

    expect(manager.getRunningThreadIds()).toEqual(["t1"]);
  });

  test("a chunk after the turn ended does NOT mark the thread running", async () => {
    const { manager } = makeManager();
    // promptInFlight=false models the state after the prompt request resolved
    // (applyTurnStop already ran); a trailing/out-of-band chunk arrives now.
    seedSession(manager, "t1", "s1", /* promptInFlight */ false);

    await (
      manager as unknown as {
        handleSessionUpdate: (id: string, u: acp.SessionUpdate) => Promise<void>;
      }
    ).handleSessionUpdate("s1", chunk("trailing background output"));

    expect(manager.getRunningThreadIds()).toEqual([]);
  });
});
