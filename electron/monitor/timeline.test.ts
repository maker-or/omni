import { describe, expect, it } from "vitest";
import { buildSwitchTimeline } from "./timeline.ts";

describe("buildSwitchTimeline", () => {
  it("annotates switches with the nearest prior open-tab count", () => {
    const timeline = buildSwitchTimeline(
      [
        {
          timestamp: 10,
          action: "open",
          threadId: "a",
          openTabCount: 2,
          activeThreadId: "a",
        },
      ],
      [
        {
          timestamp: 20,
          threadId: "b",
          agentId: "pipper-mock",
          projectId: "p",
          source: "tab",
          phase: "session_load",
          durationMs: 400,
          success: true,
          openTabCount: 2,
          previousThreadId: "a",
        },
      ],
      [
        {
          timestamp: 21,
          threadId: "b",
          clickToHighlightPaintMs: 12,
          clickToSwitchResolvedMs: 410,
          switchDurationMs: 400,
          phase: "session_load",
          success: true,
        },
      ],
    );
    expect(timeline.summary.sessionLoads).toBe(1);
    expect(timeline.summary.switchesAfterTabChange).toBe(1);
    const switchRow = timeline.rows.find((row) => row.kind === "switch");
    expect(switchRow?.openTabCount).toBe(2);
  });
});
