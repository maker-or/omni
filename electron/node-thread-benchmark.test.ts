import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runNodeThreadBenchmark } from "./node-thread-benchmark.ts";

describe("node-only thread benchmark", () => {
  it("runs the real session reducer without launching Electron", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipper-node-benchmark-"));
    const fixture = join(root, "conversation-2turns-1mib.jsonl");
    const outputDir = join(root, "results");
    await writeFile(
      fixture,
      [
        {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "fixture-session",
            update: {
              sessionUpdate: "user_message_chunk",
              messageId: "user-1",
              content: { type: "text", text: "Hello" },
            },
          },
        },
        {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "fixture-session",
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-1",
              title: "Read file",
              status: "pending",
            },
          },
        },
        {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "fixture-session",
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "tool-1",
              status: "completed",
              rawOutput: { result: "ok" },
            },
          },
        },
        {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "fixture-session",
            update: {
              sessionUpdate: "agent_message_chunk",
              messageId: "assistant-1",
              content: { type: "text", text: "Done" },
            },
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n") + "\n",
      "utf8",
    );

    try {
      const result = await runNodeThreadBenchmark({ fixture, runs: 1, outputDir });
      expect(result.mode).toBe("node-only");
      expect(result.runs[0]?.updateCount).toBe(4);
      expect(result.runs[0]?.finalEntryCount).toBe(3);
      expect(result.runs[0]?.finalToolCallCount).toBe(1);
      expect(result.runs[0]?.retainedPayloadCount).toBe(1);
      expect(result.summary.medianWallMs).toBeTypeOf("number");
      expect(JSON.parse(await readFile(join(outputDir, "latest.json"))).mode).toBe("node-only");
      expect(await readFile(join(outputDir, "latest.md"), "utf8")).toContain(
        "Node-only conversation pipeline benchmark",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
