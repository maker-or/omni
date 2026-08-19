#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const RUNS = [
  {
    scale: 100,
    mode: "cold",
    dir: "benchmarks/results/scaling/100/runs/e267b457-8947-4d3d-a4e2-8034eaf80fd6",
  },
  {
    scale: 100,
    mode: "warm",
    dir: "benchmarks/results/scaling/100/runs/18b6eef7-68ee-4ca1-81b1-5b67fb83cbff",
  },
  {
    scale: 200,
    mode: "cold",
    dir: "benchmarks/results/scaling/200/runs/475938f0-9dc0-4201-a55c-fefa0aa981e0",
  },
  {
    scale: 200,
    mode: "warm",
    dir: "benchmarks/results/scaling/200/runs/936d031b-fc50-4ae1-9fcf-3372e7928b6a",
  },
  {
    scale: 300,
    mode: "cold",
    dir: "benchmarks/results/scaling/300/runs/de352839-b83e-497d-9047-f1e9e1d09067",
  },
  {
    scale: 300,
    mode: "warm",
    dir: "benchmarks/results/scaling/300/runs/0dd92c82-1615-4cbf-bd2d-327bdc4ac529",
  },
  {
    scale: 500,
    mode: "cold",
    dir: "benchmarks/results/scaling/500/runs/9a6a416b-621a-4164-8a53-8c8ca58731fd",
  },
  {
    scale: 500,
    mode: "warm",
    dir: "benchmarks/results/scaling/500/runs/c6e2899e-fb1f-4c44-9c9a-d3db145551b1",
  },
  {
    scale: 400,
    mode: "cold",
    dir: "benchmarks/results/scaling/500/runs/def164c8-3ac6-4aa8-9fb6-171c0e64a7a5",
  },
  {
    scale: 400,
    mode: "warm",
    dir: "benchmarks/results/scaling/500/runs/aa737bcd-f93b-4515-801b-125087c4944a",
  },
];

function pct(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * p) - 1));
  return s[i];
}

function mib(n) {
  return n == null ? null : Number((n / 1024 / 1024).toFixed(2));
}

function summarizeTicks(ticks, t0) {
  const byRole = {};
  const series = [];
  for (const tick of ticks) {
    const rel = tick.timestamp - t0;
    const row = { t: rel, totalMem: 0, totalCpu: 0, roles: {} };
    for (const p of tick.processes) {
      row.totalMem += p.memoryBytes;
      row.totalCpu += p.cpuPercent;
      row.roles[p.role] = {
        cpu: p.cpuPercent,
        mem: p.memoryBytes,
        heapUsed: p.heapUsedBytes,
        heapTotal: p.heapTotalBytes,
      };
      if (!byRole[p.role]) {
        byRole[p.role] = {
          n: 0,
          peakCpu: 0,
          avgCpu: 0,
          peakMem: 0,
          minMem: p.memoryBytes,
          lastMem: 0,
          firstMem: p.memoryBytes,
          peakHeap: 0,
        };
      }
      const b = byRole[p.role];
      b.n += 1;
      b.peakCpu = Math.max(b.peakCpu, p.cpuPercent);
      b.avgCpu += p.cpuPercent;
      b.peakMem = Math.max(b.peakMem, p.memoryBytes);
      b.minMem = Math.min(b.minMem, p.memoryBytes);
      b.lastMem = p.memoryBytes;
      if (p.heapUsedBytes != null) b.peakHeap = Math.max(b.peakHeap, p.heapUsedBytes);
    }
    series.push(row);
  }
  for (const b of Object.values(byRole)) b.avgCpu = b.n ? b.avgCpu / b.n : 0;

  // downsample series to ~20 points
  const step = Math.max(1, Math.floor(series.length / 20));
  const sampled = series
    .filter((_, i) => i % step === 0 || i === series.length - 1)
    .map((row) => ({
      tMs: row.t,
      totalMemMiB: mib(row.totalMem),
      totalCpu: Number(row.totalCpu.toFixed(1)),
      mainMemMiB: mib(row.roles["electron-main"]?.mem),
      mainHeapMiB: mib(row.roles["electron-main"]?.heapUsed),
      mainCpu:
        row.roles["electron-main"]?.cpu != null
          ? Number(row.roles["electron-main"].cpu.toFixed(1))
          : null,
      rendererMemMiB: mib(row.roles["electron-renderer"]?.mem),
      rendererCpu:
        row.roles["electron-renderer"]?.cpu != null
          ? Number(row.roles["electron-renderer"].cpu.toFixed(1))
          : null,
      agentMemMiB: mib(row.roles["acp-agent"]?.mem),
      agentCpu:
        row.roles["acp-agent"]?.cpu != null ? Number(row.roles["acp-agent"].cpu.toFixed(1)) : null,
      gpuCpu:
        row.roles["electron-gpu"]?.cpu != null
          ? Number(row.roles["electron-gpu"].cpu.toFixed(1))
          : null,
    }));

  return {
    tickCount: ticks.length,
    durationMs: ticks.length ? ticks[ticks.length - 1].timestamp - ticks[0].timestamp : 0,
    byRole: Object.fromEntries(
      Object.entries(byRole).map(([role, b]) => [
        role,
        {
          samples: b.n,
          peakCpu: Number(b.peakCpu.toFixed(2)),
          avgCpu: Number(b.avgCpu.toFixed(2)),
          peakMemMiB: mib(b.peakMem),
          minMemMiB: mib(b.minMem),
          lastMemMiB: mib(b.lastMem),
          growthMiB: mib(b.lastMem - b.firstMem),
          peakMainHeapMiB: mib(b.peakHeap) || undefined,
        },
      ]),
    ),
    sampled,
  };
}

function summarizeAcp(updates) {
  if (!updates.length) {
    return { count: 0 };
  }
  const durations = updates.map((u) => u.handlerDurationMs);
  const bytes = updates.map((u) => u.updateBytes);
  const snapshots = updates.map((u) => u.sessionSnapshotBytes);
  const byType = {};
  let maxHandler = updates[0];
  const topHandlers = [...updates]
    .sort((a, b) => b.handlerDurationMs - a.handlerDurationMs)
    .slice(0, 8);
  for (const u of updates) {
    if (!byType[u.updateType])
      byType[u.updateType] = { count: 0, bytes: 0, maxHandler: 0, sumHandler: 0 };
    const t = byType[u.updateType];
    t.count += 1;
    t.bytes += u.updateBytes;
    t.maxHandler = Math.max(t.maxHandler, u.handlerDurationMs);
    t.sumHandler += u.handlerDurationMs;
    if (u.handlerDurationMs > maxHandler.handlerDurationMs) maxHandler = u;
  }
  const n = updates.length;
  const buckets = 10;
  const chunk = Math.max(1, Math.floor(n / buckets));
  const phases = [];
  for (let i = 0; i < n; i += chunk) {
    const slice = updates.slice(i, Math.min(n, i + chunk));
    const hd = slice.map((u) => u.handlerDurationMs);
    phases.push({
      from: i,
      to: i + slice.length - 1,
      count: slice.length,
      p50HandlerMs: Number(pct(hd, 0.5)?.toFixed(2)),
      p95HandlerMs: Number(pct(hd, 0.95)?.toFixed(2)),
      maxHandlerMs: Number(Math.max(...hd).toFixed(2)),
      maxUpdateMiB: mib(Math.max(...slice.map((u) => u.updateBytes))),
      maxSnapshotMiB: mib(Math.max(...slice.map((u) => u.sessionSnapshotBytes))),
      avgHandlerMs: Number((hd.reduce((a, b) => a + b, 0) / hd.length).toFixed(2)),
    });
  }
  return {
    count: n,
    totalMiB: mib(bytes.reduce((a, b) => a + b, 0)),
    maxUpdateMiB: mib(Math.max(...bytes)),
    maxSnapshotMiB: mib(Math.max(...snapshots)),
    lastSnapshotMiB: mib(snapshots[snapshots.length - 1]),
    firstSnapshotMiB: mib(snapshots[0]),
    handler: {
      p50: Number(pct(durations, 0.5)?.toFixed(2)),
      p95: Number(pct(durations, 0.95)?.toFixed(2)),
      p99: Number(pct(durations, 0.99)?.toFixed(2)),
      max: Number(Math.max(...durations).toFixed(2)),
      sum: Number(durations.reduce((a, b) => a + b, 0).toFixed(1)),
      avg: Number((durations.reduce((a, b) => a + b, 0) / n).toFixed(2)),
    },
    byType: Object.fromEntries(
      Object.entries(byType).map(([k, v]) => [
        k,
        {
          count: v.count,
          miB: mib(v.bytes),
          maxHandlerMs: Number(v.maxHandler.toFixed(2)),
          avgHandlerMs: Number((v.sumHandler / v.count).toFixed(2)),
          totalHandlerMs: Number(v.sumHandler.toFixed(1)),
        },
      ]),
    ),
    slowest: topHandlers.map((u) => ({
      type: u.updateType,
      handlerMs: Number(u.handlerDurationMs.toFixed(2)),
      updateMiB: mib(u.updateBytes),
      snapshotMiB: mib(u.sessionSnapshotBytes),
      entries: u.entryCount,
      tools: u.toolCallCount,
      toolPayloadMiB: mib(u.toolPayloadBytes),
    })),
    phases,
  };
}

function summarizeRenderer(samples) {
  if (!samples.length) return { count: 0 };
  return {
    count: samples.length,
    peakJsHeapMiB: mib(Math.max(...samples.map((s) => s.jsHeapUsedBytes ?? 0))),
    peakJsHeapTotalMiB: mib(Math.max(...samples.map((s) => s.jsHeapTotalBytes ?? 0))),
    peakDom: Math.max(...samples.map((s) => s.domNodeCount ?? 0)),
    lastDom: samples[samples.length - 1].domNodeCount,
    totalLongTaskMs: samples.reduce((a, s) => a + (s.longTaskMs ?? 0), 0),
    maxLongTaskMs: Math.max(...samples.map((s) => s.longTaskMs ?? 0)),
    samples: samples.map((s) => ({
      t: s.timestamp,
      heapMiB: mib(s.jsHeapUsedBytes),
      heapTotalMiB: mib(s.jsHeapTotalBytes),
      dom: s.domNodeCount,
      longTaskMs: s.longTaskMs,
      receivedCount: s.rendererEvents?.receivedCount,
      receivedMiB: mib(s.rendererEvents?.receivedBytes ?? 0),
      applyMs: s.rendererEvents?.applyMs,
      maxApplyMs: s.rendererEvents?.maxApplyMs,
      eventToPaint: s.rendererEvents?.maxEventToPaintMs,
    })),
  };
}

function summarizeBridge(events) {
  return {
    count: events.length,
    events: events.map((e) => ({
      type: e.eventType,
      miB: mib(e.bytes),
      serializationMs: Number(e.serializationMs?.toFixed(2)),
      deliveryMs: Number(e.deliveryMs?.toFixed(2)),
      mode: e.deliveryMode,
      threadRole: e.threadRole,
    })),
    totalMiB: mib(events.reduce((a, e) => a + e.bytes, 0)),
    maxSerializeMs: events.length ? Math.max(...events.map((e) => e.serializationMs)) : 0,
    maxDeliveryMs: events.length ? Math.max(...events.map((e) => e.deliveryMs)) : 0,
  };
}

const out = [];
for (const run of RUNS) {
  const identity = JSON.parse(await readFile(join(run.dir, "identity.json"), "utf8"));
  const report = JSON.parse(await readFile(join(run.dir, "report.json"), "utf8"));
  const insights = JSON.parse(await readFile(join(run.dir, "insights.json"), "utf8"));
  const monitor = JSON.parse(await readFile(join(run.dir, "monitor.json"), "utf8"));
  const t0 = identity.startedAt;
  out.push({
    scale: run.scale,
    mode: run.mode,
    label: identity.label,
    fixtureTurns: identity.fixtureTurns,
    fixtureMiB: mib(identity.fixtureBytes),
    durationMs: insights.durationMs,
    rendererReadyMs: report.rendererReadyMs,
    switchMs: report.switchDurationMs,
    switchPhase: report.switchPhase,
    clickToPaintMs: report.clickToPaintMs,
    totalRows: report.totalRows,
    visibleRows: report.visibleRows,
    retainedEntries: report.retainedEntries,
    retainedToolCalls: report.retainedToolCalls,
    summary: monitor.summary,
    incidents: (monitor.incidents ?? insights.incidents).map((i) => ({
      kind: i.kind,
      summary: i.summary,
      t: i.timestamp - t0,
    })),
    switches: (monitor.switches ?? []).map((s) => ({
      phase: s.phase,
      durationMs: s.durationMs,
      source: s.source,
      success: s.success,
      openTabCount: s.openTabCount,
    })),
    ticks: summarizeTicks(monitor.ticks ?? [], t0),
    acp: summarizeAcp(monitor.acpUpdates ?? []),
    renderer: summarizeRenderer(monitor.rendererTelemetry ?? []),
    bridge: summarizeBridge(monitor.bridgeEvents ?? []),
  });
}

const dest = ".tmp-check/scaling-analysis.json";
await writeFile(dest, JSON.stringify(out, null, 2));
console.log("wrote", dest, "runs", out.length);
for (const r of out) {
  console.log(
    `${r.scale} ${r.mode} ready=${r.rendererReadyMs} switch=${r.switchMs} acp=${r.acp.count} acpSumHandler=${r.acp.handler?.sum} peakMem=${mib(r.summary?.peakMemoryBytes)} rendererPeak=${r.ticks.byRole["electron-renderer"]?.peakMemMiB}`,
  );
}
