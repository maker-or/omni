import { describe, expect, test, beforeEach } from "vitest";
import {
  applySessionUpdate,
  applyTurnStop,
  appendLocalUserMessage,
  assemblePromptBlocks,
  createEmptySessionSlice,
  resetEntryIdCounter,
} from "./acp-session-reducer";

describe("acp-session-reducer", () => {
  beforeEach(() => {
    resetEntryIdCounter();
  });

  test("accumulates agent message and thought chunks into tail entries", () => {
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

    expect(state.entries).toHaveLength(2);
    expect(state.entries[0]).toMatchObject({ type: "agent_thought", text: "thinking… " });
    expect(state.entries[1]).toMatchObject({ type: "agent_text", text: "Hello world" });
    expect(state.isStreaming).toBe(true);
  });

  test("chunks without a messageId accumulate into the tail entry", () => {
    // Standard ACP streaming updates carry no messageId; consecutive chunks of
    // one kind must stay a single segment instead of fragmenting.
    let state = createEmptySessionSlice();
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Here is " },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "the answer." },
    });

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({ type: "agent_text", text: "Here is the answer." });
  });

  test("a changed messageId starts a new message per ACP spec", () => {
    let state = createEmptySessionSlice();
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      messageId: "m1",
      content: { type: "text", text: "first" },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      messageId: "m2",
      content: { type: "text", text: "second" },
    });

    expect(state.entries).toHaveLength(2);
    expect(state.entries[0]).toMatchObject({ text: "first", messageId: "m1" });
    expect(state.entries[1]).toMatchObject({ text: "second", messageId: "m2" });
  });

  test("tool call lifecycle: entry appended once, record updated in place", () => {
    let state = createEmptySessionSlice();
    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call",
      toolCallId: "tc1",
      title: "Read file",
      kind: "read",
      status: "pending",
    });
    const entriesAfterCall = state.entries;
    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "ok" } }],
    });

    expect(state.toolCalls.tc1?.status).toBe("completed");
    expect(state.toolCalls.tc1?.title).toBe("Read file");
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({ type: "tool_call", toolCallId: "tc1" });
    // tool_call_update must not touch the entry list (identity preserved).
    expect(state.entries).toBe(entriesAfterCall);
  });

  test("duplicate tool_call_update is a no-op and preserves record identity", () => {
    let state = createEmptySessionSlice();
    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call",
      toolCallId: "tc1",
      title: "Read file",
      kind: "read",
      status: "pending",
    });
    const content = [{ type: "content" as const, content: { type: "text" as const, text: "ok" } }];
    const completeUpdate = {
      sessionUpdate: "tool_call_update" as const,
      toolCallId: "tc1",
      status: "completed" as const,
      content,
    };
    state = applySessionUpdate(state, completeUpdate);
    const settledToolCall = state.toolCalls.tc1;

    // Applying the exact same update again (e.g. a redelivered event) must not
    // allocate a new record or regress the status.
    state = applySessionUpdate(state, completeUpdate);

    expect(state.toolCalls.tc1).toBe(settledToolCall);
    expect(state.toolCalls.tc1?.status).toBe("completed");
  });

  test("a redelivered initial tool_call does not reset a completed status", () => {
    let state = createEmptySessionSlice();
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
    });

    // The bridge/IPC layer redelivers the original tool_call announcement.
    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call",
      toolCallId: "tc1",
      title: "Read file",
      kind: "read",
    });

    expect(state.toolCalls.tc1?.status).toBe("completed");
  });

  test("tool_call_update for an unknown id still gets a timeline entry", () => {
    let state = createEmptySessionSlice();
    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call_update",
      toolCallId: "ghost",
      status: "completed",
    });

    expect(state.toolCalls.ghost?.status).toBe("completed");
    expect(state.entries.some((e) => e.type === "tool_call" && e.toolCallId === "ghost")).toBe(
      true,
    );
  });

  test("interleaving order is preserved: text → tool → text", () => {
    let state = createEmptySessionSlice();
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Let me check. " },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call",
      toolCallId: "tc1",
      title: "Read file",
      status: "completed",
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Found it." },
    });

    expect(state.entries.map((e) => e.type)).toEqual(["agent_text", "tool_call", "agent_text"]);
    expect(state.entries[0]).toMatchObject({ text: "Let me check. " });
    expect(state.entries[2]).toMatchObject({ text: "Found it." });
  });

  test("settled entries keep referential identity while streaming", () => {
    let state = createEmptySessionSlice();
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "plan" },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call",
      toolCallId: "tc1",
      title: "Read",
      status: "in_progress",
    });
    const settledThought = state.entries[0];
    const settledTool = state.entries[1];
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "streaming tail…" },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: " more" },
    });

    expect(state.entries[0]).toBe(settledThought);
    expect(state.entries[1]).toBe(settledTool);
  });

  test("user_message_chunk without messageId stays one bubble per chunk", () => {
    // Replayed history commonly arrives as one id-less chunk per historical
    // user message; they must not merge into a single bubble.
    let state = createEmptySessionSlice();
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "first question" },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "second question" },
    });

    expect(state.entries).toHaveLength(2);
    expect(state.entries.every((e) => e.type === "user_text")).toBe(true);
  });

  test("user_message_chunk with matching messageId merges", () => {
    let state = createEmptySessionSlice();
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      messageId: "u1",
      content: { type: "text", text: "hello " },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      messageId: "u1",
      content: { type: "text", text: "world" },
    });

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({ type: "user_text", text: "hello world" });
  });

  test("an agent that echoes the prompt does not duplicate the optimistic user bubble", () => {
    // Grok emits a user_message_chunk echoing the just-sent prompt. We already
    // show an optimistic local user bubble on send, so the echo must reconcile
    // into it rather than append a second identical bubble.
    let state = createEmptySessionSlice();
    state = appendLocalUserMessage(state, "can i get access to other model");
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "can i get access to other model" },
    });

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({
      type: "user_text",
      text: "can i get access to other model",
    });
    // Agent reply still lands as its own entry afterwards.
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Sure — here are the options." },
    });
    expect(state.entries).toHaveLength(2);
    expect(state.entries[1]).toMatchObject({ type: "agent_text" });
  });

  test("plan, usage, commands, config options replace", () => {
    let state = createEmptySessionSlice();
    state = applySessionUpdate(state, {
      sessionUpdate: "plan",
      entries: [
        { content: "step 1", priority: "high", status: "completed" },
        { content: "step 2", priority: "low", status: "pending" },
      ],
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "usage_update",
      used: 100,
      size: 200000,
    } as never);
    state = applySessionUpdate(state, {
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "web", description: "search", input: null }],
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "gpt-x",
          options: [{ value: "gpt-x", name: "GPT X" }],
        } as never,
      ],
    });

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

  test("applyTurnStop clears streaming", () => {
    let state = createEmptySessionSlice({
      isStreaming: true,
      entries: [{ type: "agent_text", id: "e1", messageId: null, text: "done" }],
    });
    state = applyTurnStop(state);
    expect(state.isStreaming).toBe(false);
    expect(state.entries).toHaveLength(1);
  });

  test("appendLocalUserMessage and assemblePromptBlocks", () => {
    let state = createEmptySessionSlice();
    state = appendLocalUserMessage(state, "Hello", "u1");
    expect(state.entries[0]).toMatchObject({
      type: "user_text",
      id: "u1",
      text: "Hello",
    });
    expect(state.isStreaming).toBe(true);

    const blocks = assemblePromptBlocks({
      message: "look at this",
      images: [{ data: "aGk=", mimeType: "image/png" }],
      resources: [{ uri: "file:///tmp/a.ts", name: "a.ts", text: "const a = 1;" }],
      allowImage: true,
      allowEmbeddedContext: true,
    });
    expect(blocks[0]).toMatchObject({ type: "text", text: "look at this" });
    expect(blocks[1]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(blocks[2]).toMatchObject({ type: "resource" });
  });

  test("user_message_chunk during session load", () => {
    let state = createEmptySessionSlice();
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      messageId: "u-1",
      content: { type: "text", text: "restored question" },
    });
    expect(state.entries[0]).toMatchObject({
      type: "user_text",
      text: "restored question",
    });
    // Restored user chunks must not flip the session into a streaming state.
    expect(state.isStreaming).toBe(false);
  });
});
