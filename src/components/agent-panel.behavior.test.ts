import { describe, expect, test } from "vitest";
import {
  formatProviderName,
  getRuntimeStatusItems,
  groupConversationMessages,
} from "./agent-panel";
import type { AgentPanelSnapshot } from "@/store/agent-store";

function runtimeSnapshot(patch: Partial<AgentPanelSnapshot> = {}): AgentPanelSnapshot {
  return {
    projectId: "p1",
    threadId: "t1",
    agentId: "pipper-mock",
    agentSessionId: "s1",
    sessionId: "s1",
    cwd: "/tmp",
    title: null,
    model: null,
    thinkingLevel: "medium",
    isStreaming: false,
    isCompacting: false,
    isRetrying: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    messages: [],
    messageEntryRefs: [],
    streamingMessage: null,
    queue: { steering: [], followUp: [] },
    commands: [],
    models: [],
    configOptions: [],
    plan: null,
    usage: null,
    toolCalls: {},
    stats: null,
    status: {},
    workingMessage: null,
    workingVisible: false,
    hiddenThinkingLabel: null,
    editorText: "",
    authRequiredMessage: null,
    switchingAgent: false,
    ...patch,
  };
}

describe("agent-panel conversation grouping", () => {
  test("groups visible conversation messages by consecutive role", () => {
    const grouped = groupConversationMessages(
      [
        { role: "user", content: "a" },
        { role: "user", content: "b" },
        { role: "assistant", content: "c" },
      ] as never,
      null,
    );
    expect(
      grouped[0]?.messages.map((message) => (message as { content?: string }).content),
    ).toEqual(["a", "b"]);
    expect(
      grouped[1]?.messages.map((message) => (message as { content?: string }).content),
    ).toEqual(["c"]);
  });

  test("includes streaming assistant in groups when streaming", () => {
    const grouped = groupConversationMessages(
      [{ role: "user", content: "hi" }] as never,
      { role: "assistant", content: "partial" } as never,
    );
    expect(grouped.some((g) => g.isStreaming)).toBe(true);
  });

  test("runtime status surfaces auth and switching agent", () => {
    const items = getRuntimeStatusItems(
      runtimeSnapshot({
        authRequiredMessage: "Please authenticate",
        switchingAgent: true,
        isStreaming: true,
      }),
    );
    expect(items).toContain("Please authenticate");
    expect(items).toContain("Switching agent…");
  });

  test("formatProviderName title-cases providers", () => {
    expect(formatProviderName("openai-codex")).toBe("Openai Codex");
  });
});
