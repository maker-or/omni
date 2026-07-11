/**
 * End-to-end pipeline test: spawn the real mock ACP agent over stdio, feed its
 * session/update notifications through the same reducer the connection manager
 * uses, then project the resulting timeline exactly like the renderer panel.
 * Verifies the full agent → reducer → projection path with a live process.
 */
import { expect, test } from "vitest";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import {
  applySessionUpdate,
  applyTurnStop,
  createEmptySessionSlice,
} from "../../src/lib/acp-session-reducer";
import { projectChatMessages } from "../../src/lib/acp-entries";

const mockAgentPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "mock-agent.mjs");

interface RpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

test("live mock agent turn renders full ordered trace through the pipeline", async () => {
  const child = spawn(process.execPath, [mockAgentPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const rl = createInterface({ input: child.stdout });

  let nextId = 1;
  const pending = new Map<number, (msg: RpcMessage) => void>();
  let slice = createEmptySessionSlice();
  const updateOrder: string[] = [];

  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("agent turn timed out")), 10_000);
    rl.on("line", (line) => {
      const msg = JSON.parse(line) as RpcMessage;
      if (msg.id != null && (msg.result || msg.error)) {
        pending.get(msg.id)?.(msg);
        pending.delete(msg.id);
        return;
      }
      if (msg.method === "session/update" && msg.params) {
        const update = msg.params.update as SessionUpdate;
        updateOrder.push(update.sessionUpdate);
        // Same call the connection manager makes per notification.
        slice = applySessionUpdate(slice, update);
      }
    });
    void (async () => {
      const request = (method: string, params: Record<string, unknown>) =>
        new Promise<RpcMessage>((res) => {
          const id = nextId++;
          pending.set(id, res);
          child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
        });

      const init = await request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      expect(init.result?.protocolVersion).toBe(1);

      const session = await request("session/new", { cwd: "/tmp", mcpServers: [] });
      const sessionId = (session.result as { sessionId: string }).sessionId;
      expect(sessionId).toBeTruthy();

      const prompt = await request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: "hello pipeline" }],
      });
      expect((prompt.result as { stopReason: string }).stopReason).toBe("end_turn");
      clearTimeout(timer);
      resolve();
    })().catch(reject);
  });

  try {
    await done;
  } finally {
    child.kill();
  }

  // The agent streamed a real turn: thought → tool_call → updates → text.
  expect(updateOrder).toContain("agent_thought_chunk");
  expect(updateOrder).toContain("tool_call");
  expect(updateOrder).toContain("agent_message_chunk");

  slice = applyTurnStop(slice);

  // Timeline preserved arrival order.
  const kinds = slice.entries.map((e) => e.type);
  expect(kinds.indexOf("agent_thought")).toBeLessThan(kinds.indexOf("tool_call"));
  expect(kinds.indexOf("tool_call")).toBeLessThan(kinds.indexOf("agent_text"));

  // Tool call resolved to completed via tool_call_update merging.
  const toolEntry = slice.entries.find((e) => e.type === "tool_call");
  expect(toolEntry).toBeTruthy();
  expect(slice.toolCalls[toolEntry!.toolCallId]?.status).toBe("completed");

  // Projection: one assistant message with thinking, tool, and text parts in order.
  const messages = projectChatMessages(slice.entries, slice.toolCalls, slice.isStreaming);
  const assistant = messages.find((m) => m.role === "assistant");
  expect(assistant).toBeTruthy();
  const partTypes = assistant!.content.map((p) => p.type);
  expect(partTypes.indexOf("thinking")).toBeLessThan(partTypes.indexOf("toolCall"));
  expect(partTypes.indexOf("toolCall")).toBeLessThan(partTypes.indexOf("text"));
  expect(assistant!.text).toContain("hello pipeline");
  const toolPart = assistant!.content.find((p) => p.type === "toolCall");
  expect(toolPart && "status" in toolPart ? toolPart.status : null).toBe("completed");
}, 15_000);
