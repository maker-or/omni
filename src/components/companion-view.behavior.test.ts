import { describe, expect, test } from "vitest";
import type { AcpSessionState } from "../../contracts/acp.ts";
import {
  applyEditorBridgeEvent,
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
