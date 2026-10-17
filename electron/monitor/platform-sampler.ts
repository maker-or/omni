import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import type {
  MonitorProcessDescriptor,
  MonitorProcessSample,
  MonitorSampleTick,
} from "../../contracts/monitor.ts";

const execFileAsync = promisify(execFile);

export interface RawProcessMetrics {
  /** 100% means one fully occupied CPU core; values above 100% are valid. */
  cpuPercent: number;
  cpuPercentOfSystem: number;
  memoryBytes: number;
  threadCount: number;
  busyThreads: number;
  idleThreads: number;
  runnableThreads: number;
  blockedThreads: number;
  sleepingThreads: number;
  heapUsedBytes: number | null;
  heapTotalBytes: number | null;
  externalBytes: number | null;
  arrayBuffersBytes: number | null;
}

type ThreadStats = Pick<
  RawProcessMetrics,
  | "threadCount"
  | "busyThreads"
  | "idleThreads"
  | "runnableThreads"
  | "blockedThreads"
  | "sleepingThreads"
>;

export interface SampleOptions {
  /**
   * Per-thread states cost an extra subprocess (macOS) or a directory walk per
   * PID (Linux). When false, the last known thread states are reused.
   */
  threadDetail: boolean;
}

export interface SamplerStats {
  /** Subprocesses launched by the sampler since this module loaded. */
  processLaunches: number;
}

const SINGLE_THREAD: ThreadStats = {
  threadCount: 1,
  busyThreads: 0,
  idleThreads: 1,
  runnableThreads: 0,
  blockedThreads: 0,
  sleepingThreads: 1,
};

// `os.cpus()` builds a per-core array with timing data; the count is all we need.
const systemCpuCount = Math.max(os.availableParallelism?.() ?? os.cpus().length, 1);
const linuxCpuPrev = new Map<number, { utime: number; stime: number; timestamp: number }>();
const threadCache = new Map<number, ThreadStats>();
let currentProcessCpuPrev: { user: number; system: number; timestamp: number } | undefined;
let processLaunches = 0;

export function samplerStats(): SamplerStats {
  return { processLaunches };
}

function parsePositiveInt(value: string | undefined, fallback = 0): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePositiveFloat(value: string | undefined, fallback = 0): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function threadStateIsBusy(state: string): boolean {
  const normalized = state.trim().charAt(0).toUpperCase();
  return normalized === "R" || normalized === "D" || normalized === "U";
}

function threadStateCategory(state: string): "runnable" | "blocked" | "sleeping" {
  const normalized = state.trim().charAt(0).toUpperCase();
  if (normalized === "R" || normalized === "U") return "runnable";
  if (normalized === "D" || normalized === "I") return "blocked";
  return "sleeping";
}

export function threadStatsFromStates(states: string[]): ThreadStats | null {
  if (states.length === 0) return null;
  const busyThreads = states.filter(threadStateIsBusy).length;
  return {
    threadCount: states.length,
    busyThreads,
    idleThreads: Math.max(states.length - busyThreads, 0),
    runnableThreads: states.filter((state) => threadStateCategory(state) === "runnable").length,
    blockedThreads: states.filter((state) => threadStateCategory(state) === "blocked").length,
    sleepingThreads: states.filter((state) => threadStateCategory(state) === "sleeping").length,
  };
}

function withSystemCpu(metrics: Omit<RawProcessMetrics, "cpuPercentOfSystem">): RawProcessMetrics {
  return {
    ...metrics,
    cpuPercentOfSystem: metrics.cpuPercent / systemCpuCount,
  };
}

function metricsFromPs(
  pid: number,
  row: { cpuPercent: number; rssBytes: number },
): RawProcessMetrics {
  return withSystemCpu({
    cpuPercent: row.cpuPercent,
    memoryBytes: row.rssBytes,
    ...(threadCache.get(pid) ?? SINGLE_THREAD),
    heapUsedBytes: null,
    heapTotalBytes: null,
    externalBytes: null,
    arrayBuffersBytes: null,
  });
}

export function sampleCurrentProcessMetrics(): RawProcessMetrics {
  const timestamp = Date.now();
  const cpuUsage = process.cpuUsage();
  const previous = currentProcessCpuPrev;
  let cpuPercent = 0;
  if (previous) {
    const cpuDelta = Math.max(cpuUsage.user + cpuUsage.system - previous.user - previous.system, 0);
    const wallDeltaMs = Math.max(timestamp - previous.timestamp, 1);
    cpuPercent = (cpuDelta / (wallDeltaMs * 1_000)) * 100;
  }
  currentProcessCpuPrev = {
    user: cpuUsage.user,
    system: cpuUsage.system,
    timestamp,
  };
  const memory = process.memoryUsage();

  return withSystemCpu({
    cpuPercent,
    memoryBytes: memory.rss,
    // Node does not expose the OS thread count. One is safer than dropping
    // the main process entirely when macOS process inspection is unavailable.
    ...SINGLE_THREAD,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
  });
}

/** Parses `ps -o pid=,pcpu=,rss=` output (RSS in KiB). */
export function parsePsRows(stdout: string): Map<number, { cpuPercent: number; rssBytes: number }> {
  const rows = new Map<number, { cpuPercent: number; rssBytes: number }>();
  for (const line of stdout.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const pid = parsePositiveInt(parts[0], -1);
    if (pid <= 0) continue;
    rows.set(pid, {
      cpuPercent: parsePositiveFloat(parts[1]),
      rssBytes: parsePositiveInt(parts[2]) * 1024,
    });
  }
  return rows;
}

/**
 * Parses macOS `ps -M -p a,b,c`. The first line of each process carries the
 * user name; continuation lines (one per extra thread) start with blanks, so
 * their PID and STAT columns sit at different token offsets.
 */
export function parseDarwinThreadStates(stdout: string): Map<number, string[]> {
  const states = new Map<number, string[]>();
  for (const line of stdout.split("\n").slice(1)) {
    if (!line.trim()) continue;
    const tokens = line.trim().split(/\s+/);
    const continuation = /^\s/.test(line);
    const pid = parsePositiveInt(continuation ? tokens[0] : tokens[1], -1);
    const state = continuation ? tokens[2] : tokens[4];
    if (pid <= 0 || !state) continue;
    const list = states.get(pid) ?? [];
    list.push(state);
    states.set(pid, list);
  }
  return states;
}

async function runPs(args: string[]): Promise<string> {
  processLaunches += 1;
  try {
    const { stdout } = await execFileAsync("ps", args);
    return stdout;
  } catch (error) {
    // `ps -p` exits 1 when some requested PIDs are gone but still prints the rest.
    const stdout = (error as { stdout?: unknown }).stdout;
    return typeof stdout === "string" ? stdout : "";
  }
}

async function sampleWithPs(
  pids: number[],
  options: SampleOptions,
): Promise<Map<number, RawProcessMetrics>> {
  const list = pids.join(",");
  const [rowsOut, threadsOut] = await Promise.all([
    runPs(["-p", list, "-o", "pid=,pcpu=,rss="]),
    options.threadDetail && process.platform === "darwin"
      ? runPs(["-M", "-p", list])
      : Promise.resolve(null),
  ]);
  if (threadsOut != null) {
    for (const [pid, states] of parseDarwinThreadStates(threadsOut)) {
      const stats = threadStatsFromStates(states);
      if (stats) threadCache.set(pid, stats);
    }
  }
  const result = new Map<number, RawProcessMetrics>();
  for (const [pid, row] of parsePsRows(rowsOut)) result.set(pid, metricsFromPs(pid, row));
  return result;
}

async function sampleLinux(pid: number, options: SampleOptions): Promise<RawProcessMetrics | null> {
  try {
    const [stat, status] = await Promise.all([
      readFile(`/proc/${pid}/stat`, "utf8"),
      readFile(`/proc/${pid}/status`, "utf8"),
    ]);

    const afterPid = stat.indexOf(") ");
    if (afterPid < 0) return null;
    const rest = stat
      .slice(afterPid + 2)
      .trim()
      .split(/\s+/);
    const utime = parsePositiveInt(rest[11]);
    const stime = parsePositiveInt(rest[12]);
    const now = Date.now();
    const prev = linuxCpuPrev.get(pid);
    let cpuPercent = 0;
    if (prev) {
      const cpuDelta = utime + stime - (prev.utime + prev.stime);
      const wallDeltaMs = Math.max(now - prev.timestamp, 1);
      const hz = 100;
      // Do not cap this at 100: a multi-threaded process can consume several
      // cores. The UI also receives the system-normalized value.
      cpuPercent = Math.max(0, (cpuDelta / hz / (wallDeltaMs / 1000)) * 100);
    }
    linuxCpuPrev.set(pid, { utime, stime, timestamp: now });

    const rssKb = parsePositiveInt(status.match(/^VmRSS:\s+(\d+)/m)?.[1]);
    const threadCount = parsePositiveInt(status.match(/^Threads:\s+(\d+)/m)?.[1], 1);
    if (options.threadDetail) {
      try {
        const taskIds = await readdir(`/proc/${pid}/task`);
        const lines = await Promise.all(
          taskIds.map((taskId) =>
            readFile(`/proc/${pid}/task/${taskId}/stat`, "utf8").catch(() => ""),
          ),
        );
        const states = lines.filter(Boolean).map((line) => {
          const idx = line.indexOf(") ");
          return idx < 0
            ? ""
            : (line
                .slice(idx + 2)
                .trim()
                .split(/\s+/)[0] ?? "");
        });
        const stats = threadStatsFromStates(states.filter(Boolean));
        if (stats) threadCache.set(pid, stats);
      } catch {
        // Fall back to aggregate thread count only.
      }
    }
    const threads = threadCache.get(pid) ?? {
      ...SINGLE_THREAD,
      threadCount,
      idleThreads: threadCount,
      sleepingThreads: threadCount,
    };

    return withSystemCpu({
      cpuPercent,
      memoryBytes: rssKb * 1024,
      ...threads,
      // The cheap status count stays current between detailed samples.
      threadCount,
      heapUsedBytes: null,
      heapTotalBytes: null,
      externalBytes: null,
      arrayBuffersBytes: null,
    });
  } catch {
    linuxCpuPrev.delete(pid);
    return null;
  }
}

/**
 * Samples many processes at once. On macOS and other `ps` platforms this is
 * one subprocess per tick (two when thread detail is requested), independent
 * of how many PIDs are sampled.
 */
export async function sampleProcesses(
  pids: number[],
  options: SampleOptions,
): Promise<Map<number, RawProcessMetrics>> {
  const unique = [...new Set(pids.filter((pid) => Number.isSafeInteger(pid) && pid > 0))];
  let result = new Map<number, RawProcessMetrics>();
  if (unique.length > 0) {
    if (process.platform === "linux") {
      const samples = await Promise.all(unique.map((pid) => sampleLinux(pid, options)));
      unique.forEach((pid, index) => {
        const sample = samples[index];
        if (sample) result.set(pid, sample);
      });
    } else if (process.platform !== "win32") {
      // Windows has no `ps`; only the current process is sampled there.
      result = await sampleWithPs(unique, options);
    }
  }
  const alive = new Set(result.keys());
  for (const pid of threadCache.keys()) if (!alive.has(pid)) threadCache.delete(pid);
  for (const pid of linuxCpuPrev.keys()) if (!alive.has(pid)) linuxCpuPrev.delete(pid);
  if (unique.includes(process.pid) && !result.has(process.pid)) {
    result.set(process.pid, sampleCurrentProcessMetrics());
  }
  return result;
}

export async function samplePid(
  pid: number,
  options: SampleOptions = { threadDetail: true },
): Promise<RawProcessMetrics | null> {
  if (!Number.isFinite(pid) || pid <= 0) return null;
  return (await sampleProcesses([pid], options)).get(pid) ?? null;
}

export async function collectProcessTick(
  descriptors: MonitorProcessDescriptor[],
  mainPid: number,
  options: SampleOptions,
  mainProcessMetrics?: RawProcessMetrics,
): Promise<MonitorSampleTick> {
  const timestamp = Date.now();
  const uniqueByPid = new Map<number, MonitorProcessDescriptor>();
  for (const descriptor of descriptors) {
    if (!uniqueByPid.has(descriptor.pid)) uniqueByPid.set(descriptor.pid, descriptor);
  }
  // Windows has no cross-process sampler in this app. Preserve the main
  // process metric by sampling it in the parent and passing it here.
  const sampled = await sampleProcesses(
    [...uniqueByPid.keys()].filter((pid) => !(pid === mainPid && mainProcessMetrics)),
    options,
  );
  const processes: MonitorProcessSample[] = [];
  for (const [pid, descriptor] of uniqueByPid) {
    const metrics = pid === mainPid && mainProcessMetrics ? mainProcessMetrics : sampled.get(pid);
    if (!metrics) continue;
    processes.push({
      pid,
      role: descriptor.role,
      label: descriptor.label,
      agentId: descriptor.agentId,
      threadId: descriptor.threadId,
      threadIds: descriptor.threadIds ?? (descriptor.threadId ? [descriptor.threadId] : []),
      streamingThreadIds: descriptor.streamingThreadIds ?? [],
      sessionId: descriptor.sessionId,
      isStreaming: descriptor.isStreaming,
      ...metrics,
    });
  }
  processes.sort((a, b) => a.label.localeCompare(b.label));
  return { timestamp, processes };
}
