import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root: string | null = null;

afterEach(() => {
  delete process.env.PIPPER_LIBRARY_PATH;
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe("update run transcript", () => {
  test("extracts the last assistant summary from agent_end messages", async () => {
    const { extractAssistantSummaryFromAgentEnd } = await import("./update-run-transcript.ts");
    expect(
      extractAssistantSummaryFromAgentEnd({
        type: "agent_end",
        messages: [
          { role: "user", content: "update please" },
          { role: "assistant", content: [{ type: "text", text: "Applied upstream rename." }] },
        ],
      }),
    ).toBe("Applied upstream rename.");
  });

  test("appends jsonl transcript entries", async () => {
    root = mkdtempSync(join(tmpdir(), "pipper-transcript-"));
    process.env.PIPPER_LIBRARY_PATH = root;
    const { appendUpdateRunTranscript, getRunTranscriptPath } =
      await import("./update-run-transcript.ts");
    appendUpdateRunTranscript("run-1", { kind: "prompt", text: "hello" });
    appendUpdateRunTranscript("run-1", {
      kind: "bridge",
      payload: { type: "event", event: { type: "tool_execution_start", toolName: "Read" } },
    });
    const path = getRunTranscriptPath("run-1");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).kind).toBe("prompt");
    expect(JSON.parse(lines[1]!).kind).toBe("bridge");
  });
});
