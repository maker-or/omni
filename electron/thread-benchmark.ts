import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { THREAD_BENCHMARK_CAPTURE_SCHEMA_VERSION } from "../contracts/benchmark.ts";
import type {
  ThreadBenchmarkMode,
  ThreadBenchmarkPrepared,
  ThreadBenchmarkRendererReady,
  ThreadBenchmarkReport,
  ThreadBenchmarkRun,
  ThreadBenchmarkStatus,
} from "../contracts/benchmark.ts";
import type { AgentManager } from "./agent.ts";
import { emptyMonitorRecordedSession } from "./monitor/timeline.ts";
import type { MonitorService } from "./monitor/service.ts";
import {
  openThreadTab,
  readOpenTabsState,
  setActiveThreadTab,
} from "./open-tabs.ts";
import {
  buildBenchmarkIdentity,
  buildBenchmarkInsights,
  buildBenchmarkReport,
  buildRecordingLabel,
  parseFixtureTurns,
  writeBenchmarkCapture,
} from "./thread-benchmark-capture.ts";

const MONITOR_TRAILING_SAMPLE_MS = 1200;

interface ThreadBenchmarkControllerOptions {
  enabled: boolean;
  fixturePath: string | null;
  outputDir: string | null;
  projectId: () => string | null;
  agentManager: () => AgentManager;
  monitorService: () => MonitorService | null;
  broadcastTabs: (state: Awaited<ReturnType<typeof readOpenTabsState>>) => void;
}

export class ThreadBenchmarkController {
  private prepared: ThreadBenchmarkPrepared | null = null;
  private run: ThreadBenchmarkRun | null = null;
  private rendererReady: ThreadBenchmarkRendererReady | null = null;

  constructor(private readonly options: ThreadBenchmarkControllerOptions) {}

  status(): ThreadBenchmarkStatus {
    return {
      enabled: this.options.enabled,
      prepared: this.prepared,
      run: this.run,
      rendererReady: this.rendererReady,
    };
  }

  private assertEnabled(): string {
    if (!this.options.enabled) {
      throw new Error("Thread benchmarking is disabled. Set PIPPER_BENCHMARK_MODE=1.");
    }
    const fixturePath = this.options.fixturePath;
    if (!fixturePath) throw new Error("PIPPER_BENCHMARK_FIXTURE is not configured.");
    statSync(fixturePath);
    return fixturePath;
  }

  async prepare(): Promise<ThreadBenchmarkPrepared> {
    const fixturePath = this.assertEnabled();
    if (this.prepared) await this.cleanup();
    const projectId = this.options.projectId();
    if (!projectId) throw new Error("Benchmark mode has no active project.");

    const manager = this.options.agentManager();
    const control = await manager.createThread(
      projectId,
      "[Benchmark] Control",
      null,
      "pipper-mock",
      null,
      null,
    );
    const target = await manager.createThread(
      projectId,
      "[Benchmark] Conversation replay",
      control.id,
      "pipper-mock",
      null,
      null,
    );
    await openThreadTab(control.id);
    await openThreadTab(target.id);

    // Evict only the target runtime. Its persisted session id remains in the
    // thread row, so the next real tab activation must execute session/load.
    await manager.closeThreadSession(target.id);
    await manager.switchThread(control.id);
    const tabs = await setActiveThreadTab(control.id);
    this.options.broadcastTabs(tabs);

    this.prepared = {
      targetThreadId: target.id,
      controlThreadId: control.id,
      targetSelector: `[data-pipper-id="thread-tab-${target.id}"]`,
      fixturePath,
      fixtureBytes: statSync(fixturePath).size,
    };
    this.run = null;
    this.rendererReady = null;
    return this.prepared;
  }

  async start(mode: ThreadBenchmarkMode): Promise<ThreadBenchmarkRun> {
    this.assertEnabled();
    const prepared = this.prepared;
    if (!prepared) throw new Error("Prepare the thread benchmark before starting it.");
    if (mode !== "cold" && mode !== "warm") throw new Error(`Unknown benchmark mode: ${mode}`);

    const manager = this.options.agentManager();
    if (manager.getState().threadId !== prepared.controlThreadId) {
      await manager.switchThread(prepared.controlThreadId);
    }
    const tabs = await setActiveThreadTab(prepared.controlThreadId);
    this.options.broadcastTabs(tabs);
    if (mode === "cold") await manager.closeThreadSession(prepared.targetThreadId);

    const monitor = this.options.monitorService();
    if (this.run) await monitor?.stopRecording();
    const monitorSession = monitor
      ? await monitor.startRecording(
          buildRecordingLabel(mode, parseFixtureTurns(prepared.fixturePath), prepared.fixtureBytes),
        )
      : null;
    this.rendererReady = null;
    this.run = {
      runId: monitorSession?.id || randomUUID(),
      threadId: prepared.targetThreadId,
      mode,
      startedAt: Date.now(),
    };
    return this.run;
  }

  reportRendererReady(input: ThreadBenchmarkRendererReady): void {
    if (!this.run || input.threadId !== this.run.threadId || this.rendererReady) return;
    const manager = this.options.agentManager();
    if (manager.isThreadLoading(input.threadId) || manager.getState().threadId !== input.threadId) {
      return;
    }
    this.rendererReady = input;
  }

  async finish(): Promise<ThreadBenchmarkReport> {
    const prepared = this.prepared;
    const run = this.run;
    if (!prepared || !run) throw new Error("No thread benchmark is running.");
    const monitor = this.options.monitorService();
    let recorded = emptyMonitorRecordedSession();
    let session: Awaited<ReturnType<MonitorService["stopRecording"]>> = null;
    if (monitor) {
      // Keep the recording open long enough for one process tick after ready.
      // rendererReadyMs is still computed from the first settled paint, not this soak.
      await new Promise((resolve) => setTimeout(resolve, MONITOR_TRAILING_SAMPLE_MS));
      session = await monitor.stopRecording();
      if (session) recorded = await monitor.getRecordedSession(session.id);
    }
    const finishedAt = Date.now();
    const identity = buildBenchmarkIdentity({
      run,
      prepared,
      monitorSessionId: session?.id ?? run.runId,
      finishedAt,
    });
    const insights = buildBenchmarkInsights({
      identity,
      monitor: recorded,
      rendererReadyMs: this.rendererReady
        ? Math.max(0, this.rendererReady.renderedAt - run.startedAt)
        : null,
    });
    const state = this.options.agentManager().getState();
    const outputDir = this.options.outputDir;
    const report = buildBenchmarkReport({
      identity,
      insights,
      retainedEntries: state.entries.length,
      retainedToolCalls: Object.keys(state.toolCalls).length,
      totalRows: this.rendererReady?.totalRows ?? null,
      visibleRows: this.rendererReady?.visibleRows ?? null,
      artifactDir: outputDir,
    });
    if (outputDir) {
      const captureDir = await writeBenchmarkCapture(outputDir, {
        schemaVersion: THREAD_BENCHMARK_CAPTURE_SCHEMA_VERSION,
        identity,
        report: { ...report, artifactDir: null },
        monitor: recorded,
      });
      report.artifactDir = captureDir;
    }
    this.run = null;
    return report;
  }

  async cleanup(): Promise<void> {
    if (this.run) {
      await this.options.monitorService()?.stopRecording();
      this.run = null;
    }
    const prepared = this.prepared;
    if (!prepared) return;
    const manager = this.options.agentManager();
    await manager.deleteThread(prepared.targetThreadId).catch(() => {});
    await manager.deleteThread(prepared.controlThreadId).catch(() => {});
    this.prepared = null;
    this.rendererReady = null;
  }
}
