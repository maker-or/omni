import { describe, expect, test } from "vitest";
import type { AgentRuntimeSnapshot } from "../../contracts/agent.ts";
import {
  applyEditorBridgeEvent,
  formatModelCost,
  getEditorStatusItems,
  getMessageKey,
  isInternalCommitPrompt,
  parseComponentAnnotation,
} from "./companion-view";

function snapshot(patch: Partial<AgentRuntimeSnapshot> = {}): AgentRuntimeSnapshot {
  return {
    projectId: "project-1",
    threadId: "thread-1",
    sessionFile: null,
    sessionId: "session-1",
    sessionName: "Session",
    cwd: "/tmp/project",
    model: null,
    thinkingLevel: null,
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

describe("companion edit-mode behavior helpers", () => {
  test("parses component annotations across overlay and pasted variants", () => {
    expect(parseComponentAnnotation("[Component: hero-button]\nMake it blue")).toEqual({
      componentId: "hero-button",
      text: "Make it blue",
    });
    expect(parseComponentAnnotation("  [component: card.title]\r\n\r\nTighten spacing")).toEqual({
      componentId: "card.title",
      text: "Tighten spacing",
    });
    expect(parseComponentAnnotation("Please inspect [Component: x]\ntext")).toBeNull();
  });

  test("hides only explicitly tagged internal commit prompts", () => {
    expect(
      isInternalCommitPrompt({
        role: "user",
        content: "  [PIPPER_INTERNAL_COMMIT]\nCommit all completed changes",
      } as never),
    ).toBe(true);
    expect(
      isInternalCommitPrompt({
        role: "user",
        content: "<!-- pipper-internal-commit -->\nCommit all completed changes",
      } as never),
    ).toBe(true);
    expect(
      isInternalCommitPrompt({
        role: "user",
        content: "Please show the literal marker [PIPPER_INTERNAL_COMMIT] in docs.",
      } as never),
    ).toBe(false);
    expect(
      isInternalCommitPrompt({ role: "assistant", content: "[PIPPER_INTERNAL_COMMIT]" } as never),
    ).toBe(false);
  });

  test("derives visible editor status from observable snapshot fields", () => {
    const items = getEditorStatusItems(
      snapshot({
        isStreaming: true,
        isCompacting: true,
        isRetrying: true,
        workingVisible: true,
        workingMessage: "\u001B[32mGenerating\u001B[0m",
        status: {
          phase: "Generating",
          other: "Applying patch",
          empty: "   ",
        },
        hiddenThinkingLabel: "planning",
        editorText: `${"x".repeat(130)}`,
      }),
    );

    expect(items).toContain("Generating");
    expect(items).toContain("Applying patch");
    expect(items).toContain("Thinking: planning");
    expect(items).toContain("Compacting");
    expect(items).toContain("Retrying");
    expect(items.filter((item) => item === "Generating")).toHaveLength(1);
    expect(items.find((item) => item.startsWith("Draft: "))?.length).toBeLessThanOrEqual(127);
  });

  test("applies editor bridge events without letting notifications mutate snapshot state", () => {
    const initial = snapshot({ status: { phase: "Idle" }, editorText: "" });
    const afterStatus = applyEditorBridgeEvent(initial, {
      type: "status",
      key: "phase",
      text: "Working",
    });
    const afterDraft = applyEditorBridgeEvent(afterStatus, {
      type: "editor-text",
      text: "draft text",
    });
    const afterNotification = applyEditorBridgeEvent(afterDraft, {
      type: "notification",
      level: "warning",
      message: "Heads up",
    });

    expect(afterStatus?.status.phase).toBe("Working");
    expect(afterDraft?.editorText).toBe("draft text");
    expect(afterNotification).toBe(afterDraft);
    expect(applyEditorBridgeEvent(null, { type: "editor-text", text: "ignored" })).toBeNull();
  });

  test("formats model cost and message keys from stable identifiers", () => {
    expect(
      formatModelCost({
        provider: "openai",
        modelId: "gpt-test",
        name: "GPT Test",
        cost: { input: 0.25, output: 10, cacheRead: 0, cacheWrite: 0 },
        reasoning: true,
        contextWindow: 128000,
        maxTokens: 8192,
      }),
    ).toBe("$0.250/M in · $10.00/M out");
    expect(formatModelCost({ provider: "x", modelId: "y", name: "Y" } as never)).toBe(
      "Cost unavailable",
    );
    expect(getMessageKey({ role: "toolResult", toolCallId: "tool-1" } as never, 7)).toBe(
      "toolResult-tool-1",
    );
  });
});
