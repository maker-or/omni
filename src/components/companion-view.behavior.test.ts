import { describe, expect, test } from "vitest";
import type { AcpSessionState } from "../../contracts/acp.ts";
import {
  applyEditorBridgeEvent,
  deriveCompanionConversation,
  getEditorStatusItems,
  isInternalCommitPrompt,
  parseComponentAnnotation,
} from "./companion-view";

function session(patch: Partial<AcpSessionState> = {}): AcpSessionState {
  return {
    projectId: "__omni_editor__",
    threadId: "__editor__",
    agentId: "pipper-mock",
    agentSessionId: "session-editor",
    cwd: "/tmp",
    title: "Visual Editor",
    configOptions: [],
    commands: [],
    entries: [],
    toolCalls: {},
    plan: null,
    usage: null,
    currentModeId: null,
    isStreaming: false,
    isCompacting: false,
    editorText: "",
    authRequiredMessage: null,
    switchingAgent: false,
    ...patch,
  };
}

describe("companion-view ACP helpers", () => {
  test("derives status from session state fields", () => {
    const items = getEditorStatusItems(
      session({
        isStreaming: true,
        editorText: "draft code",
        authRequiredMessage: null,
      }),
    );
    expect(items.some((item) => item.includes("Streaming"))).toBe(true);
    expect(items.some((item) => item.includes("Draft"))).toBe(true);
  });

  test("applies session-state and session-update bridge events", () => {
    let state: AcpSessionState | null = session();
    state = applyEditorBridgeEvent(state, {
      type: "session-state",
      state: session({ editorText: "hello", isStreaming: true }),
    });
    expect(state?.editorText).toBe("hello");
    expect(state?.isStreaming).toBe(true);

    state = applyEditorBridgeEvent(state, {
      type: "session-update",
      sessionId: "session-editor",
      threadId: "__editor__",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "a1",
        content: { type: "text", text: "Hi" },
      },
    });
    expect(state?.entries.some((e) => e.type === "agent_text" && e.text === "Hi")).toBe(true);

    // Notifications must not wipe state
    const before = state;
    state = applyEditorBridgeEvent(state, {
      type: "notification",
      message: "note",
      level: "info",
    });
    expect(state).toEqual(before);
  });

  test("renders its model from a real ACP snapshot without reading non-contract fields", () => {
    // Regression: the companion crashed on its first snapshot with
    // "Cannot read properties of undefined (reading 'steering')" because
    // render code reached for a legacy `snapshot.queue` field that does not
    // exist on AcpSessionState. Guard by proxying the fixture so ANY read of
    // a field outside the contract throws.
    const fixture = session({
      isStreaming: true,
      entries: [
        { type: "user_text", id: "u1", text: "[Component: header]\nmake it blue" },
        { type: "agent_text", id: "a1", text: "Working on it" },
      ] as AcpSessionState["entries"],
      toolCalls: {
        t1: { toolCallId: "t1", title: "Edit src/App.tsx", status: "in_progress" },
      },
    });
    const contractKeys = new Set(Object.keys(fixture));
    const strictSnapshot = new Proxy(fixture, {
      get(target, prop, receiver) {
        if (typeof prop === "string" && !contractKeys.has(prop) && !(prop in Object.prototype)) {
          throw new Error(`companion read non-contract snapshot field: ${String(prop)}`);
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const { activeMessages, streamingMessage } = deriveCompanionConversation(strictSnapshot);
    expect(activeMessages.some((m) => m.role === "user")).toBe(true);
    expect(streamingMessage?.role).toBe("assistant");

    const items = getEditorStatusItems(strictSnapshot);
    // Streaming presentation prefers the in-flight tool call title over a
    // generic "Streaming" chip.
    expect(items).toContain("Edit src/App.tsx");
  });

  test("suppresses the streaming bubble while an accept is being committed", () => {
    const fixture = session({
      isStreaming: true,
      entries: [
        { type: "user_text", id: "u1", text: "hello" },
        { type: "agent_text", id: "a1", text: "streamed" },
      ] as AcpSessionState["entries"],
    });
    const { streamingMessage } = deriveCompanionConversation(fixture, {
      suppressStreaming: true,
    });
    expect(streamingMessage).toBeNull();
  });

  test("parseComponentAnnotation and internal commit detection", () => {
    expect(parseComponentAnnotation("[component: foo]\n\nbar")?.componentId).toBe("foo");
    expect(
      isInternalCommitPrompt({
        role: "user",
        text: "[PIPPER_INTERNAL_COMMIT] commit this",
      }),
    ).toBe(true);
  });
});
