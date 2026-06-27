import { describe, expect, test } from "vitest";
import type { AgentRuntimeSnapshot } from "../../contracts/agent.ts";
import {
  buildConversationScrollKey,
  getMessageStructureKey,
  getRuntimeStatusItems,
  groupConversationMessages,
} from "./agent-panel";
import type { MessageLike } from "@/lib/message-utils";

function runtimeSnapshot(patch: Partial<AgentRuntimeSnapshot> = {}): AgentRuntimeSnapshot {
  return {
    projectId: "project-1",
    threadId: "thread-1",
    sessionFile: null,
    sessionId: "session-1",
    sessionName: "Session",
    cwd: "/tmp/project",
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
    stats: null,
    status: {},
    workingMessage: null,
    workingVisible: false,
    hiddenThinkingLabel: null,
    title: null,
    editorText: "",
    ...patch,
  } as AgentRuntimeSnapshot;
}

const user = (content: unknown): MessageLike => ({ role: "user", content }) as never;
const assistant = (content: unknown): MessageLike => ({ role: "assistant", content }) as never;
const toolResult = (toolCallId: string): MessageLike =>
  ({ role: "toolResult", toolCallId, content: "ok" }) as never;

describe("agent panel behavior helpers", () => {
  test("groups visible conversation messages by consecutive role and keeps original edit index", () => {
    const grouped = groupConversationMessages(
      [user("first user"), user("second user"), toolResult("tool-1"), assistant("assistant text")],
      assistant("streaming continuation"),
    );

    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({
      key: "user-0",
      role: "user",
      originalIndex: 0,
      isStreaming: false,
    });
    expect(grouped[0]?.messages.map((message) => message.content)).toEqual([
      "first user",
      "second user",
    ]);
    expect(grouped[1]).toMatchObject({
      key: "assistant-3",
      role: "assistant",
      originalIndex: 3,
      isStreaming: true,
    });
    expect(grouped[1]?.messages.map((message) => message.content)).toEqual([
      "assistant text",
      "streaming continuation",
    ]);
  });

  test("scroll key changes for trace-only structural changes with identical visible text", () => {
    const base = assistant([
      { type: "text", text: "Done" },
      { type: "toolCall", id: "tool-a", name: "bash", arguments: { command: "pwd" } },
    ]);
    const changedTool = assistant([
      { type: "text", text: "Done" },
      { type: "toolCall", id: "tool-b", name: "bash", arguments: { command: "pwd" } },
    ]);

    expect(getMessageStructureKey(base)).not.toBe(getMessageStructureKey(changedTool));
    expect(
      buildConversationScrollKey("thread-1", groupConversationMessages([base], null), false),
    ).not.toBe(
      buildConversationScrollKey("thread-1", groupConversationMessages([changedTool], null), false),
    );
  });

  test("runtime status items reflect title, draft, hidden thinking, and background flags", () => {
    const items = getRuntimeStatusItems(
      runtimeSnapshot({
        title: "Edited title",
        sessionName: "Session",
        workingVisible: true,
        workingMessage: "\u001B[33mApplying\u001B[0m",
        status: { phase: "Applying", detail: "Testing" },
        hiddenThinkingLabel: "reasoning",
        editorText: "queued draft",
        isStreaming: true,
        isCompacting: true,
        isRetrying: true,
        autoCompactionEnabled: false,
        autoRetryEnabled: false,
      }),
    );

    expect(items).toEqual([
      "Title: Edited title",
      "Applying",
      "Testing",
      "Thinking: reasoning",
      "Draft: queued draft",
      "Compacting",
      "Retrying",
      "Auto-compaction off",
      "Auto-retry off",
    ]);
  });

  test("runtime status omits hidden thinking when the agent is not streaming", () => {
    expect(
      getRuntimeStatusItems(
        runtimeSnapshot({
          hiddenThinkingLabel: "reasoning",
          isStreaming: false,
        }),
      ),
    ).not.toContain("Thinking: reasoning");
  });
});
