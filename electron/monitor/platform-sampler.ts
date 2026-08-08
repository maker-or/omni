import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";

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
}

const linuxCpuPrev = new Map<number, { utime: number; stime: number; timestamp: number }>();

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

function withSystemCpu(metrics: Omit<RawProcessMetrics, "cpuPercentOfSystem">): RawProcessMetrics {
  const systemCpuCount = Math.max(os.cpus().length, 1);
  return {
    ...metrics,
    cpuPercentOfSystem: metrics.cpuPercent / systemCpuCount,
  };
}

async function sampleLinux(pid: number): Promise<RawProcessMetrics | null> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const status = await readFile(`/proc/${pid}/status`, "utf8");

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
    let threadCount = parsePositiveInt(status.match(/^Threads:\s+(\d+)/m)?.[1], 1);
    let busyThreads = 0;
    let idleThreads = threadCount;
    let runnableThreads = 0;
    let blockedThreads = 0;
    let sleepingThreads = threadCount;

    try {
      const taskIds = await readdir(`/proc/${pid}/task`);
      const lines = await Promise.all(
        taskIds.map((taskId) =>
          readFile(`/proc/${pid}/task/${taskId}/stat`, "utf8").catch(() => ""),
        ),
      );
      const states = lines.filter(Boolean).map((line) => {
        const idx = line.indexOf(") ");
        if (idx < 0) return "";
        return (
          line
            .slice(idx + 2)
            .trim()
            .split(/\s+/)[0] ?? ""
        );
      });
      if (states.length > 0) {
        threadCount = states.length;
        busyThreads = states.filter(threadStateIsBusy).length;
        idleThreads = Math.max(threadCount - busyThreads, 0);
        runnableThreads = states.filter(
          (state) => threadStateCategory(state) === "runnable",
        ).length;
        blockedThreads = states.filter((state) => threadStateCategory(state) === "blocked").length;
        sleepingThreads = states.filter(
          (state) => threadStateCategory(state) === "sleeping",
        ).length;
      }
    } catch {
      // Fall back to aggregate thread count only.
    }

    return withSystemCpu({
      cpuPercent,
      memoryBytes: rssKb * 1024,
      threadCount,
      busyThreads,
      idleThreads,
      runnableThreads,
      blockedThreads,
      sleepingThreads,
    });
  } catch {
    linuxCpuPrev.delete(pid);
    return null;
  }
}

async function sampleDarwin(pid: number): Promise<RawProcessMetrics | null> {
  try {
    const { stdout: procOut } = await execFileAsync("ps", [
      "-p",
      String(pid),
      "-o",
      "pcpu=",
      "-o",
      "rss=",
    ]);
    const parts = procOut.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const cpuPercent = parsePositiveFloat(parts[0]);
    const memoryBytes = parsePositiveInt(parts[1]) * 1024;

    let threadCount = 1;
    let busyThreads = 0;
    let idleThreads = 1;
    let runnableThreads = 0;
    let blockedThreads = 0;
    let sleepingThreads = 1;
    try {
      const { stdout: threadOut } = await execFileAsync("ps", ["-M", "-p", String(pid)]);
      const targetPid = String(pid);
      const states: Array<{ state: string }> = [];
      for (const line of threadOut.split("\n")) {
        const tokens = line.trim().split(/\s+/);
        if (tokens.length >= 5 && tokens[1] === targetPid) {
          states.push({ state: tokens[4] ?? "" });
        }
      }
      if (states.length > 0) {
        threadCount = states.length;
        busyThreads = states.filter((entry) => threadStateIsBusy(entry.state)).length;
        idleThreads = Math.max(threadCount - busyThreads, 0);
        runnableThreads = states.filter(
          (entry) => threadStateCategory(entry.state) === "runnable",
        ).length;
        blockedThreads = states.filter(
          (entry) => threadStateCategory(entry.state) === "blocked",
        ).length;
        sleepingThreads = states.filter(
          (entry) => threadStateCategory(entry.state) === "sleeping",
        ).length;
      }
    } catch {
      // Keep the process-level values when per-thread `ps` is unavailable.
    }

    return withSystemCpu({
      cpuPercent,
      memoryBytes,
      threadCount,
      busyThreads,
      idleThreads,
      runnableThreads,
      blockedThreads,
      sleepingThreads,
    });
  } catch {
    return null;
  }
}

async function sampleGenericPs(pid: number): Promise<RawProcessMetrics | null> {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "pcpu=", "-o", "rss="]);
    const parts = stdout.trim().split(/\s+/);
    if (parts.length < 2) return null;
    return withSystemCpu({
      cpuPercent: parsePositiveFloat(parts[0]),
      memoryBytes: parsePositiveInt(parts[1]) * 1024,
      threadCount: 1,
      busyThreads: 0,
      idleThreads: 1,
      runnableThreads: 0,
      blockedThreads: 0,
      sleepingThreads: 1,
    });
  } catch {
    return null;
  }
}

export async function samplePid(pid: number): Promise<RawProcessMetrics | null> {
  if (!Number.isFinite(pid) || pid <= 0) return null;
  if (process.platform === "linux") return sampleLinux(pid);
  if (process.platform === "darwin") return sampleDarwin(pid);
  return sampleGenericPs(pid);
}
