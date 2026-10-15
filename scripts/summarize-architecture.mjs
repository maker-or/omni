import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(process.argv[2] ?? "docs/architecture");
const workflows = JSON.parse(readFileSync(resolve(root, "workflow-measurements.json"), "utf8"));
const components = JSON.parse(readFileSync(resolve(root, "component-measurements.json"), "utf8"));
const inventory = JSON.parse(readFileSync(resolve(root, "module-map.json"), "utf8"));
const median = (values) => {
  const a = [...values].sort((x, y) => x - y);
  const i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
};
const fmt = (n) => n.toFixed(2);
const range = (values) => `${fmt(Math.min(...values))}–${fmt(Math.max(...values))}`;
const count = (r, stage, name, detail) =>
  r.totals
    .filter(
      (x) => x.stage === stage && x.name === name && (detail === undefined || x.detail === detail),
    )
    .reduce((s, x) => s + x.calls, 0);
const lines = [
  "# Measured architecture costs",
  "",
  `Captured: ${workflows.capturedAt}. ${workflows.runs.length} fresh instrumented Electron processes on ${workflows.platform}/${workflows.arch}; ${workflows.node}. The current working tree includes earlier resource fixes.`,
  "",
  "[Interpretation and limitations](README.md#evidence-and-coverage). Values below are observations, not performance promises. No production refactor was benchmarked against these measurements.",
  "",
  "## Thread and workspace requests",
  "",
  "Wall-clock time around the Playwright-driven renderer IPC request or explicitly named manager call. Tiny local Git project, local mock CLI, no dependencies/network. Cold means a new **provider process**, not a cold OS page cache. Resident switching is ten alternating requests, reported both as a batch and average per switch. The renderer-store-create row includes its `refresh`; other create rows call preload directly. Full draft attachment/list-refresh work and first paint are excluded.",
  "",
  "| Scenario | Median ms | Observed range ms |",
  "| --- | ---: | ---: |",
];
for (const name of workflows.runs[0].stages.map((s) => s.name)) {
  if (["snapshot-settle", "idle-ten-seconds"].includes(name)) continue;
  const values = workflows.runs.map((r) => r.stages.find((s) => s.name === name).elapsedMs);
  lines.push(`| ${name} | ${fmt(median(values))} | ${range(values)} |`);
  if (name === "resident-switches-10")
    lines.push(
      `| average per resident switch in each batch | ${fmt(median(values) / 10)} | ${range(values.map((v) => v / 10))} |`,
    );
}
lines.push(
  "",
  "`snapshot-settle` deliberately waits 2.3 seconds for the app's 2-second debounce. `idle-ten-seconds` is a fixture interval. Neither is a latency result. Startup values in the raw file include a fixed settling wait and are not app-open metrics.",
  "",
  "## Main-process phases and repeated IO",
  "",
  "Method durations are inclusive and overlap. IO counts cover the whole scenario, including renderer follow-up and background work landing in that interval. SQL statement execution is observed on the main database connection; statement preparation, worker database calls and stream internals are not comprehensively measured.",
  "",
  "| Run | Monitor | Cold create internal ms | Spawn + initialize ms | ACP session/new ms | 10 resident switches: JSON reads / writes | Active deltas / background deltas |",
  "| --- | --- | ---: | ---: | ---: | --- | --- |",
);
for (const r of workflows.runs) {
  const sum = (name) =>
    r.totals
      .filter((x) => x.stage === "cold-provider-thread" && x.name === name)
      .reduce((s, x) => s + x.totalMs, 0);
  lines.push(
    `| ${r.run} | ${r.monitor ? "on" : "off"} | ${fmt(sum("manager.createThreadInternal"))} | ${fmt(sum("lifecycle.spawnAndInitialize"))} | ${fmt(sum("manager.sessionNew"))} | ${count(r, "resident-switches-10", "fs.async.readFile", "launch-state.json")} / ${count(r, "resident-switches-10", "fs.async.writeFile", "launch-state.json")} | ${count(r, "active-prompt", "IPC.send", "agent:event:session-update")} / ${count(r, "background-prompt", "IPC.send", "agent:event:session-update")} |`,
  );
}
lines.push(
  "",
  "All active prompt scenarios contain 80 assistant text chunks, one user echo and one tool update. They delivered 82 delta events, three full state events, one tool watermark and two running-thread events plus stop. Background text deltas were correctly suppressed. The harness explicitly selects the visible bridge gate for this comparison; it does not measure paint.",
  "",
  "### Controlled queue blocking",
  "",
  "| Run | Injected provider initialize delay ms | Resident switch wait ms | Total background preparation + switch ms |",
  "| --- | ---: | ---: | ---: |",
);
for (const r of workflows.runs)
  lines.push(
    `| ${r.run} | ${r.queue.injectedInitializeDelayMs} | ${fmt(r.queue.switchWaitMs)} | ${fmt(r.queue.totalMs)} |`,
  );
lines.push(
  "",
  "The switch starts 20 ms after background creation. This demonstrates head-of-line blocking; the injected delay is not an observation about a real provider.",
  "",
  "### Catalog lookup and process lifetime",
  "",
  "| Run | Resident sessions before / after | Provider processes before / after catalog | Processes still cached after idle interval |",
  "| --- | --- | --- | ---: |",
);
for (const r of workflows.runs)
  lines.push(
    `| ${r.run} | ${r.beforeCatalog.residentSessions} / ${r.afterCatalog.residentSessions} | ${r.beforeCatalog.connections.length} / ${r.afterCatalog.connections.length} | ${r.connections.length} |`,
  );
lines.push(
  "",
  "Before discovery, the normal, cold-test and intentionally slow providers were already cached. Eight selected providers include two of those; discovery starts six additional processes. The ninth cached provider is the controlled slow one. Provider-process counts are actual separate child processes; memory savings from a proposed lease policy are not measured.",
  "",
  "## Snapshot access and write amplification",
  "",
  "Actual `ThreadSnapshotStore`, synthetic high-entropy 4 MiB body set, 128 tools, requesting the last 16 IDs. Sequential/batched order alternates across trials; returned bodies are checked for equality.",
  "",
  "| Trial | 16 separate loads ms | One batched load ms |",
  "| --- | ---: | ---: |",
);
for (const t of components.sidecar.trials)
  lines.push(`| ${t.run} | ${fmt(t.sequentialMs)} | ${fmt(t.batchMs)} |`);
lines.push(
  "",
  "| Append | Changed JSON bytes | Base compressed bytes | New compressed bytes written | Write ms | Output / changed bytes |",
  "| --- | ---: | ---: | ---: | ---: | ---: |",
);
components.sidecar.rewrite.forEach((t, i) =>
  lines.push(
    `| ${i + 1} | ${t.changedJsonBytes} | ${t.baseCompressedBytes} | ${t.newCompressedBytes} | ${fmt(t.ms)} | ${fmt(t.newCompressedBytes / t.changedJsonBytes)}× |`,
  ),
);
lines.push(
  "",
  "The write times include store work and budget enforcement against the small fixture database, not just compression. They exclude actual storage-device write amplification and are not CPU-only times.",
);
if (components.budgetQuery.dataset) {
  const q = components.budgetQuery;
  lines.push(
    "",
    "## Read-only local database measurements",
    "",
    `Dataset: ${q.dataset.rows} snapshot rows, ${q.dataset.transcriptBytes} transcript bytes, ${q.dataset.sidecarBytes} compressed-sidecar bytes reported in metadata. Live database state can change between independent audits.`,
    "",
    "| Query | Trials | Median ms | Range ms |",
    "| --- | ---: | ---: | ---: |",
    `| Current exact budget query | ${q.trials.length} | ${fmt(median(q.trials.map((t) => t.actualMs)))} | ${range(q.trials.map((t) => t.actualMs))} |`,
    `| Metadata-only lower bound, omits transcript accounting | ${q.trials.length} | ${fmt(median(q.trials.map((t) => t.metadataOnlyMs)))} | ${range(q.trials.map((t) => t.metadataOnlyMs))} |`,
    "",
    "The comparison is not a correct replacement query. A correct optimization needs stored byte accounting, and potentially narrow metadata storage. Both queries run synchronously in the current architecture.",
  );
  const ql = components.largeSnapshotRead;
  lines.push(
    "",
    `Largest transcript row: ${ql.bytes} bytes, ${ql.trials[0].entries} entries, ${ql.trials[0].tools} tool records. Median SQL get: ${fmt(median(ql.trials.map((t) => t.sqlReadMs)))} ms. Median JSON.parse: ${fmt(median(ql.trials.map((t) => t.parseMs)))} ms. These are measured separately; neither includes complete store restoration, IPC or paint.`,
  );
}
lines.push(
  "",
  "## Streaming reducer and panel projection",
  "",
  "Actual production reducer and `toPanelSnapshot`, 1,000 text chunks after warmup; median of three repetitions. Settled user/assistant pairs and completed tool metadata are synthetic. No DOM rendering/layout/paint is included. These are independent cases with JIT/GC noise, not a strictly monotonic model.",
  "",
  "| Prior entries | Tool records | Reducer only ms | Reducer + panel projection ms |",
  "| ---: | ---: | ---: | ---: |",
);
for (const r of components.streaming.result)
  lines.push(
    `| ${r.entriesCount} | ${r.toolsCount} | ${fmt(median(r.trials.map((t) => t.reducerMs)))} | ${fmt(median(r.trials.map((t) => t.withProjectionMs)))} |`,
  );
const size = components.streaming.leanToolSize;
lines.push(
  "",
  `Same ${size.bodyBytes}-byte string as raw input: ${size.rawInputBytes} bytes in a lean tool JSON record. As raw output: ${size.rawOutputBytes} bytes. This measures the current representation, not typical production input size.`,
);
const retention = components.rendererPayloadRetention;
lines.push(
  "",
  "## Renderer body-cache retention",
  "",
  `Actual renderer cache module in a Node worker with forced GC: ${retention.threads} threads × ${retention.bytesPerThread} body bytes retained ${(retention.retainedHeapBytes / 1048576).toFixed(2)} MiB heap; explicit cache cleanup released ${(retention.releasedHeapBytes / 1048576).toFixed(2)} MiB. A final validation reference can retain one body during cleanup. This demonstrates the cache lifetime, not total Electron renderer RSS or a production leak rate.`,
  "",
  "## File inventory",
  "",
  `${inventory.modules.length} JavaScript/TypeScript modules and ${inventory.otherFiles.length} other files were indexed. Generated reports, ignored dependencies/build products and .git are excluded. [Full index](FILE-MAP.md), [AST details and hashes](module-map.json).`,
  "",
  "| Entry | Static local runtime reachability | Including dynamic imports |",
  "| --- | ---: | ---: |",
);
for (const c of inventory.importClosures)
  lines.push(`| ${c.file} | ${c.staticImports.length} | ${c.allImports.length} |`);
lines.push(
  "",
  "Reachability includes the entry itself; type-only imports and third-party package internals are excluded. Runtime-resolved imports, native linking and filesystem behavior require additional tracing. Counts alone do not demonstrate a performance regression.",
  "",
);
writeFileSync(resolve(root, "MEASUREMENTS.md"), lines.join("\n"));
