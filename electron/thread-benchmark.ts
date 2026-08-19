import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { THREAD_BENCHMARK_CAPTURE_SCHEMA_VERSION } from "../contracts/benchmark.ts";
import type {
  ThreadBenchmarkIngestedTurn,
  ThreadBenchmarkMode,
  ThreadBenchmarkOpenPath,
  ThreadBenchmarkPrepared,
  ThreadBenchmarkRendererReady,
  ThreadBenchmarkReport,
  ThreadBenchmarkRun,
  ThreadBenchmarkStatus,
} from "../contracts/benchmark.ts";
import type { AgentManager } from "./agent.ts";
import { emptyMonitorRecordedSession } from "./monitor/timeline.ts";
import type { MonitorService } from "./monitor/service.ts";
import { openThreadTab, readOpenTabsState, setActiveThreadTab } from "./open-tabs.ts";
import {
  buildBenchmarkIdentity,
  buildBenchmarkInsights,
  buildBenchmarkReport,
  buildRecordingLabel,
  jobForOpenPath,
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

function assertOpenPath(openPath: ThreadBenchmarkOpenPath): ThreadBenchmarkOpenPath {
  if (
    openPath === "acp-session-load" ||
    openPath === "persisted-thread-hydrate" ||
    openPath === "live-turn-stream"
  ) {
    return openPath;
  }
  throw new Error(`Unknown benchmark open path: ${String(openPath)}`);
}

export class ThreadBenchmarkController {
  private prepared: ThreadBenchmarkPrepared | null = null;
  private run: ThreadBenchmarkRun | null = null;
  private rendererReady: ThreadBenchmarkRendererReady | null = null;
  private ingestedTurnCount = 0;

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

  async prepare(
    openPath: ThreadBenchmarkOpenPath = "acp-session-load",
  ): Promise<ThreadBenchmarkPrepared> {
    const fixturePath = this.assertEnabled();
    const resolvedPath = assertOpenPath(openPath);
    if (this.prepared) return this.reconfigure(resolvedPath);
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

    if (resolvedPath === "live-turn-stream") {
      // Leave the empty target session open. Timed work is live session/prompt
      // against this thread, not a later session/load replay.
      await manager.switchThread(target.id);
      await this.waitForThreadSettled(manager, target.id);
      const tabs = await setActiveThreadTab(target.id);
      this.options.broadcastTabs(tabs);
    } else if (resolvedPath === "acp-session-load") {
      // Evict only the target runtime. Its persisted session id remains in the
      // thread row, so the next real tab activation must execute session/load.
      await manager.closeThreadSession(target.id);
      await manager.switchThread(control.id);
      const tabs = await setActiveThreadTab(control.id);
      this.options.broadcastTabs(tabs);
    } else {
      // resident-hydrate: createThread caches an empty session/new runtime.
      // Evict it, then switch back so untimed prepare executes session/load
      // and leaves the full conversation resident for the timed click.
      await manager.closeThreadSession(target.id);
      await manager.switchThread(target.id);
      await this.waitForThreadSettled(manager, target.id);
      await manager.switchThread(control.id);
      const tabs = await setActiveThreadTab(control.id);
      this.options.broadcastTabs(tabs);
    }

    this.prepared = {
      targetThreadId: target.id,
      controlThreadId: control.id,
      targetSelector: `[data-pipper-id="thread-tab-${target.id}"]`,
      fixturePath,
      fixtureBytes: statSync(fixturePath).size,
      expectedTurnCount: parseFixtureTurns(fixturePath),
      job: jobForOpenPath(resolvedPath),
    };
    this.run = null;
    this.rendererReady = null;
    this.ingestedTurnCount = 0;
    return this.prepared;
  }

  /**
   * Reuse the existing bench threads when moving to the next job. Deleting both
   * threads left the renderer in a dirty new-thread draft, which blocked
   * Playwright on "Discard the new thread draft?".
   */
  private async reconfigure(openPath: ThreadBenchmarkOpenPath): Promise<ThreadBenchmarkPrepared> {
    const prepared = this.prepared;
    if (!prepared) throw new Error("Prepare the thread benchmark before reconfigure().");
    const manager = this.options.agentManager();
    if (openPath === "live-turn-stream") {
      const next = await this.streamReset();
      this.prepared = { ...next, job: jobForOpenPath(openPath) };
      return this.prepared;
    }
    if (openPath === "acp-session-load") {
      await manager.closeThreadSession(prepared.targetThreadId);
      await manager.switchThread(prepared.controlThreadId);
      const tabs = await setActiveThreadTab(prepared.controlThreadId);
      this.options.broadcastTabs(tabs);
    } else {
      await manager.closeThreadSession(prepared.targetThreadId);
      await manager.switchThread(prepared.targetThreadId);
      await this.waitForThreadSettled(manager, prepared.targetThreadId);
      await manager.switchThread(prepared.controlThreadId);
      const tabs = await setActiveThreadTab(prepared.controlThreadId);
      this.options.broadcastTabs(tabs);
    }
    this.prepared = { ...prepared, job: jobForOpenPath(openPath) };
    this.run = null;
    this.rendererReady = null;
    this.ingestedTurnCount = 0;
    return this.prepared;
  }

  private async waitForThreadSettled(manager: AgentManager, threadId: string): Promise<void> {
    const deadline = Date.now() + 180_000;
    while (manager.isThreadLoading(threadId)) {
      if (Date.now() > deadline) {
        throw new Error(`Benchmark prepare: target thread ${threadId} did not finish loading.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    // Let the replay's final paint settle before switching back to control so
    // nothing about the timed click inherits prepare-window work.
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  async start(
    mode: ThreadBenchmarkMode,
    openPath: ThreadBenchmarkOpenPath = "acp-session-load",
  ): Promise<ThreadBenchmarkRun> {
    this.assertEnabled();
    const prepared = this.prepared;
    if (!prepared) throw new Error("Prepare the thread benchmark before starting it.");
    if (mode !== "cold" && mode !== "warm") throw new Error(`Unknown benchmark mode: ${mode}`);
    const resolvedPath = assertOpenPath(openPath);

    const manager = this.options.agentManager();
    if (resolvedPath === "live-turn-stream") {
      if (manager.getState().threadId !== prepared.targetThreadId) {
        await manager.switchThread(prepared.targetThreadId);
      }
      const tabs = await setActiveThreadTab(prepared.targetThreadId);
      this.options.broadcastTabs(tabs);
    } else {
      if (manager.getState().threadId !== prepared.controlThreadId) {
        await manager.switchThread(prepared.controlThreadId);
      }
      const tabs = await setActiveThreadTab(prepared.controlThreadId);
      this.options.broadcastTabs(tabs);
      if (mode === "cold" && resolvedPath === "acp-session-load") {
        await manager.closeThreadSession(prepared.targetThreadId);
      }
    }

    const monitor = this.options.monitorService();
    if (this.run) await monitor?.stopRecording();
    const monitorSession = monitor
      ? await monitor.startRecording(
          buildRecordingLabel(
            mode,
            resolvedPath,
            parseFixtureTurns(prepared.fixturePath),
            prepared.fixtureBytes,
          ),
        )
      : null;
    this.rendererReady = null;
    this.ingestedTurnCount = 0;
    this.run = {
      runId: monitorSession?.id || randomUUID(),
      threadId: prepared.targetThreadId,
      mode,
      job: jobForOpenPath(resolvedPath),
      openPath: resolvedPath,
      startedAt: Date.now(),
    };
    return this.run;
  }

  async ingestTurn(): Promise<ThreadBenchmarkIngestedTurn> {
    const prepared = this.prepared;
    const run = this.run;
    if (!prepared || !run) throw new Error("Start the live-turn-stream run before ingestTurn().");
    if (run.openPath !== "live-turn-stream") {
      throw new Error("ingestTurn() is only valid for live-turn-stream.");
    }
    const manager = this.options.agentManager();
    const turnIndex = this.ingestedTurnCount;
    await manager.sendPrompt({
      threadId: prepared.targetThreadId,
      message: `benchmark prompt ${turnIndex + 1}`,
    });
    this.ingestedTurnCount += 1;
    return {
      turnIndex,
      ingestedTurnCount: this.ingestedTurnCount,
      expectedTurnCount: prepared.expectedTurnCount,
    };
  }

  async streamReset(): Promise<ThreadBenchmarkPrepared> {
    const prepared = this.prepared;
    if (!prepared) throw new Error("Prepare the thread benchmark before streamReset().");
    const projectId = this.options.projectId();
    if (!projectId) throw new Error("Benchmark mode has no active project.");
    const manager = this.options.agentManager();
    await manager.deleteThread(prepared.targetThreadId).catch(() => {});
    const target = await manager.createThread(
      projectId,
      "[Benchmark] Conversation replay",
      prepared.controlThreadId,
      "pipper-mock",
      null,
      null,
    );
    await openThreadTab(target.id);
    await manager.switchThread(target.id);
    await this.waitForThreadSettled(manager, target.id);
    const tabs = await setActiveThreadTab(target.id);
    this.options.broadcastTabs(tabs);
    this.prepared = {
      ...prepared,
      targetThreadId: target.id,
      targetSelector: `[data-pipper-id="thread-tab-${target.id}"]`,
    };
    this.run = null;
    this.rendererReady = null;
    this.ingestedTurnCount = 0;
    return this.prepared;
  }

  reportRendererReady(input: ThreadBenchmarkRendererReady): void {
    if (!this.run || input.threadId !== this.run.threadId || this.rendererReady) return;
    // Live streaming uses reportStreamReady after the last prompt, not first paint.
    if (this.run.openPath === "live-turn-stream") return;
    const manager = this.options.agentManager();
    if (manager.isThreadLoading(input.threadId) || manager.getState().threadId !== input.threadId) {
      return;
    }
    this.rendererReady = input;
  }

  reportStreamReady(input: ThreadBenchmarkRendererReady): void {
    if (!this.run || input.threadId !== this.run.threadId) return;
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
    if (
      run.openPath === "live-turn-stream" &&
      prepared.expectedTurnCount != null &&
      this.ingestedTurnCount !== prepared.expectedTurnCount
    ) {
      throw new Error(
        `live-turn-stream ingested ${this.ingestedTurnCount} turns, expected ${prepared.expectedTurnCount}.`,
      );
    }
    const state = this.options.agentManager().getState();
    const outputDir = this.options.outputDir;
    const report = buildBenchmarkReport({
      identity,
      insights,
      retainedEntries: state.entries.length,
      retainedToolCalls: Object.keys(state.toolCalls).length,
      totalRows:
        run.openPath === "live-turn-stream"
          ? state.entries.length
          : (this.rendererReady?.totalRows ?? null),
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
    this.ingestedTurnCount = 0;
  }
}
