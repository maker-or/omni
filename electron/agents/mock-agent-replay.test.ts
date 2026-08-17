import { describe, expect, test } from "vitest";
import { rewriteFixtureSessionId } from "./mock-agent.mjs";

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
});
