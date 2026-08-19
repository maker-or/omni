#!/usr/bin/env bun

import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { basename, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import {
  applySessionUpdateInPlace,
  applyTurnStop,
  createEmptySessionSlice,
  type AcpSessionSlice,
} from "../src/lib/acp-session-reducer.ts";
import {
  mergeToolCallPayload,
  payloadFromSessionUpdate,
  type ToolCallPayload,
} from "../src/lib/tool-call-payload.ts";

interface NodeBenchmarkOptions {
  fixture: string;
  runs: number;
  outputDir: string;
}

interface MemoryPeak {
  rssBytes: number;
  heapUsedBytes: number;
  externalBytes: number;
}

export interface NodeThreadBenchmarkRun {
  run: number;
  mode: "node-only";
  fixture: string;
  fixtureBytes: number;
  wallMs: number;
  parseMs: number;
  reduceMs: number;
  updateCount: number;
  updateBytes: number;
  nonUpdateLineCount: number;
  maxUpdateBytes: number;
  updateTypes: Array<{ type: string; count: number; bytes: number }>;
  finalEntryCount: number;
  finalToolCallCount: number;
  retainedPayloadCount: number;
  peakMemory: MemoryPeak;
}

export interface NodeThreadBenchmarkResult {
  schemaVersion: 1;
  mode: "node-only";
  generatedAt: string;
  fixture: string;
  fixtureBytes: number;
  runs: NodeThreadBenchmarkRun[];
  summary: {
    runs: number;
    medianWallMs: number | null;
    p95WallMs: number | null;
    medianParseMs: number | null;
    medianReduceMs: number | null;
    peakRssBytes: number;
    peakHeapUsedBytes: number;
    finalEntryCount: number | null;
    finalToolCallCount: number | null;
  };
}

function parseArgs(argv: string[]): NodeBenchmarkOptions & { help?: boolean } {
  const options: NodeBenchmarkOptions = {
    fixture: "",
    runs: 3,
    outputDir: resolve("benchmarks/results/node"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixture") options.fixture = resolve(argv[++index] ?? "");
    else if (arg === "--runs") options.runs = Number(argv[++index]);
    else if (arg === "--output-dir") options.outputDir = resolve(argv[++index] ?? "");
    else if (arg === "--help" || arg === "-h") return { ...options, help: true };
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.fixture) throw new Error("--fixture is required");
  if (!Number.isInteger(options.runs) || options.runs <= 0) {
    throw new Error("--runs must be a positive integer");
  }
  return options;
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}

function sampleMemory(peak: MemoryPeak): void {
  const memory = process.memoryUsage();
  peak.rssBytes = Math.max(peak.rssBytes, memory.rss);
  peak.heapUsedBytes = Math.max(peak.heapUsedBytes, memory.heapUsed);
  peak.externalBytes = Math.max(peak.externalBytes, memory.external);
}

function updateTypeSummary(
  byType: Map<string, { type: string; count: number; bytes: number }>,
  type: string,
  bytes: number,
): void {
  const current = byType.get(type) ?? { type, count: 0, bytes: 0 };
  current.count += 1;
  current.bytes += bytes;
  byType.set(type, current);
}

async function runFixture(
  fixture: string,
  fixtureBytes: number,
  run: number,
): Promise<NodeThreadBenchmarkRun> {
  const startedAt = performance.now();
  const state: AcpSessionSlice = createEmptySessionSlice();
  const payloads = new Map<string, ToolCallPayload>();
  const updateTypes = new Map<string, { type: string; count: number; bytes: number }>();
  const peakMemory: MemoryPeak = { rssBytes: 0, heapUsedBytes: 0, externalBytes: 0 };
  let parseMs = 0;
  let reduceMs = 0;
  let updateCount = 0;
  let updateBytes = 0;
  let nonUpdateLineCount = 0;
  let maxUpdateBytes = 0;
  let lineNumber = 0;

  const input = createReadStream(fixture, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;
    const lineBytes = Buffer.byteLength(line) + 1;
    const parseStartedAt = performance.now();
    let message: { method?: string; params?: { update?: SessionUpdate } };
    try {
      message = JSON.parse(line) as typeof message;
    } catch (error) {
      throw new Error(
        `Invalid JSON in ${basename(fixture)} at line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    parseMs += performance.now() - parseStartedAt;

    if (message.method !== "session/update" || !message.params?.update) {
      nonUpdateLineCount += 1;
      continue;
    }

    const update = message.params.update;
    const reduceStartedAt = performance.now();
    applySessionUpdateInPlace(state, update);
    const payload = payloadFromSessionUpdate(update);
    if (payload) {
      payloads.set(
        payload.toolCallId,
        mergeToolCallPayload(payloads.get(payload.toolCallId), payload.payload),
      );
    }
    reduceMs += performance.now() - reduceStartedAt;

    updateCount += 1;
    updateBytes += lineBytes;
    maxUpdateBytes = Math.max(maxUpdateBytes, lineBytes);
    updateTypeSummary(updateTypes, update.sessionUpdate, lineBytes);
    if (updateCount === 1 || updateCount % 128 === 0) sampleMemory(peakMemory);
  }

  const finalizeStartedAt = performance.now();
  applyTurnStop(state);
  reduceMs += performance.now() - finalizeStartedAt;
  sampleMemory(peakMemory);

  return {
    run,
    mode: "node-only",
    fixture,
    fixtureBytes,
    wallMs: performance.now() - startedAt,
    parseMs,
    reduceMs,
    updateCount,
    updateBytes,
    nonUpdateLineCount,
    maxUpdateBytes,
    updateTypes: [...updateTypes.values()].sort((left, right) => right.bytes - left.bytes),
    finalEntryCount: state.entries.length,
    finalToolCallCount: Object.keys(state.toolCalls).length,
    retainedPayloadCount: payloads.size,
    peakMemory,
  };
}

function summarize(runs: NodeThreadBenchmarkRun[]): NodeThreadBenchmarkResult["summary"] {
  return {
    runs: runs.length,
    medianWallMs: percentile(
      runs.map((run) => run.wallMs),
      0.5,
    ),
    p95WallMs: percentile(
      runs.map((run) => run.wallMs),
      0.95,
    ),
    medianParseMs: percentile(
      runs.map((run) => run.parseMs),
      0.5,
    ),
    medianReduceMs: percentile(
      runs.map((run) => run.reduceMs),
      0.5,
    ),
    peakRssBytes: Math.max(0, ...runs.map((run) => run.peakMemory.rssBytes)),
    peakHeapUsedBytes: Math.max(0, ...runs.map((run) => run.peakMemory.heapUsedBytes)),
    finalEntryCount: runs.at(-1)?.finalEntryCount ?? null,
    finalToolCallCount: runs.at(-1)?.finalToolCallCount ?? null,
  };
}

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

function markdown(result: NodeThreadBenchmarkResult): string {
  const lines = [
    "# Node-only conversation pipeline benchmark",
    "",
    `Fixture: \`${basename(result.fixture)}\` (${formatMiB(result.fixtureBytes)})`,
    "",
    "This benchmark does not launch Electron or Chromium. It reads the ACP fixture and runs the real session reducer and tool-payload retention path.",
    "",
    "| Run | Wall | JSON parse | State reduction | Updates | Entries | Tools | Peak RSS |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const run of result.runs) {
    lines.push(
      `| ${run.run} | ${run.wallMs.toFixed(1)} ms | ${run.parseMs.toFixed(1)} ms | ${run.reduceMs.toFixed(1)} ms | ${run.updateCount} | ${run.finalEntryCount} | ${run.finalToolCallCount} | ${formatMiB(run.peakMemory.rssBytes)} |`,
    );
  }
  lines.push(
    "",
    `Median wall time: **${result.summary.medianWallMs?.toFixed(1) ?? "n/a"} ms**`,
    `Median reducer time: **${result.summary.medianReduceMs?.toFixed(1) ?? "n/a"} ms**`,
    `Peak RSS: **${formatMiB(result.summary.peakRssBytes)}**`,
    "",
    "The wall time includes fixture streaming and scheduling. Parse and reducer timings are accumulated CPU sections and do not necessarily add up to wall time.",
    "",
  );
  return lines.join("\n");
}

export async function runNodeThreadBenchmark(
  options: NodeBenchmarkOptions,
): Promise<NodeThreadBenchmarkResult> {
  const fixtureBytes = (await stat(options.fixture)).size;
  await mkdir(options.outputDir, { recursive: true });
  const runs: NodeThreadBenchmarkRun[] = [];
  for (let run = 1; run <= options.runs; run += 1) {
    const result = await runFixture(options.fixture, fixtureBytes, run);
    runs.push(result);
    console.log(
      `node-only run ${run}/${options.runs}: ${result.wallMs.toFixed(1)} ms, ${result.updateCount} updates, ${(result.updateBytes / 1024 ** 2).toFixed(1)} MiB, ${result.finalEntryCount} entries`,
    );
  }

  const result: NodeThreadBenchmarkResult = {
    schemaVersion: 1,
    mode: "node-only",
    generatedAt: new Date().toISOString(),
    fixture: options.fixture,
    fixtureBytes,
    runs,
    summary: summarize(runs),
  };
  await writeFile(
    `${options.outputDir}/latest.json`,
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  await writeFile(`${options.outputDir}/latest.md`, `${markdown(result)}\n`, "utf8");
  console.log(`wrote ${options.outputDir}/latest.json`);
  console.log(`wrote ${options.outputDir}/latest.md`);
  return result;
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      [
        "Node-only conversation pipeline benchmark.",
        "",
        "Usage:",
        "  bun electron/node-thread-benchmark.ts --fixture <path> [--runs 3] [--output-dir <path>]",
      ].join("\n"),
    );
  } else {
    await runNodeThreadBenchmark(options);
  }
}
