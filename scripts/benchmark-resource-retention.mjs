import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    baseline: { type: "string", default: "HEAD" },
    runs: { type: "string", default: "3" },
    output: { type: "string", default: "docs/performance/retention-comparison.json" },
  },
});
const runs = Number(values.runs);
if (!Number.isSafeInteger(runs) || runs < 1 || runs > 20) throw new Error("--runs must be 1–20");
const cwd = process.cwd();
const baseline = execFileSync("git", ["rev-parse", "--verify", `${values.baseline}^{commit}`], {
  encoding: "utf8",
}).trim();
const root = mkdtempSync(join(tmpdir(), "pipper-retention-"));
const results = {
  baselineCommit: baseline,
  capturedAt: new Date().toISOString(),
  runs: [],
  limitations:
    "Controlled retention workloads, not total Electron/agent memory or production workloads. Before/after use the same committed source fixture and fresh test workers. RSS includes allocator high-water effects; retained heap is after forced GC.",
};
try {
  const before = join(root, "before");
  mkdirSync(before);
  const archive = execFileSync("git", ["archive", baseline], { maxBuffer: 100 * 1024 * 1024 });
  const extracted = spawnSync("tar", ["-xf", "-", "-C", before], { input: archive });
  if (extracted.status !== 0)
    throw new Error(extracted.stderr?.toString() || "Could not unpack baseline");
  symlinkSync(join(cwd, "node_modules"), join(before, "node_modules"), "dir");
  cpSync(
    join(cwd, "electron/resource-retention.bench.test.ts"),
    join(before, "electron/resource-retention.bench.test.ts"),
  );
  // The original component used a plain module-level Map. Expose the same
  // cache to the harness; baseline production code is otherwise unmodified.
  writeFileSync(
    join(before, "src/lib/highlight-cache.ts"),
    "export const highlightedCodeCache = new Map<string, string>();\n",
  );
  const fixture = join(before, "electron/agent-connection-manager.ts");
  for (let run = 0; run < runs; run++) {
    for (const variant of run % 2 === 0 ? ["before", "after"] : ["after", "before"]) {
      const report = join(root, `${variant}-${run}.json`);
      const userdata = join(root, `userdata-${variant}-${run}`);
      mkdirSync(userdata);
      console.log(`Run ${run + 1}/${runs}: ${variant}`);
      const child = spawnSync(
        process.execPath,
        [
          join(cwd, "node_modules/vitest/vitest.mjs"),
          "run",
          "electron/resource-retention.bench.test.ts",
          "--maxWorkers=1",
          "--execArgv=--expose-gc",
        ],
        {
          cwd: variant === "before" ? before : cwd,
          encoding: "utf8",
          timeout: 180_000,
          maxBuffer: 8 * 1024 * 1024,
          env: {
            ...process.env,
            PIPPER_RESOURCE_BENCH: "1",
            PIPPER_RESOURCE_REPORT: report,
            PIPPER_RESOURCE_FIXTURE: fixture,
            PIPPER_RESOURCE_USERDATA: userdata,
          },
        },
      );
      if (child.status !== 0)
        throw new Error(child.error?.message || `${child.stdout}\n${child.stderr}`);
      results.runs.push({ variant, run: run + 1, ...JSON.parse(readFileSync(report, "utf8")) });
    }
  }
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  results.medians = {};
  for (const variant of ["before", "after"]) {
    const measurements = results.runs
      .filter((run) => run.variant === variant)
      .map((run) => run.measurements);
    results.medians[variant] = {
      highlightRetainedHeapBytes: median(
        measurements.map((item) => item.highlightCache.retainedHeapBytes),
      ),
      highlightElapsedMs: median(measurements.map((item) => item.highlightCache.elapsedMs)),
      subagentRetainedHeapBytes: median(
        measurements.map((item) => item.completedSubagents.retainedHeapBytes),
      ),
      hydrationRetainedHeapBytes: median(
        measurements.map((item) => item.payloadHydration.retainedHeapBytes),
      ),
      hydrationElapsedMs: median(measurements.map((item) => item.payloadHydration.elapsedMs)),
      snapshotAllocatedBytes: median(measurements.map((item) => item.snapshotDisk.allocatedBytes)),
    };
  }
  mkdirSync(dirname(resolve(values.output)), { recursive: true });
  writeFileSync(resolve(values.output), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.medians, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
