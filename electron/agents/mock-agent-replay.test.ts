import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { rewriteFixtureSessionId, splitFixtureTurns } from "./mock-agent.mjs";

function updateLine(sessionId: string, sessionUpdate: string, messageId?: string) {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: messageId
        ? { sessionUpdate, messageId, content: { type: "text", text: messageId } }
        : { sessionUpdate, toolCallId: "tool_pad", rawOutput: { padding: "xxxx" } },
    },
  });
}

describe("benchmark fixture replay", () => {
  test("rewrites sessionId without touching the update body", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session_benchmark_500_200mib",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool_fixture_size_top_up",
          rawOutput: { padding: "xxxx" },
        },
      },
    });
    const rewritten = rewriteFixtureSessionId(line, "live-session");
    const parsed = JSON.parse(rewritten);
    expect(parsed.params.sessionId).toBe("live-session");
    expect(parsed.params.update.rawOutput).toEqual({ padding: "xxxx" });
    expect(parsed.method).toBe("session/update");
  });

  test("splits fixture turns from markers and attaches padding to the last turn", () => {
    const lines = [
      JSON.stringify({ kind: "turn", index: 0, updateCount: 2 }),
      updateLine("s", "user_message_chunk", "message_user_0"),
      updateLine("s", "agent_message_chunk", "message_assistant_0"),
      JSON.stringify({ kind: "turn", index: 1, updateCount: 1 }),
      updateLine("s", "user_message_chunk", "message_user_1"),
      updateLine("s", "tool_call_update"),
    ];
    const turns = splitFixtureTurns(lines);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toHaveLength(2);
    expect(turns[1]).toHaveLength(2);
  });

  test("splits fixture turns from user_message_chunk boundaries when markers are absent", () => {
    const lines = [
      updateLine("s", "user_message_chunk", "message_user_0"),
      updateLine("s", "agent_message_chunk", "message_assistant_0"),
      updateLine("s", "user_message_chunk", "message_user_1"),
      updateLine("s", "agent_message_chunk", "message_assistant_1"),
      updateLine("s", "tool_call_update"),
    ];
    const turns = splitFixtureTurns(lines);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toHaveLength(2);
    expect(turns[1]).toHaveLength(3);
  });

  test("session/prompt replays the next fixture turn when PIPPER_BENCHMARK_FIXTURE is set", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipper-mock-fixture-"));
    const fixture = join(root, "conversation-2turns-1mib.jsonl");
    await writeFile(
      fixture,
      [
        JSON.stringify({ kind: "turn", index: 0, updateCount: 1 }),
        updateLine("fixture-session", "user_message_chunk", "message_user_0"),
        JSON.stringify({ kind: "turn", index: 1, updateCount: 1 }),
        updateLine("fixture-session", "user_message_chunk", "message_user_1"),
        "",
      ].join("\n"),
      "utf8",
    );
    const mockAgentPath = fileURLToPath(new URL("./mock-agent.mjs", import.meta.url));
    const child = spawn(process.execPath, [mockAgentPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PIPPER_BENCHMARK_FIXTURE: fixture },
    });
    const rl = createInterface({ input: child.stdout });
    let nextId = 1;
    const pending = new Map<number, (msg: Record<string, unknown>) => void>();
    const updates: string[] = [];
    const request = (method: string, params: Record<string, unknown>) =>
      new Promise<Record<string, unknown>>((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("fixture prompt timed out")), 10_000);
      rl.on("line", (line) => {
        const msg = JSON.parse(line) as Record<string, unknown>;
        if (msg.id != null && (msg.result || msg.error)) {
          pending.get(msg.id as number)?.(msg);
          pending.delete(msg.id as number);
          return;
        }
        if (msg.method === "session/update") {
          const params = msg.params as { update?: { messageId?: string } };
          if (params.update?.messageId) updates.push(params.update.messageId);
        }
      });
      void (async () => {
        await request("initialize", { protocolVersion: 1, clientCapabilities: {} });
        const session = await request("session/new", { cwd: "/tmp", mcpServers: [] });
        const sessionId = (session.result as { sessionId: string }).sessionId;
        const first = await request("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: "one" }],
        });
        const second = await request("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: "two" }],
        });
        expect((first.result as { stopReason: string }).stopReason).toBe("end_turn");
        expect((second.result as { stopReason: string }).stopReason).toBe("end_turn");
        clearTimeout(timer);
        resolve();
      })().catch(reject);
    });
    try {
      await done;
    } finally {
      child.kill();
    }
    expect(updates).toEqual(["message_user_0", "message_user_1"]);
  }, 15_000);
});
