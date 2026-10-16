// Whole-app resource benchmark (R35). Launches the built Electron app in fresh
// processes against disposable fixtures and mock ACP providers, then records
// process-tree RSS, heap, CPU, long tasks and create/switch latency. Each
// configuration runs `--runs` times; the summary reports medians.
//
//   bun run bench:app                       # axes matrix, 3 runs, prints a table
//   bun run bench:app --build               # rebuild out/ first (clean checkout)
//   bun run bench:app --scenario monitor    # monitor off / closed / open overhead
//   bun run bench:app --threads 1,4,8 --terminals 0,4 --history 4,24 --matrix full
//
// Output JSON goes to --output (default: a file under the OS temp directory),
// never into the repository.
import { _electron } from "playwright";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { cpus, tmpdir, totalmem } from "node:os";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "app-root": { type: "string", default: process.cwd() },
    build: { type: "boolean", default: false },
    scenario: { type: "string", default: "workload" },
    matrix: { type: "string", default: "axes" },
    threads: { type: "string", default: "1,4,8" },
    terminals: { type: "string", default: "0,4" },
    history: { type: "string", default: "4,24" },
    runs: { type: "string", default: "3" },
    switches: { type: "string", default: "3" },
    "idle-ms": { type: "string", default: "8000" },
    output: { type: "string" },
    label: { type: "string", default: "" },
  },
});

const MiB = 1024 * 1024;
const appRoot = resolve(values["app-root"]);
const runs = boundedInt(values.runs, "--runs", 1, 20);
const switchRounds = boundedInt(values.switches, "--switches", 1, 20);
const idleMs = boundedInt(values["idle-ms"], "--idle-ms", 1000, 120_000);
const list = (raw, name, max) => raw.split(",").map((value) => boundedInt(value, name, 0, max));
const threadCounts = list(values.threads, "--threads", 32);
const terminalCounts = list(values.terminals, "--terminals", 32);
const historyLengths = list(values.history, "--history", 200);
if (threadCounts.some((value) => value < 1)) throw new Error("--threads values must be ≥ 1");
if (historyLengths.some((value) => value < 1)) throw new Error("--history values must be ≥ 1");

function boundedInt(raw, name, min, max) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer ${min}–${max}`);
  return value;
}

function configurations() {
  if (values.scenario === "monitor") {
    const threads = Math.max(...threadCounts);
    const terminals = Math.max(...terminalCounts);
    const history = Math.min(...historyLengths);
    return ["off", "closed", "open"].map((monitor) => ({ threads, terminals, history, monitor }));
  }
  if (values.scenario !== "workload") throw new Error("--scenario must be workload or monitor");
  if (values.matrix === "full") {
    return threadCounts.flatMap((threads) =>
      terminalCounts.flatMap((terminals) =>
        historyLengths.map((history) => ({ threads, terminals, history, monitor: "closed" })),
      ),
    );
  }
  if (values.matrix !== "axes") throw new Error("--matrix must be axes or full");
  // Vary one axis at a time around a base point to keep the default affordable.
  const base = {
    threads: threadCounts.includes(4) ? 4 : threadCounts[0],
    terminals: terminalCounts[0],
    history: historyLengths[0],
    monitor: "closed",
  };
  const seen = new Set();
  const configs = [];
  const add = (config) => {
    const key = configKey(config);
    if (seen.has(key)) return;
    seen.add(key);
    configs.push(config);
  };
  for (const threads of threadCounts) add({ ...base, threads });
  for (const terminals of terminalCounts) add({ ...base, terminals });
  for (const history of historyLengths) add({ ...base, history });
  return configs;
}

function configKey({ threads, terminals, history, monitor }) {
  return `t${threads}-pty${terminals}-h${history}-mon:${monitor}`;
}

// Deterministic filler so every run replays byte-identical history.
function seededText(seed, bytes) {
  let state = seed >>> 0 || 1;
  const words = [
    "alpha",
    "beta",
    "gamma",
    "delta",
    "render",
    "commit",
    "thread",
    "buffer",
    "await",
    "yield",
  ];
  let text = "";
  while (text.length < bytes) {
    state = (state * 1664525 + 1013904223) >>> 0;
    text += words[state % words.length] + (state % 13 === 0 ? "\n" : " ");
  }
  return text.slice(0, bytes);
}

function writeFixture(path, turns) {
  const source = readFileSync(join(appRoot, "src/lib/tool-call-payload.ts"), "utf8");
  const lines = [];
  for (let turn = 0; turn < turns; turn++) {
    lines.push(JSON.stringify({ kind: "turn", index: turn }));
    const updates = [
      {
        sessionUpdate: "user_message_chunk",
        messageId: `message_user_${turn}`,
        content: { type: "text", text: `Benchmark turn ${turn}` },
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: `read-${turn}`,
        title: "Read fixture",
        kind: "read",
        status: "completed",
        rawOutput: seededText(turn + 1, 48 * 1024),
      },
      ...Array.from({ length: 12 }, (_, chunk) => ({
        sessionUpdate: "agent_message_chunk",
        messageId: `message_agent_${turn}`,
        content: { type: "text", text: seededText(turn * 100 + chunk + 7, 512) },
      })),
      {
        sessionUpdate: "agent_message_chunk",
        messageId: `message_agent_${turn}`,
        content: { type: "text", text: `\n\n\`\`\`typescript\n${source.slice(0, 6000)}\n\`\`\`\n` },
      },
    ];
    for (const update of updates)
      lines.push(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: "fixture", update },
        }),
      );
  }
  writeFileSync(path, `${lines.join("\n")}\n`);
}

function git(cwd, ...args) {
  execFileSync(
    "git",
    ["-C", cwd, "-c", "user.name=Benchmark", "-c", "user.email=benchmark@localhost", ...args],
    {
      stdio: "ignore",
    },
  );
}

function prepareFixture(root, config) {
  const project = join(root, "project");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "README.md"), "Whole-app benchmark fixture\n");
  execFileSync("git", ["init", "-q", "-b", "main", project]);
  git(project, "add", "README.md");
  git(project, "commit", "-qm", "fixture");
  const registry = join(root, "electron/agents");
  mkdirSync(registry, { recursive: true });
  cpSync(join(appRoot, "electron/agents/mock-agent.mjs"), join(registry, "mock-agent.mjs"));
  // One provider process per measured thread, plus the warmup provider.
  const agents = Array.from({ length: config.threads + 1 }, (_, index) => ({
    id: index === 0 ? "pipper-mock" : `bench-mock-${index}`,
    name: `bench-mock-${index}`,
    displayName: `Bench mock ${index}`,
    command: "node",
    args: [],
    installKind: "mock",
  }));
  writeFileSync(
    join(registry, "config.json"),
    JSON.stringify({ agents, defaultAgentId: "pipper-mock" }),
  );
  const fixture = join(root, "turns.jsonl");
  // +1 turn for the warmup thread's prompt.
  writeFixture(fixture, config.history + 1);
  mkdirSync(join(root, "zdot"), { recursive: true });
  return { project, fixture, agents };
}

// Process tree with RSS and cumulative CPU seconds, from one `ps` call.
function processTree(rootPid) {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,rss=,time=,comm="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
      if (!match) return null;
      return {
        pid: +match[1],
        parentPid: +match[2],
        rssBytes: +match[3] * 1024,
        cpuSeconds: parseCpuTime(match[4]),
        executable: basename(match[5]),
      };
    })
    .filter(Boolean);
  const selected = new Set([rootPid]);
  for (let size = -1; size !== selected.size; ) {
    size = selected.size;
    for (const row of rows) if (selected.has(row.parentPid)) selected.add(row.pid);
  }
  const processes = rows.filter((row) => selected.has(row.pid));
  return {
    processes,
    rssBytes: processes.reduce((sum, row) => sum + row.rssBytes, 0),
    cpuSeconds: processes.reduce((sum, row) => sum + row.cpuSeconds, 0),
  };
}

function parseCpuTime(text) {
  // [[dd-]hh:]mm:ss.cc
  const [days, rest] = text.includes("-") ? text.split("-") : ["0", text];
  const parts = rest.split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  return Number(days) * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function classify(executable) {
  if (/helper \(renderer\)/i.test(executable)) return "renderer";
  if (/helper \(gpu\)/i.test(executable)) return "gpu";
  if (/helper/i.test(executable)) return "electron-utility";
  if (/^electron$/i.test(executable)) return "main";
  if (executable === "node") return "provider";
  if (/(^|\/)-?(zsh|bash|sh|fish)$/.test(executable)) return "shell";
  return "other";
}

function rssByKind(tree) {
  const kinds = {};
  for (const row of tree.processes) {
    const kind = classify(row.executable);
    kinds[kind] = (kinds[kind] ?? 0) + row.rssBytes;
  }
  return kinds;
}

// Installed in the Electron main process. `process.getBuiltinModule` avoids
// relying on CommonJS `require` inside the evaluated function.
function installMainProbe() {
  const { monitorEventLoopDelay } = process.getBuiltinModule("node:perf_hooks");
  const probe = {
    histogram: monitorEventLoopDelay({ resolution: 1 }),
    cpu: process.cpuUsage(),
    wall: performance.now(),
  };
  probe.histogram.enable();
  probe.reset = () => {
    probe.histogram.reset();
    probe.cpu = process.cpuUsage();
    probe.wall = performance.now();
  };
  probe.read = () => {
    const cpu = process.cpuUsage(probe.cpu);
    const wallMs = performance.now() - probe.wall;
    return {
      wallMs,
      cpuMs: (cpu.user + cpu.system) / 1000,
      eventLoopDelayP99Ms: probe.histogram.percentile(99) / 1e6,
      eventLoopDelayMaxMs: probe.histogram.max / 1e6,
    };
  };
  globalThis.__pipperBench = probe;
}

function installRendererProbe() {
  const state = { entries: [] };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.entries.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
  } catch {
    state.unsupported = true;
  }
  state.reset = () => {
    state.entries = [];
  };
  state.read = () => ({
    longTasks: state.entries.length,
    longTaskTotalMs: state.entries.reduce((sum, value) => sum + value, 0),
    longTaskMaxMs: state.entries.reduce((max, value) => Math.max(max, value), 0),
  });
  window.__pipperBench = state;
}

async function readAppMetrics(app) {
  return app.evaluate(({ app }) =>
    app.getAppMetrics().map((metric) => ({
      pid: metric.pid,
      type: metric.type,
      cpuSeconds: metric.cpu.cumulativeCPUUsage ?? null,
      workingSetBytes: metric.memory.workingSetSize * 1024,
    })),
  );
}

async function measureMemory(app, page) {
  await page.evaluate(() => window.gc?.());
  await app.evaluate(() => globalThis.gc?.());
  const mainMemory = await app.evaluate(() => process.memoryUsage());
  const rendererHeapBytes = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  const tree = processTree(app.process().pid);
  return {
    mainHeapUsedBytes: mainMemory.heapUsed,
    mainRssBytes: mainMemory.rss,
    rendererHeapUsedBytes: rendererHeapBytes,
    treeRssBytes: tree.rssBytes,
    treeProcesses: tree.processes.length,
    rssByKind: rssByKind(tree),
  };
}

function cpuByType(before, after) {
  const prior = new Map(before.map((metric) => [metric.pid, metric]));
  const totals = {};
  for (const metric of after) {
    if (metric.cpuSeconds == null) continue;
    const start = prior.get(metric.pid)?.cpuSeconds ?? 0;
    const key = metric.type;
    totals[key] = (totals[key] ?? 0) + Math.max(0, metric.cpuSeconds - start);
  }
  return totals;
}

// Sampler subprocess count (reported by builds that include R31; null before).
const readProcessLaunches = (page) =>
  page.evaluate(async () => {
    const live = await window.omni.monitor.getLive().catch(() => null);
    return live?.pipelineTelemetry?.processLaunches ?? null;
  });

async function measureIdleWindow(app, page, durationMs) {
  const launchesBefore = await readProcessLaunches(page);
  const metricsBefore = await readAppMetrics(app);
  const treeBefore = processTree(app.process().pid);
  await app.evaluate(() => globalThis.__pipperBench.reset());
  await page.evaluate(() => window.__pipperBench.reset());
  await page.waitForTimeout(durationMs);
  const main = await app.evaluate(() => globalThis.__pipperBench.read());
  const renderer = await page.evaluate(() => window.__pipperBench.read());
  const metricsAfter = await readAppMetrics(app);
  const treeAfter = processTree(app.process().pid);
  const launchesAfter = await readProcessLaunches(page);
  const seconds = main.wallMs / 1000;
  const byType = cpuByType(metricsBefore, metricsAfter);
  const percent = (cpuSeconds) => (cpuSeconds / seconds) * 100;
  // Tree CPU covers providers, shells and short-lived children that were
  // still alive at the end; electron CPU covers Electron's own processes.
  const providerShellPids = new Set(
    treeAfter.processes
      .filter((row) => ["provider", "shell", "other"].includes(classify(row.executable)))
      .map((row) => row.pid),
  );
  const childCpu = (tree) =>
    tree.processes
      .filter((row) => providerShellPids.has(row.pid))
      .reduce((sum, row) => sum + row.cpuSeconds, 0);
  return {
    durationMs: main.wallMs,
    mainCpuPercent: (main.cpuMs / main.wallMs) * 100,
    electronCpuPercentByType: Object.fromEntries(
      Object.entries(byType).map(([type, value]) => [type, percent(value)]),
    ),
    electronCpuPercent: percent(Object.values(byType).reduce((sum, value) => sum + value, 0)),
    childCpuPercent: percent(Math.max(0, childCpu(treeAfter) - childCpu(treeBefore))),
    mainEventLoopDelayP99Ms: main.eventLoopDelayP99Ms,
    mainEventLoopDelayMaxMs: main.eventLoopDelayMaxMs,
    rendererLongTasks: renderer.longTasks,
    rendererLongTaskTotalMs: renderer.longTaskTotalMs,
    samplerLaunchesPerMinute:
      launchesBefore == null || launchesAfter == null
        ? null
        : ((launchesAfter - launchesBefore) / main.wallMs) * 60_000,
  };
}

async function runOnce(config, run, buildHash) {
  const root = mkdtempSync(join(tmpdir(), "pipper-bench-app-"));
  let app;
  const peak = { rssBytes: 0, timer: null };
  try {
    const { project, fixture, agents } = prepareFixture(root, config);
    const env = {
      ...process.env,
      PIPPER_BENCHMARK_MODE: "1",
      PIPPER_DEV_USER_DATA_PATH: join(root, "userdata"),
      PIPPER_LIBRARY_PATH: join(root, "library"),
      PIPPER_WORKTREES_PATH: join(root, "worktrees"),
      PIPPER_BENCHMARK_PROJECT_PATH: project,
      PIPPER_BENCHMARK_FIXTURE: fixture,
      PIPPER_REMOTE_ENABLED: "0",
      PIPPER_MONITOR: config.monitor === "off" ? "0" : "1",
      ANALYTICS_ENABLED: "false",
      // Shells start without the user's rc files so terminal cost is comparable.
      ...(existsSync("/bin/zsh") ? { SHELL: "/bin/zsh", ZDOTDIR: join(root, "zdot") } : {}),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const launched = performance.now();
    app = await _electron.launch({
      args: ["--js-flags=--expose-gc", join(appRoot, "out/main/index.js")],
      cwd: root,
      env,
      timeout: 60_000,
    });
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.omni?.agent && window.omni?.projects), null, {
      timeout: 60_000,
    });
    const projectId = await page.evaluate(async () => (await window.omni.projects.getActive())?.id);
    if (!projectId) throw new Error("No benchmark project activated");
    const startupMs = performance.now() - launched;
    await app.evaluate((_electron, source) => {
      // oxlint-disable-next-line no-eval -- Install our own serialized probe in the disposable app.
      (0, eval)(`(${source})`)();
    }, installMainProbe.toString());
    await page.evaluate(installRendererProbe);
    const pid = app.process().pid;
    peak.timer = setInterval(() => {
      try {
        peak.rssBytes = Math.max(peak.rssBytes, processTree(pid).rssBytes);
      } catch {
        // The app may be shutting down.
      }
    }, 1000);

    const createThread = (agentId, title) =>
      page.evaluate(
        async ({ projectId, agentId, title }) => {
          const started = performance.now();
          const thread = await window.omni.agent.createThread(
            projectId,
            title,
            null,
            agentId,
            null,
          );
          const createMs = performance.now() - started;
          await window.omni.tabs.open(thread.id);
          return { id: thread.id, createMs };
        },
        { projectId, agentId, title },
      );
    const prompt = (ids, message) =>
      page.evaluate(
        async ({ ids, message }) => {
          const started = performance.now();
          await Promise.all(
            ids.map((threadId) => window.omni.agent.sendPrompt({ threadId, message })),
          );
          return performance.now() - started;
        },
        { ids, message },
      );

    // Warmup: one provider, thread, prompt and switch outside the measurements.
    const warm = await createThread("pipper-mock", "Warmup");
    await prompt([warm.id], "Warmup");
    await page.evaluate((id) => window.omni.agent.switchThread(id), warm.id);
    await page.waitForTimeout(500);
    const afterWarmup = await measureMemory(app, page);

    await app.evaluate(() => globalThis.__pipperBench.reset());
    await page.evaluate(() => window.__pipperBench.reset());
    const threads = [];
    for (const agent of agents.slice(1))
      threads.push(await createThread(agent.id, agent.displayName));

    const terminalIds = await page.evaluate(
      async ({ count, cwd }) => {
        const ids = [];
        for (let index = 0; index < count; index++) {
          const id = `bench-terminal-${index}`;
          await window.omni.terminal.create(id, cwd, 120, 32);
          ids.push(id);
        }
        return ids;
      },
      { count: config.terminals, cwd: project },
    );
    if (terminalIds.length > 0) {
      // Fill each terminal's scrollback with deterministic output.
      await page.evaluate(async (ids) => {
        for (const id of ids)
          await window.omni.terminal.write(
            id,
            'for i in $(seq 1 1500); do echo "benchmark line $i lorem ipsum dolor sit amet"; done\r',
          );
      }, terminalIds);
    }

    const turnMs = [];
    const ids = threads.map((thread) => thread.id);
    for (let turn = 0; turn < config.history; turn++)
      turnMs.push(await prompt(ids, `Turn ${turn}`));
    const workloadMain = await app.evaluate(() => globalThis.__pipperBench.read());
    // Integrity: every thread must hold the complete replayed tool history.
    const toolCounts = await page.evaluate(async (ids) => {
      const counts = [];
      for (const id of ids)
        counts.push(Object.keys(await window.omni.agent.getToolCalls(id)).length);
      return counts;
    }, ids);
    if (toolCounts.some((count) => count !== config.history))
      throw new Error(`Incomplete history: expected ${config.history} tools, got ${toolCounts}`);
    const workloadRenderer = await page.evaluate(() => window.__pipperBench.read());
    // Snapshot writes debounce for ~2 s; let them land outside switch timings.
    await page.waitForTimeout(3000);

    const switchTargets = ids.length > 1 ? ids : [warm.id, ids[0]];
    await app.evaluate(() => globalThis.__pipperBench.reset());
    await page.evaluate(() => window.__pipperBench.reset());
    const switchMs = await page.evaluate(
      async ({ targets, rounds }) => {
        const timings = [];
        for (let round = 0; round < rounds; round++)
          for (const id of targets) {
            const started = performance.now();
            await window.omni.agent.switchThread(id);
            timings.push(performance.now() - started);
          }
        return timings;
      },
      { targets: switchTargets, rounds: switchRounds },
    );
    const switchMain = await app.evaluate(() => globalThis.__pipperBench.read());
    const switchRenderer = await page.evaluate(() => window.__pipperBench.read());

    if (config.monitor === "open") {
      const opened = app.waitForEvent("window");
      await page.evaluate(() => window.omni.monitor.openWindow());
      const monitorPage = await opened;
      await monitorPage.waitForLoadState("domcontentloaded");
      await monitorPage.waitForTimeout(2000);
    }
    // Let switch-triggered persistence and monitor work settle before idling.
    await page.waitForTimeout(3000);
    const idle = await measureIdleWindow(app, page, idleMs);
    const final = await measureMemory(app, page);
    const monitorHealth =
      config.monitor === "off"
        ? null
        : await page.evaluate(
            async () => (await window.omni.monitor.getLive())?.pipelineTelemetry ?? null,
          );

    return {
      run,
      config,
      buildHash,
      startupMs,
      createMs: threads.map((thread) => thread.createMs),
      turnMs,
      switchMs,
      workload: { main: workloadMain, renderer: workloadRenderer },
      switching: { main: switchMain, renderer: switchRenderer },
      idle,
      memory: { afterWarmup, final, peakTreeRssBytes: Math.max(peak.rssBytes, final.treeRssBytes) },
      monitorHealth,
    };
  } finally {
    if (peak.timer) clearInterval(peak.timer);
    if (app) await app.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
}

const median = (items) => {
  const sorted = items.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const percentile = (items, p) => {
  const sorted = items.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

function summarize(results) {
  const pick = (fn) => median(results.map(fn));
  return {
    runs: results.length,
    startupMs: pick((r) => r.startupMs),
    createMedianMs: pick((r) => median(r.createMs)),
    turnMedianMs: pick((r) => median(r.turnMs)),
    switchMedianMs: pick((r) => median(r.switchMs)),
    switchP95Ms: pick((r) => percentile(r.switchMs, 95)),
    workloadLongTasks: pick((r) => r.workload.renderer.longTasks),
    workloadLongTaskMs: pick((r) => r.workload.renderer.longTaskTotalMs),
    workloadMainCpuMs: pick((r) => r.workload.main.cpuMs),
    workloadMainLoopMaxMs: pick((r) => r.workload.main.eventLoopDelayMaxMs),
    switchLongTasks: pick((r) => r.switching.renderer.longTasks),
    idleMainCpuPercent: pick((r) => r.idle.mainCpuPercent),
    idleElectronCpuPercent: pick((r) => r.idle.electronCpuPercent),
    idleRendererCpuPercent: pick((r) => r.idle.electronCpuPercentByType.Tab ?? 0),
    idleChildCpuPercent: pick((r) => r.idle.childCpuPercent),
    idleMainLoopP99Ms: pick((r) => r.idle.mainEventLoopDelayP99Ms),
    idleLongTasks: pick((r) => r.idle.rendererLongTasks),
    idleSamplerLaunchesPerMin: pick((r) => r.idle.samplerLaunchesPerMinute),
    finalTreeRssMiB: pick((r) => r.memory.final.treeRssBytes / MiB),
    peakTreeRssMiB: pick((r) => r.memory.peakTreeRssBytes / MiB),
    electronRssMiB: pick(
      (r) =>
        Object.entries(r.memory.final.rssByKind)
          .filter(([kind]) => !["provider", "shell", "other"].includes(kind))
          .reduce((sum, [, value]) => sum + value, 0) / MiB,
    ),
    mainHeapMiB: pick((r) => r.memory.final.mainHeapUsedBytes / MiB),
    rendererHeapMiB: pick((r) => (r.memory.final.rendererHeapUsedBytes ?? NaN) / MiB),
    mainHeapGrowthMiB: pick(
      (r) => (r.memory.final.mainHeapUsedBytes - r.memory.afterWarmup.mainHeapUsedBytes) / MiB,
    ),
  };
}

function printTable(summaries) {
  const columns = [
    ["config", (s) => s.key],
    ["startup", (s) => s.startupMs, "ms"],
    ["create", (s) => s.createMedianMs, "ms"],
    ["turn", (s) => s.turnMedianMs, "ms"],
    ["switch p50", (s) => s.switchMedianMs, "ms"],
    ["switch p95", (s) => s.switchP95Ms, "ms"],
    ["LT work", (s) => s.workloadLongTasks],
    ["LT ms", (s) => s.workloadLongTaskMs, "ms"],
    ["idle main%", (s) => s.idleMainCpuPercent, "%"],
    ["idle app%", (s) => s.idleElectronCpuPercent, "%"],
    ["idle rend%", (s) => s.idleRendererCpuPercent, "%"],
    ["loop p99", (s) => s.idleMainLoopP99Ms, "ms"],
    ["ps/min", (s) => s.idleSamplerLaunchesPerMin],
    ["tree RSS", (s) => s.finalTreeRssMiB, "MiB"],
    ["peak RSS", (s) => s.peakTreeRssMiB, "MiB"],
    ["app RSS", (s) => s.electronRssMiB, "MiB"],
    ["main heap", (s) => s.mainHeapMiB, "MiB"],
    ["rend heap", (s) => s.rendererHeapMiB, "MiB"],
  ];
  const format = (value, unit) => {
    if (typeof value === "string") return value;
    if (value == null) return "–";
    const digits = unit === "%" || Math.abs(value) < 10 ? 2 : 1;
    return value.toFixed(digits);
  };
  const header = columns.map(([name, , unit]) => (unit ? `${name} (${unit})` : name));
  const rows = summaries.map((summary) =>
    columns.map(([, get, unit]) => format(get(summary), unit)),
  );
  const widths = header.map((name, index) =>
    Math.max(name.length, ...rows.map((row) => row[index].length)),
  );
  const line = (cells) =>
    `| ${cells.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
  console.log(line(header));
  console.log(`| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`);
  for (const row of rows) console.log(line(row));
}

if (values.build) {
  console.log("Building app (electron-vite build)…");
  const build = spawnSync("bun", ["x", "--bun", "electron-vite", "build"], {
    cwd: appRoot,
    stdio: "inherit",
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const mainEntry = join(appRoot, "out/main/index.js");
if (!existsSync(mainEntry))
  throw new Error(`${mainEntry} is missing; run with --build or bun run build first`);
const buildHash = createHash("sha256").update(readFileSync(mainEntry)).digest("hex").slice(0, 16);
const commit = (() => {
  try {
    return execFileSync("git", ["-C", appRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
})();
const dirty = (() => {
  try {
    return (
      execFileSync("git", ["-C", appRoot, "status", "--porcelain"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim().length > 0
    );
  } catch {
    return null;
  }
})();
const output = resolve(
  values.output ??
    join(
      tmpdir(),
      "pipper-bench",
      `app-${values.scenario}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    ),
);
const report = {
  schema: 1,
  capturedAt: new Date().toISOString(),
  label: values.label,
  commit,
  dirty,
  buildHash,
  scenario: values.scenario,
  host: {
    platform: process.platform,
    arch: process.arch,
    cpus: cpus().length,
    cpuModel: cpus()[0]?.model,
    totalMemBytes: totalmem(),
  },
  options: { runs, switchRounds, idleMs },
  limitations:
    "Mock ACP providers (one per thread) on local fixtures; no network or real-provider memory. Summed RSS counts shared pages per process and is not unique physical memory. Heap is measured after a forced GC. Switch latency is renderer IPC round-trip, not paint. Long tasks come from the renderer Long Tasks API; main-process stalls are reported as event-loop delay.",
  results: [],
  summaries: [],
};
const configs = configurations();
// Interleave configurations across runs so drift (thermal, background load)
// spreads across all of them instead of biasing the last configuration.
for (let run = 1; run <= runs; run++) {
  for (const config of configs) {
    const label = `${configKey(config)} run ${run}/${runs}`;
    const started = performance.now();
    try {
      const result = await runOnce(config, run, buildHash);
      report.results.push(result);
      console.log(`  ${label}: ${((performance.now() - started) / 1000).toFixed(1)} s`);
    } catch (error) {
      report.results.push({
        run,
        config,
        error: error instanceof Error ? error.stack : String(error),
      });
      console.error(`  ${label} failed: ${error instanceof Error ? error.message : error}`);
    }
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(report, null, 2));
  }
}
report.summaries = configs.map((config) => ({
  key: configKey(config),
  config,
  ...summarize(
    report.results.filter(
      (result) => !result.error && configKey(result.config) === configKey(config),
    ),
  ),
}));
writeFileSync(output, JSON.stringify(report, null, 2));
console.log(
  `\n${values.scenario} · ${commit?.slice(0, 10) ?? "unknown"}${dirty ? "+dirty" : ""} · medians of ${runs} fresh runs\n`,
);
printTable(report.summaries);
console.log(`\nReport: ${output}`);
if (report.results.some((result) => result.error)) process.exitCode = 1;
