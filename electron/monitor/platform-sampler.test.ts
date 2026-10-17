import { describe, expect, it } from "vitest";
import {
  parseDarwinThreadStates,
  parsePsRows,
  samplePid,
  sampleProcesses,
  samplerStats,
  threadStatsFromStates,
} from "./platform-sampler.ts";

describe("samplePid", () => {
  it("samples the current process", async () => {
    const sample = await samplePid(process.pid);
    expect(sample).not.toBeNull();
    expect(sample!.memoryBytes).toBeGreaterThan(0);
    expect(sample!.threadCount).toBeGreaterThan(0);
  });
});

describe("batched sampling", () => {
  it("parses `ps -o pid=,pcpu=,rss=` rows", () => {
    const rows = parsePsRows("  101   2.5  2048\n 202   0.0 512\n\n garbage\n");
    expect([...rows.keys()]).toEqual([101, 202]);
    expect(rows.get(101)).toEqual({ cpuPercent: 2.5, rssBytes: 2048 * 1024 });
  });

  it("counts every thread line of `ps -M`, including continuation lines", () => {
    const output = [
      "USER               PID   TT   %CPU STAT PRI     STIME     UTIME COMMAND",
      "root                 1   ??    0.0 S    31T   0:00.32   0:00.00 /sbin/launchd",
      "                     1         3.1 R    37T   0:00.02   0:00.03 ",
      "someone           4242   ??    0.0 S    31T   0:00.00   0:00.01 /bin/zsh",
      "                  4242         0.0 U    31T   0:00.00   0:00.01 ",
      "                  4242         0.0 S    31T   0:00.00   0:00.01 ",
    ].join("\n");
    const states = parseDarwinThreadStates(output);
    expect(states.get(1)).toEqual(["S", "R"]);
    expect(states.get(4242)).toEqual(["S", "U", "S"]);
    expect(threadStatsFromStates(states.get(4242)!)).toMatchObject({
      threadCount: 3,
      busyThreads: 1,
      runnableThreads: 1,
      sleepingThreads: 2,
    });
  });

  it.runIf(process.platform === "darwin")(
    "launches one `ps` per tick for many PIDs, two with thread detail",
    async () => {
      const pids = [process.pid, process.ppid, 1];
      const before = samplerStats().processLaunches;
      const plain = await sampleProcesses(pids, { threadDetail: false });
      const afterPlain = samplerStats().processLaunches;
      await sampleProcesses(pids, { threadDetail: true });
      const afterDetail = samplerStats().processLaunches;
      expect(plain.size).toBe(3);
      expect(afterPlain - before).toBe(1);
      expect(afterDetail - afterPlain).toBe(2);
    },
  );

  it("drops PIDs that no longer exist", async () => {
    const result = await sampleProcesses([process.pid, 2 ** 22 + 12345], { threadDetail: false });
    expect(result.has(process.pid)).toBe(true);
    expect(result.size).toBe(1);
  });
});
