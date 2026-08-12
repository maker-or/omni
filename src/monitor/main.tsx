import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { ThemeProvider } from "@/lib/theme";
import type {
  MonitorIncident,
  MonitorLiveSnapshot,
  MonitorProcessSample,
  MonitorSampleTick,
  MonitorRendererTelemetry,
  MonitorSession,
  MonitorSessionSummary,
} from "../../contracts/monitor.ts";

type MonitorTab = "live" | "incidents" | "sessions";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function Sparkline({ values, max }: { values: number[]; max: number }) {
  if (values.length === 0) return <div className="h-8 rounded bg-muted/40" />;
  const peak = Math.max(max, 1);
  return (
    <div className="flex h-8 items-end gap-px">
      {values.map((value, index) => (
        <div
          key={index}
          className="flex-1 rounded-sm bg-primary/70"
          style={{ height: `${Math.max(8, (value / peak) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function processKey(sample: Pick<MonitorProcessSample, "pid" | "role">): string {
  return `${sample.pid}:${sample.role}`;
}

function latestSamplesByProcess(ticks: MonitorSampleTick[]): Map<string, MonitorProcessSample> {
  const latest = new Map<string, MonitorProcessSample>();
  for (const tick of ticks) {
    for (const sample of tick.processes) {
      latest.set(processKey(sample), sample);
    }
  }
  return latest;
}

function historyForProcess(
  ticks: MonitorSampleTick[],
  key: string,
  pick: (s: MonitorProcessSample) => number,
) {
  return ticks
    .map((tick) => tick.processes.find((sample) => processKey(sample) === key))
    .filter((sample): sample is MonitorProcessSample => sample != null)
    .map(pick)
    .slice(-24);
}

function MonitorApp() {
  const [tab, setTab] = useState<MonitorTab>("live");
  const [live, setLive] = useState<MonitorLiveSnapshot | null>(null);
  const [incidents, setIncidents] = useState<MonitorIncident[]>([]);
  const [sessions, setSessions] = useState<MonitorSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionTicks, setSessionTicks] = useState<MonitorSampleTick[]>([]);
  const [sessionRendererTelemetry, setSessionRendererTelemetry] = useState<
    MonitorRendererTelemetry[]
  >([]);
  const [sessionSummary, setSessionSummary] = useState<MonitorSessionSummary | null>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    void window.omni.monitor.isEnabled().then(setEnabled);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void window.omni.monitor.getLive().then(setLive);
    void window.omni.monitor.getIncidents().then(setIncidents);
    void window.omni.monitor.getSessions().then(setSessions);

    const offLive = window.omni.monitor.onLive(setLive);
    const offTick = window.omni.monitor.onTick((tick) => {
      setLive((current) =>
        current
          ? {
              ...current,
              timestamp: tick.timestamp,
              recentTicks: [...current.recentTicks, tick].slice(-300),
            }
          : current,
      );
    });
    const offIncident = window.omni.monitor.onIncident((incident) => {
      setIncidents((current) => [incident, ...current].slice(0, 200));
    });
    return () => {
      offLive();
      offTick();
      offIncident();
    };
  }, [enabled]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionTicks([]);
      setSessionSummary(null);
      return;
    }
    void window.omni.monitor.getRecordedSession(selectedSessionId).then((payload) => {
      setSessionTicks(payload.ticks);
      setSessionRendererTelemetry(payload.rendererTelemetry);
      setSessionSummary(payload.summary);
    });
  }, [selectedSessionId]);

  const latestProcesses = useMemo(
    () => (live ? [...latestSamplesByProcess(live.recentTicks).values()] : []),
    [live],
  );

  if (!enabled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Runtime monitor is unavailable.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold">Runtime Monitor</h1>
            <p className="text-xs text-muted-foreground">
              Local dev diagnostics for CPU, memory, freezes, and ACP connections.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {live?.recording ? (
              <button
                type="button"
                className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-white"
                onClick={() =>
                  void window.omni.monitor
                    .stopRecording()
                    .then(() => window.omni.monitor.getSessions().then(setSessions))
                }
              >
                Stop recording
              </button>
            ) : (
              <button
                type="button"
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                onClick={() =>
                  void window.omni.monitor
                    .startRecording()
                    .then(() => window.omni.monitor.getSessions().then(setSessions))
                }
              >
                Start recording
              </button>
            )}
            <span
              className={`rounded-full px-2 py-1 text-[11px] ${live?.recording ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}
            >
              {live?.recording ? "REC" : "Idle"}
            </span>
          </div>
        </div>
        <nav className="mt-3 flex gap-2">
          {(["live", "incidents", "sessions"] as MonitorTab[]).map((entry) => (
            <button
              key={entry}
              type="button"
              className={`rounded-md px-3 py-1.5 text-xs capitalize ${tab === entry ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted"}`}
              onClick={() => setTab(entry)}
            >
              {entry}
            </button>
          ))}
        </nav>
      </header>

      <main className="p-4">
        {tab === "live" && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Processes</div>
                <div className="text-2xl font-semibold">{latestProcesses.length}</div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Running threads</div>
                <div className="text-2xl font-semibold">
                  {live?.aggregate.streamingThreadCount ?? 0}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Machine CPU</div>
                <div className="text-2xl font-semibold">
                  {live ? `${live.aggregate.totalCpuPercentOfSystem.toFixed(1)}%` : "—"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {live
                    ? `${live.systemCpuCount} cores · ${formatTime(live.timestamp)}`
                    : "Waiting"}
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Total memory</div>
                <div className="text-lg font-semibold">
                  {formatBytes(live?.aggregate.totalMemoryBytes ?? 0)}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">OS threads</div>
                <div className="text-lg font-semibold">
                  {live?.aggregate.osThreadCount ?? 0}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    ({live?.aggregate.busyThreads ?? 0} busy)
                  </span>
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">ACP sessions</div>
                <div className="text-lg font-semibold">
                  {live?.runningThreadIds.length ?? 0} active
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Incident history</div>
                <div className="text-lg font-semibold">{incidents.length}</div>
              </div>
            </div>

            <div className="rounded-lg border border-border p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                Renderer diagnostics
              </div>
              <div className="grid gap-3 text-xs sm:grid-cols-4">
                <div>
                  <div className="text-muted-foreground">JS heap</div>
                  <div className="font-semibold">
                    {live?.rendererTelemetry?.jsHeapUsedBytes != null
                      ? formatBytes(live.rendererTelemetry.jsHeapUsedBytes)
                      : "Unavailable"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">DOM nodes</div>
                  <div className="font-semibold">
                    {live?.rendererTelemetry?.domNodeCount?.toLocaleString() ?? "Unavailable"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Diff work / 5s</div>
                  <div className="font-semibold">
                    {live?.rendererTelemetry?.diffIngestionCount ?? 0} ingestions
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Diff time / 5s</div>
                  <div className="font-semibold">
                    {live
                      ? `${live.rendererTelemetry?.diffIngestionMs.toFixed(1) ?? "0.0"}ms`
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Long tasks / 5s</div>
                  <div className="font-semibold">
                    {live?.rendererTelemetry?.longTaskCount ?? 0} ·{" "}
                    {live?.rendererTelemetry?.longTaskMs.toFixed(1) ?? "0.0"}ms
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">GC pauses / 5s</div>
                  <div className="font-semibold">
                    {live?.rendererTelemetry?.gcPauseCount ?? 0} ·{" "}
                    {live?.rendererTelemetry?.gcPauseMs.toFixed(1) ?? "0.0"}ms
                  </div>
                </div>
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground">
                {live?.rendererTelemetry
                  ? `${live.rendererTelemetry.visibilityState} · ${live.rendererTelemetry.focused ? "focused" : "unfocused"} · ${live.rendererTelemetry.diffSerializedUtf16Bytes.toLocaleString()} serialized UTF-16 bytes / 5s`
                  : "Waiting for renderer telemetry…"}
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Process</th>
                    <th className="px-3 py-2 font-medium">CPU</th>
                    <th className="px-3 py-2 font-medium">Memory</th>
                    <th className="px-3 py-2 font-medium">Threads</th>
                    <th className="px-3 py-2 font-medium">Busy / Idle</th>
                    <th className="px-3 py-2 font-medium">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {latestProcesses.map((sample) => (
                    <tr key={processKey(sample)} className="border-t border-border/70">
                      <td className="px-3 py-2">
                        <div className="font-medium">{sample.label}</div>
                        <div className="text-[11px] text-muted-foreground">
                          pid {sample.pid}
                          {sample.agentId ? ` · ${sample.agentId}` : ""}
                          {sample.threadIds.length > 0
                            ? ` · ${sample.threadIds.length} ACP threads`
                            : ""}
                          {sample.streamingThreadIds.length > 0
                            ? ` · ${sample.streamingThreadIds.length} streaming`
                            : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div>{sample.cpuPercent.toFixed(1)}% core</div>
                        <div className="text-[11px] text-muted-foreground">
                          {sample.cpuPercentOfSystem.toFixed(1)}% machine
                        </div>
                      </td>
                      <td className="px-3 py-2">{formatBytes(sample.memoryBytes)}</td>
                      <td className="px-3 py-2">{sample.threadCount}</td>
                      <td className="px-3 py-2">
                        <div>
                          {sample.busyThreads}/{sample.idleThreads}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {sample.runnableThreads} run · {sample.blockedThreads} block
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Sparkline
                          values={historyForProcess(
                            live?.recentTicks ?? [],
                            processKey(sample),
                            (entry) => entry.cpuPercentOfSystem,
                          )}
                          max={100}
                        />
                      </td>
                    </tr>
                  ))}
                  {latestProcesses.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                        Waiting for first sample…
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "incidents" && (
          <div className="space-y-2">
            {incidents.map((incident) => (
              <details key={incident.id} className="rounded-lg border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  {formatTime(incident.timestamp)} · {incident.summary}
                </summary>
                <pre className="mt-2 overflow-auto rounded bg-muted/40 p-2 text-[11px] text-muted-foreground">
                  {JSON.stringify(incident.payload, null, 2)}
                </pre>
              </details>
            ))}
            {incidents.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No incidents recorded yet.
              </div>
            )}
          </div>
        )}

        {tab === "sessions" && (
          <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="space-y-2">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`w-full rounded-lg border px-3 py-2 text-left text-xs ${selectedSessionId === session.id ? "border-primary bg-accent" : "border-border"}`}
                  onClick={() => setSelectedSessionId(session.id)}
                >
                  <div className="font-medium">{session.label}</div>
                  <div className="text-muted-foreground">
                    {formatTime(session.startedAt)}
                    {session.endedAt ? ` → ${formatTime(session.endedAt)}` : " · recording"}
                  </div>
                </button>
              ))}
              {sessions.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
                  Record a session from the header to capture samples for replay.
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border p-3">
              {!selectedSessionId && (
                <div className="text-sm text-muted-foreground">
                  Select a session to replay samples.
                </div>
              )}
              {selectedSessionId && (
                <div className="space-y-3">
                  <div className="text-sm font-medium">
                    Replay · {sessionTicks.length} samples ·{" "}
                    {formatDuration(sessionSummary?.durationMs ?? 0)}
                  </div>
                  {sessionSummary && (
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="rounded border border-border/70 p-2 text-xs">
                        <div className="text-muted-foreground">Average machine CPU</div>
                        <div className="text-base font-semibold">
                          {sessionTicks.length > 0
                            ? `${(sessionTicks.reduce((sum, tick) => sum + tick.processes.reduce((inner, sample) => inner + sample.cpuPercentOfSystem, 0), 0) / sessionTicks.length).toFixed(1)}%`
                            : "—"}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          peak {sessionSummary.peakCpuPercentOfSystem.toFixed(1)}%
                        </div>
                      </div>
                      <div className="rounded border border-border/70 p-2 text-xs">
                        <div className="text-muted-foreground">Peak memory</div>
                        <div className="text-base font-semibold">
                          {formatBytes(sessionSummary.peakMemoryBytes)}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          peak {sessionSummary.peakBusyThreads} busy OS threads
                        </div>
                      </div>
                      <div className="rounded border border-border/70 p-2 text-xs">
                        <div className="text-muted-foreground">Evidence captured</div>
                        <div className="text-base font-semibold">
                          {sessionSummary.incidentCount} incidents
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {sessionSummary.sampleCount} one-second samples
                        </div>
                      </div>
                    </div>
                  )}
                  {sessionRendererTelemetry.length > 0 && (
                    <div className="rounded border border-border/70 p-2 text-xs">
                      <div className="font-medium">Renderer telemetry</div>
                      <div className="mt-1 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-4">
                        <span>
                          Heap peak:{" "}
                          {formatBytes(
                            Math.max(
                              0,
                              ...sessionRendererTelemetry.map(
                                (entry) => entry.jsHeapUsedBytes ?? 0,
                              ),
                            ),
                          )}
                        </span>
                        <span>
                          DOM peak:{" "}
                          {Math.max(
                            0,
                            ...sessionRendererTelemetry.map((entry) => entry.domNodeCount ?? 0),
                          ).toLocaleString()}
                        </span>
                        <span>
                          Diff ingestions:{" "}
                          {sessionRendererTelemetry.reduce(
                            (sum, entry) => sum + entry.diffIngestionCount,
                            0,
                          )}
                        </span>
                        <span>
                          Diff time:{" "}
                          {sessionRendererTelemetry
                            .reduce((sum, entry) => sum + entry.diffIngestionMs, 0)
                            .toFixed(1)}
                          ms
                        </span>
                        <span>
                          Long tasks:{" "}
                          {sessionRendererTelemetry
                            .reduce((sum, entry) => sum + entry.longTaskMs, 0)
                            .toFixed(1)}
                          ms
                        </span>
                        <span>
                          GC pauses:{" "}
                          {sessionRendererTelemetry
                            .reduce((sum, entry) => sum + entry.gcPauseMs, 0)
                            .toFixed(1)}
                          ms
                        </span>
                      </div>
                    </div>
                  )}
                  {latestSamplesByProcess(sessionTicks).size > 0 ? (
                    [...latestSamplesByProcess(sessionTicks).values()].map((sample) => (
                      <div key={processKey(sample)} className="rounded border border-border/70 p-2">
                        <div className="flex items-center justify-between gap-2 text-xs font-medium">
                          <span>{sample.label}</span>
                          <span className="font-normal text-muted-foreground">
                            {sample.threadIds.length} ACP · {sample.threadCount} OS threads
                          </span>
                        </div>
                        <Sparkline
                          values={historyForProcess(
                            sessionTicks,
                            processKey(sample),
                            (entry) => entry.cpuPercentOfSystem,
                          )}
                          max={100}
                        />
                        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                          <span>now {sample.cpuPercentOfSystem.toFixed(1)}% machine CPU</span>
                          <span>
                            {sample.busyThreads} busy / {sample.idleThreads} idle
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      No samples stored for this session.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <MonitorApp />
    </ThemeProvider>
  </StrictMode>,
);
