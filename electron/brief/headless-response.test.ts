import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { describe, expect, test } from "vitest";
import { HeadlessResponse } from "./headless-response.ts";

function chunk(text: string, messageId: string, phase?: string): SessionUpdate {
  return {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
    messageId,
    ...(phase && { _meta: { codex: { phase } } }),
  } as SessionUpdate;
}

describe("HeadlessResponse", () => {
  test("returns Codex's final answer instead of an earlier progress message", () => {
    const response = new HeadlessResponse();
    response.add(chunk('{"status":"working"}', "progress", "commentary"));
    response.add(chunk('{"headline":', "answer", "final_answer"));
    response.add(chunk('"Ship PR 42"}', "answer", "final_answer"));

    expect(response.text()).toBe('{"headline":"Ship PR 42"}');
  });

  test("uses the last agent message when the provider has no phase metadata", () => {
    const response = new HeadlessResponse();
    response.add(chunk("Progress update", "progress"));
    response.add(chunk('{"focus":', "answer"));
    response.add(chunk('"Release work"}', "answer"));

    expect(response.text()).toBe('{"focus":"Release work"}');
  });

  test("reports an empty answer when the agent sends no message", () => {
    expect(new HeadlessResponse().text()).toBe("");
  });

  test("requires Codex's final answer instead of accepting status JSON", () => {
    const response = new HeadlessResponse();
    response.add(chunk('{"status":"working"}', "progress", "commentary"));
    expect(response.text(true)).toBe("");
  });
});
