import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MonitorRecordedSession } from "../contracts/monitor.ts";
import { THREAD_BENCHMARK_CAPTURE_SCHEMA_VERSION } from "../contracts/benchmark.ts";
import { emptyMonitorRecordedSession } from "./monitor/timeline.ts";
import {
  buildBenchmarkIdentity,
  buildBenchmarkInsights,
  buildBenchmarkReport,
  buildRecordingLabel,
  jobForOpenPath,
  jobTitle,
  parseFixtureTurns,
  writeBenchmarkCapture,
} from "./thread-benchmark-capture.ts";

function recordedSession(): MonitorRecordedSession {
  const monitor = emptyMonitorRecordedSession();
  monitor.ticks = [
    {
      timestamp: 1_000,
      processes: [
        {
          pid: 11,
          role: "electron-renderer",
          label: "Renderer",
          threadIds: [],
          streamingThreadIds: [],
          cpuPercent: 40,
          cpuPercentOfSystem: 5,
          memoryBytes: 80_000_000,
          threadCount: 12,
          busyThreads: 3,
          idleThreads: 9,
          runnableThreads: 2,
          blockedThreads: 1,
          sleepingThreads: 9,
          heapUsedBytes: null,
          heapTotalBytes: null,
          externalBytes: null,
          arrayBuffersBytes: null,
        },
        {
          pid: 22,
          role: "acp-agent",
          label: "pipper-mock",
          agentId: "pipper-mock",
          threadIds: ["thread-target"],
          streamingThreadIds: ["thread-target"],
          cpuPercent: 180,
          cpuPercentOfSystem: 22,
          memoryBytes: 200_000_000,
          threadCount: 8,
          busyThreads: 6,
          idleThreads: 2,
          runnableThreads: 4,
          blockedThreads: 0,
          sleepingThreads: 4,
          heapUsedBytes: null,
          heapTotalBytes: null,
          externalBytes: null,
          arrayBuffersBytes: null,
        },
      ],
    },
  ];
  monitor.rendererTelemetry = [
    {
      timestamp: 1_100,
      monotonicMs: 100,
      observerId: "renderer-1",
      visibilityState: "visible",
      focused: true,
      activeThreadId: "thread-target",
      runningThreadCount: 1,
      jsHeapUsedBytes: 30_000_000,
      jsHeapTotalBytes: 50_000_000,
      jsHeapLimitBytes: 100_000_000,
      domNodeCount: 4_200,
      domAttributions: [
        {
          id: "messages-list",
          nodeCount: 1_800,
          nodeDelta: 200,
          addedNodeCount: 210,
          removedNodeCount: 10,
          mutationCount: 4,
        },
      ],
      diffThreadCount: 1,
      diffToolCallCount: 2,
      diffFileCount: 3,
      diffIngestionCount: 1,
      diffIngestionMs: 12,
      diffSerializedUtf16Bytes: 4096,
      diffExtractedFileCount: 3,
      diffChangedFileCount: 2,
      longTaskCount: 2,
      longTaskMs: 240,
      gcPauseCount: 1,
      gcPauseMs: 18,
      rendererEvents: {
        receivedCount: 10,
        receivedBytes: 80_000,
        activeCount: 10,
        backgroundCount: 0,
        applyMs: 40,
        maxApplyMs: 12,
        ignoredCount: 0,
        bufferedCount: 1,
        coalescedCount: 2,
        droppedCount: 0,
        tabClickCount: 1,
        scrollCount: 0,
        paintCount: 3,
        eventToPaintMs: 18,
        maxEventToPaintMs: 9,
        maxEventsPerSecond: 10,
        ipcBurstCount: 1,
        maxBurstSize: 6,
        longTaskDuringBurstMs: 40,
        missedFrameDuringBurstCount: 1,
      },
    },
  ];
  monitor.acpUpdates = [
    {
      timestamp: 1_050,
      agentId: "pipper-mock",
      connectionId: "conn-1",
      sessionId: "session-1",
      threadId: "thread-target",
      threadRole: "active",
      turnId: "turn-1",
      updateType: "tool_call_update",
      updateBytes: 4_096,
      handlerDurationMs: 8,
      isStreaming: true,
      entryCount: 4,
      toolCallCount: 1,
      textBytes: 100,
      thoughtBytes: 0,
      toolPayloadBytes: 3_000,
      largestToolPayloadBytes: 3_000,
      sessionSnapshotBytes: 8_000,
    },
    {
      timestamp: 1_060,
      agentId: "pipper-mock",
      connectionId: "conn-1",
      sessionId: "session-1",
      threadId: "thread-target",
      threadRole: "active",
      turnId: "turn-1",
      updateType: "agent_message_chunk",
      updateBytes: 512,
      handlerDurationMs: 2,
      isStreaming: true,
      entryCount: 5,
      toolCallCount: 1,
      textBytes: 400,
      thoughtBytes: 0,
      toolPayloadBytes: 3_000,
      largestToolPayloadBytes: 3_000,
      sessionSnapshotBytes: 8_500,
    },
  ];
  monitor.switches = [
    {
      timestamp: 1_020,
      threadId: "thread-target",
      agentId: "pipper-mock",
      projectId: "project-1",
      source: "tab",
      phase: "session_load",
      durationMs: 1_250,
      success: true,
      openTabCount: 2,
      previousThreadId: "thread-control",
    },
  ];
  monitor.clickTimings = [
    {
      timestamp: 1_021,
      threadId: "thread-target",
      clickToHighlightPaintMs: 18,
      clickToSwitchResolvedMs: 1_260,
      switchDurationMs: 1_250,
      phase: "session_load",
      success: true,
    },
  ];
  monitor.switchTimeline.summary.sessionLoads = 1;
  monitor.switchTimeline.summary.totalSwitches = 1;
  monitor.incidents = [
    {
      id: 7,
      timestamp: 1_080,
      kind: "renderer_freeze",
      summary: "Renderer freeze episode 240ms",
      payload: {
        blockedMs: 240,
        maxBlockedMs: 240,
        sources: ["longtask"],
        visibilityState: "visible",
        activeThreadId: "thread-target",
      },
    },
  ];
  return monitor;
}

describe("thread benchmark capture", () => {
  it("parses fixture turns and builds a queryable recording label", () => {
    expect(parseFixtureTurns("/tmp/conversation-200turns-80mib.jsonl")).toBe(200);
    expect(parseFixtureTurns("/tmp/manual-fixture.jsonl")).toBeNull();
    expect(buildRecordingLabel("cold", "acp-session-load", 200, 80 * 1024 * 1024)).toBe(
      "thread-benchmark:cold:200t:80mib:acp-session-load",
    );
    expect(jobForOpenPath("acp-session-load")).toBe("native-open");
    expect(jobForOpenPath("persisted-thread-hydrate")).toBe("resident-hydrate");
    expect(jobForOpenPath("persisted-thread-snapshot")).toBe("snapshot-restore");
    expect(jobForOpenPath("live-turn-stream")).toBe("live-turn-stream");
    expect(jobTitle("native-open")).toContain("session/load");
  });

  it("derives process, switch, and freeze insights from a recorded monitor session", () => {
    const identity = buildBenchmarkIdentity({
      run: {
        runId: "run-1",
        threadId: "thread-target",
        mode: "cold",
        job: "native-open",
        openPath: "acp-session-load",
        startedAt: 1_000,
      },
      prepared: {
        targetThreadId: "thread-target",
        controlThreadId: "thread-control",
        targetSelector: '[data-pipper-id="thread-tab-thread-target"]',
        fixturePath: "/tmp/conversation-200turns-80mib.jsonl",
        fixtureBytes: 80 * 1024 * 1024,
        expectedTurnCount: 200,
        job: "native-open",
      },
      monitorSessionId: "run-1",
      finishedAt: 4_000,
    });
    expect(identity.label).toBe("thread-benchmark:cold:200t:80mib:acp-session-load");
    expect(identity.job).toBe("native-open");
    expect(identity.fixtureTurns).toBe(200);

    const insights = buildBenchmarkInsights({
      identity,
      monitor: recordedSession(),
      rendererReadyMs: 2_400,
    });
    expect(insights.durationMs).toBe(3_000);
    expect(insights.switch.phase).toBe("session_load");
    expect(insights.switch.durationMs).toBe(1_250);
    expect(insights.switch.clickToHighlightPaintMs).toBe(18);
    expect(insights.processes.find((process) => process.role === "acp-agent")?.peakCpuPercent).toBe(
      180,
    );
    expect(insights.renderer.freezeIncidentCount).toBe(1);
    expect(insights.renderer.domPeaks[0]?.id).toBe("messages-list");
    expect(insights.acp.updateCount).toBe(2);
    expect(insights.acp.byType[0]?.type).toBe("tool_call_update");
    expect(insights.incidents).toHaveLength(1);
  });

  it("writes a per-run capture that can be listed from index.json", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "pipper-bench-capture-"));
    const identity = buildBenchmarkIdentity({
      run: {
        runId: "session-abc",
        threadId: "thread-target",
        mode: "warm",
        job: "native-open",
        openPath: "acp-session-load",
        startedAt: 10,
      },
      prepared: {
        targetThreadId: "thread-target",
        controlThreadId: "thread-control",
        targetSelector: "[data-pipper-id=thread-tab-thread-target]",
        fixturePath: "/tmp/conversation-100turns-40mib.jsonl",
        fixtureBytes: 40 * 1024 * 1024,
        expectedTurnCount: 100,
        job: "native-open",
      },
      monitorSessionId: "session-abc",
      finishedAt: 20,
    });
    const monitor = recordedSession();
    const insights = buildBenchmarkInsights({
      identity,
      monitor,
      rendererReadyMs: 700,
    });
    const report = buildBenchmarkReport({
      identity,
      insights,
      retainedEntries: 12,
      retainedToolCalls: 3,
      totalRows: 12,
      visibleRows: 6,
      artifactDir: null,
    });
    const runDir = await writeBenchmarkCapture(outputDir, {
      schemaVersion: THREAD_BENCHMARK_CAPTURE_SCHEMA_VERSION,
      identity,
      report,
      monitor,
    });

    const index = JSON.parse(await readFile(join(outputDir, "index.json"), "utf8")) as {
      runs: Array<{
        runId: string;
        path: string;
        label: string;
        job: string;
        totalRows: number | null;
        visibleRows: number | null;
      }>;
    };
    const writtenInsights = JSON.parse(await readFile(join(runDir, "insights.json"), "utf8")) as {
      rendererReadyMs: number;
    };
    const writtenMonitor = JSON.parse(await readFile(join(runDir, "monitor.json"), "utf8")) as {
      acpUpdates: unknown[];
    };
    expect(index.runs).toHaveLength(1);
    expect(index.runs[0]?.runId).toBe("session-abc");
    expect(index.runs[0]?.label).toBe("thread-benchmark:warm:100t:40mib:acp-session-load");
    expect(index.runs[0]?.job).toBe("native-open");
    expect(index.runs[0]?.totalRows).toBe(12);
    expect(index.runs[0]?.visibleRows).toBe(6);
    expect(index.runs[0]?.path).toBe("runs/session-abc");
    expect(writtenInsights.rendererReadyMs).toBe(700);
    expect(writtenMonitor.acpUpdates).toHaveLength(2);
  });

  it("labels live-turn-stream as its own job", () => {
    const identity = buildBenchmarkIdentity({
      run: {
        runId: "run-stream",
        threadId: "thread-target",
        mode: "cold",
        job: "live-turn-stream",
        openPath: "live-turn-stream",
        startedAt: 1,
      },
      prepared: {
        targetThreadId: "thread-target",
        controlThreadId: "thread-control",
        targetSelector: "[data-pipper-id=thread-tab-thread-target]",
        fixturePath: "/tmp/conversation-100turns-40mib.jsonl",
        fixtureBytes: 40 * 1024 * 1024,
        expectedTurnCount: 100,
        job: "live-turn-stream",
      },
      monitorSessionId: "run-stream",
      finishedAt: 2,
    });
    expect(identity.job).toBe("live-turn-stream");
    expect(identity.label).toBe("thread-benchmark:cold:100t:40mib:live-turn-stream");
  });
});
