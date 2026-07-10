import { describe, expect, test, beforeEach } from "vitest";
import {
  applySessionUpdate,
  applyTurnStop,
  appendLocalUserMessage,
  assemblePromptBlocks,
  createEmptySessionSlice,
  resetMessageIdCounter,
} from "./acp-session-reducer";

describe("acp-session-reducer", () => {
  beforeEach(() => {
    resetMessageIdCounter();
  });

  test("accumulates agent message and thought chunks by messageId", () => {
    let state = createEmptySessionSlice();
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      messageId: "m1",
      content: { type: "text", text: "thinking… " },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      messageId: "m1",
      content: { type: "text", text: "Hello" },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      messageId: "m1",
      content: { type: "text", text: " world" },
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.thought).toBe("thinking… ");
    expect(state.messages[0]?.text).toBe("Hello world");
    expect(state.isStreaming).toBe(true);
    expect(state.activeMsgId).toBe("m1");
  });

  test("tool call lifecycle create and update", () => {
    let state = createEmptySessionSlice({ activeMsgId: "asst-1" });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      messageId: "asst-1",
      content: { type: "text", text: "Working" },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call",
      toolCallId: "tc1",
      title: "Read file",
      kind: "read",
      status: "pending",
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "ok" } }],
    });

    expect(state.toolCalls.tc1?.status).toBe("completed");
    expect(state.toolCalls.tc1?.title).toBe("Read file");
    expect(state.messages[0]?.toolCallIds).toContain("tc1");
  });

  test("plan, usage, commands, config options replace", () => {
    let state = createEmptySessionSlice();
    state = applySessionUpdate(state, {
      sessionUpdate: "plan",
      entries: [
        { content: "Step 1", priority: "high", status: "pending" },
        { content: "Step 2", priority: "medium", status: "in_progress" },
      ],
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "usage_update",
      used: 100,
      size: 200_000,
      cost: { amount: 0.01, currency: "USD" },
    } as never);
    state = applySessionUpdate(state, {
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "web", description: "Search" }],
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "a",
          options: [{ value: "a", name: "A" }],
        },
      ],
    } as never);

    expect(state.plan).toHaveLength(2);
    expect(state.usage?.used).toBe(100);
    expect(state.commands[0]?.name).toBe("web");
    expect(state.configOptions[0]?.id).toBe("model");
  });

  test("session_info_update sets titleChanged", () => {
    let state = createEmptySessionSlice();
    state = applySessionUpdate(state, {
      sessionUpdate: "session_info_update",
      title: "My thread",
    } as never);
    expect(state.title).toBe("My thread");
    expect(state.titleChanged).toBe(true);
  });

  test("applyTurnStop clears streaming flags", () => {
    let state = createEmptySessionSlice({
      isStreaming: true,
      activeMsgId: "m1",
      messages: [
        {
          id: "m1",
          role: "assistant",
          text: "done",
          thought: "",
          toolCallIds: [],
          streaming: true,
        },
      ],
    });
    state = applyTurnStop(state);
    expect(state.isStreaming).toBe(false);
    expect(state.activeMsgId).toBeNull();
    expect(state.messages[0]?.streaming).toBe(false);
  });

  test("appendLocalUserMessage and assemblePromptBlocks", () => {
    let state = createEmptySessionSlice();
    state = appendLocalUserMessage(state, "Hello", "u1");
    expect(state.messages[0]).toMatchObject({
      id: "u1",
      role: "user",
      text: "Hello",
    });
    expect(state.isStreaming).toBe(true);

    const blocks = assemblePromptBlocks({
      message: "Hi",
      images: [{ data: "abc", mimeType: "image/png" }],
      allowImage: true,
      resources: [{ uri: "file:///a.ts", text: "const x = 1" }],
      allowEmbeddedContext: true,
    });
    expect(blocks).toEqual([
      { type: "text", text: "Hi" },
      { type: "image", data: "abc", mimeType: "image/png" },
      {
        type: "resource",
        resource: { uri: "file:///a.ts", mimeType: undefined, text: "const x = 1" },
      },
    ]);

    const noImage = assemblePromptBlocks({
      message: "Hi",
      images: [{ data: "abc", mimeType: "image/png" }],
      allowImage: false,
    });
    expect(noImage).toEqual([{ type: "text", text: "Hi" }]);
  });

  test("user_message_chunk during session load", () => {
    let state = createEmptySessionSlice();
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      messageId: "history-user",
      content: { type: "text", text: "past message" },
    });
    expect(state.messages[0]?.role).toBe("user");
    expect(state.messages[0]?.text).toBe("past message");
    expect(state.messages[0]?.streaming).toBe(false);
  });
});
