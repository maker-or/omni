// Event-to-paint and React commit counts for a streamed agent turn in the real
// Electron app. Builds disposable instrumented copies of one or more source
// refs, streams a paced mixed turn from the mock ACP agent into the displayed
// thread, and records, in the renderer:
//   - receive time of every agent_message_chunk at the store bridge handler,
//   - when its text first reaches the DOM (MutationObserver),
//   - when the frame containing it has painted (post-rAF task),
//   - React commits and render time (react-dom/profiling + <Profiler>),
//   - agent store notifications, long tasks and frame gaps.
// Rounds alternate ref order so before/after share machine load.
//
//   node scripts/measure-stream-paint.mjs --ref HEAD --ref WORKTREE --rounds 3
import { _electron } from "playwright";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    ref: { type: "string", multiple: true, default: ["WORKTREE"] },
    rounds: { type: "string", default: "3" },
    chunks: { type: "string", default: "1000" },
    output: { type: "string" },
    keep: { type: "boolean", default: false },
  },
});
const rounds = Number(values.rounds);
const chunks = Number(values.chunks);
if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 10)
  throw new Error("--rounds must be 1–10");

/** Arrival schedules: `burst` events written back to back every `gapMs`. */
const SCHEDULES = [
  { name: "steady-8ms", gapMs: 8, burst: 1 },
  { name: "steady-2ms", gapMs: 2, burst: 1 },
  { name: "burst-8x32ms", gapMs: 32, burst: 8 },
];

const cwd = process.cwd();
const root = mkdtempSync(join(tmpdir(), "pipper-stream-paint-"));

/** Same shape as mixedStream() in electron/architecture-costs.bench.test.ts, with seq tokens. */
function mixedTurn(turn, toolEvery = 50) {
  const updates = [];
  let messageChunks = 0;
  for (let i = 0; i < chunks; i++) {
    if (i % toolEvery === toolEvery - 1) {
      const toolCallId = `t${turn}-tool-${i}`;
      updates.push(
        {
          sessionUpdate: "tool_call",
          toolCallId,
          title: "Read file",
          kind: "read",
          status: "pending",
        },
        { sessionUpdate: "tool_call_update", toolCallId, status: "in_progress" },
        {
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: `body ${i}` } }],
        },
      );
    } else if (i % 97 === 0) {
      updates.push({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "hmm " },
      });
    } else {
      messageChunks += 1;
      updates.push({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `t${turn}w${i} ` },
      });
    }
  }
  return { updates, messageChunks };
}

const PROBE_SOURCE = String.raw`
import { useAgentStore } from "./store/agent-store";
const now = () => performance.now();
const probe: any = { armed: false };
probe.reset = (turn: number) => {
  probe.turn = turn;
  probe.pattern = new RegExp("\\bt" + turn + "w(\\d+)\\b", "g");
  probe.recv = new Map();
  probe.commit = new Map();
  probe.paint = new Map();
  probe.pending = [];
  probe.maxSeq = -1;
  probe.events = 0;
  probe.commits = 0;
  probe.renderMs = 0;
  probe.notifications = 0;
  probe.frames = [];
  probe.longTasks = [];
  probe.hiddenDuringTurn = false;
};
probe.reset(-1);
document.addEventListener("visibilitychange", () => {
  if (probe.armed && document.visibilityState !== "visible") probe.hiddenDuringTurn = true;
});
probe.receive = (payload: any) => {
  if (!probe.armed) return;
  probe.events += 1;
  if (payload.type !== "session-update" || payload.update?.sessionUpdate !== "agent_message_chunk") return;
  const match = /\bt(\d+)w(\d+)\b/.exec(payload.update.content?.text ?? "");
  if (match && Number(match[1]) === probe.turn) probe.recv.set(Number(match[2]), now());
};
probe.onRender = (_id: string, _phase: string, actualDuration: number) => {
  if (!probe.armed) return;
  probe.commits += 1;
  probe.renderMs += actualDuration;
};
function scan(text: string | null | undefined) {
  if (!text) return;
  probe.pattern.lastIndex = 0;
  let match;
  let max = probe.maxSeq;
  while ((match = probe.pattern.exec(text))) max = Math.max(max, Number(match[1]));
  if (max <= probe.maxSeq) return;
  const t = now();
  for (const seq of probe.recv.keys()) {
    if (seq > probe.maxSeq && seq <= max && !probe.commit.has(seq)) {
      probe.commit.set(seq, t);
      probe.pending.push(seq);
    }
  }
  probe.maxSeq = max;
}
new MutationObserver((records) => {
  if (!probe.armed) return;
  for (const record of records) {
    if (record.type === "characterData") scan((record.target as Text).data);
    else for (const node of record.addedNodes) scan(node.textContent);
  }
}).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
// A task posted from rAF runs after that frame's style, layout and paint.
const channel = new MessageChannel();
channel.port1.onmessage = () => {
  const t = now();
  probe.frames.push(t);
  for (const seq of probe.pending) probe.paint.set(seq, t);
  probe.pending = [];
};
let generation = 0;
function loop(gen: number) {
  const frame = () => {
    if (gen !== generation || !probe.armed) return;
    channel.port2.postMessage(0);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
new PerformanceObserver((list) => {
  if (!probe.armed) return;
  for (const entry of list.getEntries()) probe.longTasks.push(entry.duration);
}).observe({ type: "longtask" });
useAgentStore.subscribe(() => {
  if (probe.armed) probe.notifications += 1;
});
probe.arm = (turn: number) => {
  probe.reset(turn);
  probe.armed = true;
  loop(++generation);
};
probe.idle = (expected: number) =>
  probe.paint.size >= expected && useAgentStore.getState().state?.isStreaming === false;
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? null;
  return {
    n: sorted.length,
    mean: sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length),
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted.at(-1) ?? null,
  };
}
probe.summary = () => {
  probe.armed = false;
  const toPaint = [];
  const toCommit = [];
  for (const [seq, t] of probe.recv) {
    const painted = probe.paint.get(seq);
    const committed = probe.commit.get(seq);
    if (painted != null) toPaint.push(painted - t);
    if (committed != null) toCommit.push(committed - t);
  }
  const firstRecv = Math.min(...probe.recv.values());
  const frames = probe.frames.filter((t: number) => t >= firstRecv);
  const gaps = frames.slice(1).map((t: number, i: number) => t - frames[i]);
  return {
    events: probe.events,
    messageChunks: probe.recv.size,
    unpainted: probe.recv.size - toPaint.length,
    storeNotifications: probe.notifications,
    reactCommits: probe.commits,
    reactRenderMs: probe.renderMs,
    receiveToPaintMs: stats(toPaint),
    receiveToDomMs: stats(toCommit),
    streamMs: Math.max(...probe.paint.values()) - firstRecv,
    frames: frames.length,
    framesOver33ms: gaps.filter((g: number) => g > 33.4).length,
    maxFrameGapMs: Math.max(0, ...gaps),
    longTasks: probe.longTasks.length,
    longTaskMs: probe.longTasks.reduce((a: number, b: number) => a + b, 0),
    hiddenDuringTurn: probe.hiddenDuringTurn,
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),
  };
};
(globalThis as any).__streamProbe = probe;
`;

function patch(path, find, replace) {
  const source = readFileSync(path, "utf8");
  if (!source.includes(find)) throw new Error(`Probe patch anchor not found in ${path}: ${find}`);
  writeFileSync(path, source.replace(find, replace));
}

function buildVariant(ref, index) {
  const mirror = join(root, `source-${index}`);
  mkdirSync(mirror);
  const archive = execFileSync("git", ["archive", ref === "WORKTREE" ? "HEAD" : ref], {
    maxBuffer: 200 * 1024 * 1024,
  });
  const extracted = spawnSync("tar", ["-xf", "-", "-C", mirror], { input: archive });
  if (extracted.status !== 0) throw new Error("Cannot extract source mirror");
  if (ref === "WORKTREE") {
    const changed = execFileSync("git", ["diff", "HEAD", "--name-only", "-z"], {
      encoding: "utf8",
    }).split("\0");
    const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
      encoding: "utf8",
    }).split("\0");
    for (const file of new Set([...changed, ...untracked])) {
      if (!file || /^(docs\/|\.tmp-check\/)/.test(file)) continue;
      if (!existsSync(join(cwd, file))) {
        rmSync(join(mirror, file), { force: true });
        continue;
      }
      mkdirSync(dirname(join(mirror, file)), { recursive: true });
      cpSync(join(cwd, file), join(mirror, file));
    }
  }
  symlinkSync(join(cwd, "node_modules"), join(mirror, "node_modules"), "dir");
  const mainPath = join(mirror, "electron/main.ts");
  writeFileSync(
    mainPath,
    readFileSync(mainPath, "utf8") +
      `\n// Disposable measurement exposure; never part of application source.\nglobalThis.__pipperStreamPaint = {setVisible:(visible)=>{windowVisibilityGate.setWindowVisible(visible);windowVisibilityGate.setRendererVisible(visible);}};\n// The hidden-window gate drops deltas; other windows on a shared desktop must not change the workload.\nwindowVisibilityGate.isVisible = () => true;\n`,
  );
  writeFileSync(join(mirror, "src/__stream-probe.ts"), PROBE_SOURCE);
  const rendererPath = join(mirror, "src/main.tsx");
  patch(
    rendererPath,
    'import { StrictMode, useEffect } from "react";',
    'import "./__stream-probe";\nimport { Profiler, StrictMode, useEffect } from "react";',
  );
  patch(
    rendererPath,
    "<App />",
    '<Profiler id="app" onRender={(globalThis as any).__streamProbe.onRender}><App /></Profiler>',
  );
  writeFileSync(
    rendererPath,
    readFileSync(rendererPath, "utf8") +
      '\nimport {useAgentStore as __archStore} from "./store/agent-store";\nwindow.__pipperArchitectureStore=__archStore;\n',
  );
  // Production React drops <Profiler> callbacks; the profiling build keeps them.
  patch(
    join(mirror, "electron.vite.config.ts"),
    "      alias: [\n        {\n          find: /^@\\/(.*)$/,",
    '      alias: [\n        { find: /^react-dom\\/client$/, replacement: "react-dom/profiling" },\n        {\n          find: /^@\\/(.*)$/,',
  );
  patch(
    join(mirror, "src/store/agent-store.ts"),
    "window.omni.agent.onEvent((payload: AcpBridgeEvent) => {",
    "window.omni.agent.onEvent((payload: AcpBridgeEvent) => {\n        (globalThis as any).__streamProbe?.receive(payload);",
  );
  console.log(
    `Building ${ref} (${execFileSync("git", ["rev-parse", "--short", ref === "WORKTREE" ? "HEAD" : ref], { encoding: "utf8" }).trim()}${ref === "WORKTREE" ? "+working tree" : ""})`,
  );
  const build = spawnSync("bun", ["x", "--bun", "electron-vite", "build"], {
    cwd: mirror,
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (build.status !== 0) throw new Error(build.stdout + build.stderr);
  return mirror;
}

function writeFixture(fixtureRoot) {
  const turns = [];
  const lines = [];
  for (let turn = 0; turn <= SCHEDULES.length; turn++) {
    const { updates, messageChunks } = mixedTurn(turn);
    turns.push({ messageChunks, events: updates.length });
    lines.push(JSON.stringify({ kind: "turn", turn }));
    for (const update of updates)
      lines.push(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: "fixture", update },
        }),
      );
  }
  const fixture = join(fixtureRoot, "turns.jsonl");
  writeFileSync(fixture, lines.join("\n") + "\n");
  return { fixture, turns };
}

function pacedMock() {
  const find = `  for (const line of turn) {\n    await writeRawLine(rewriteFixtureSessionId(line, session.id));\n  }`;
  const source = readFileSync(join(cwd, "electron/agents/mock-agent.mjs"), "utf8");
  if (!source.includes(find)) throw new Error("Mock fixture replay loop not found");
  return source.replace(
    find,
    `  const pace = JSON.parse(process.env.PIPPER_PROBE_SCHEDULE || "[]")[cursor] ?? { gapMs: 0, burst: 1 };
  const started = performance.now();
  for (let i = 0; i < turn.length; i++) {
    if (pace.gapMs > 0 && i > 0 && i % pace.burst === 0) {
      const due = started + (i / pace.burst) * pace.gapMs;
      const wait = due - performance.now();
      if (wait > 0) await sleep(wait);
    }
    await writeRawLine(rewriteFixtureSessionId(turn[i], session.id));
  }`,
  );
}

async function runOnce(mirror, label, round) {
  const fixtureRoot = join(root, `${label}-round-${round}`);
  mkdirSync(fixtureRoot);
  const project = join(fixtureRoot, "project");
  mkdirSync(project);
  writeFileSync(join(project, "README.md"), "Stream paint workload\n");
  execFileSync("git", ["init", "-q", "-b", "main", project]);
  execFileSync("git", ["-C", project, "add", "README.md"]);
  execFileSync("git", [
    "-C",
    project,
    "-c",
    "user.name=Benchmark",
    "-c",
    "user.email=benchmark@localhost",
    "commit",
    "-qm",
    "fixture",
  ]);
  const registry = join(fixtureRoot, "electron/agents");
  mkdirSync(registry, { recursive: true });
  writeFileSync(join(registry, "mock-agent.mjs"), pacedMock());
  writeFileSync(
    join(registry, "config.json"),
    JSON.stringify({
      agents: [
        {
          id: "pipper-mock",
          name: "pipper-mock",
          displayName: "Stream paint mock",
          command: "node",
          args: [],
          installKind: "mock",
        },
      ],
      defaultAgentId: "pipper-mock",
    }),
  );
  const { fixture, turns } = writeFixture(fixtureRoot);
  const schedule = [{ gapMs: 8, burst: 1 }, ...SCHEDULES];
  const env = {
    ...process.env,
    PIPPER_BENCHMARK_MODE: "1",
    PIPPER_DEV_USER_DATA_PATH: join(fixtureRoot, "userdata"),
    PIPPER_LIBRARY_PATH: join(fixtureRoot, "library"),
    PIPPER_WORKTREES_PATH: join(fixtureRoot, "worktrees"),
    PIPPER_BENCHMARK_PROJECT_PATH: project,
    PIPPER_BENCHMARK_FIXTURE: fixture,
    PIPPER_PROBE_SCHEDULE: JSON.stringify(schedule),
    PIPPER_REMOTE_ENABLED: "0",
    PIPPER_MONITOR: "0",
    ANALYTICS_ENABLED: "false",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    // Other windows (or Spaces) occluding this one would hide the document,
    // and main drops deltas for hidden windows; keep it rendering.
    args: [
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      join(mirror, "out/main/index.js"),
    ],
    cwd: fixtureRoot,
    env,
    timeout: 30000,
  });
  try {
    const main = await app.firstWindow();
    main.on("pageerror", (error) => console.error(`  renderer error: ${error.message}`));
    await main.waitForFunction(() => Boolean(window.omni?.agent && window.__streamProbe));
    const projectId = await main.evaluate(async () => (await window.omni.projects.getActive())?.id);
    if (!projectId) throw new Error("Missing fixture project");
    await main.waitForTimeout(1200);
    await app.evaluate(({ BrowserWindow }) => {
      globalThis.__pipperStreamPaint.setVisible(true);
      const win = BrowserWindow.getAllWindows()[0];
      // Occlusion by other windows stops rAF and paint; keep this one in front.
      win?.setAlwaysOnTop(true, "floating");
      win?.show();
      win?.focus();
    });
    const thread = await main.evaluate(
      (projectId) =>
        window.__pipperArchitectureStore
          .getState()
          .createThread(projectId, "Stream paint", null, "pipper-mock", null),
      projectId,
    );
    await main.waitForFunction(
      (id) => window.__pipperArchitectureStore.getState().state?.threadId === id,
      thread.id,
    );
    const results = [];
    for (let turn = 0; turn < turns.length; turn++) {
      await main.evaluate((turn) => window.__streamProbe.arm(turn), turn);
      await main.evaluate(
        ({ threadId, turn }) =>
          window.__pipperArchitectureStore
            .getState()
            .sendPrompt({ threadId, message: `Stream turn ${turn}` }),
        { threadId: thread.id, turn },
      );
      try {
        await main.waitForFunction(
          (expected) => window.__streamProbe.idle(expected),
          turns[turn].messageChunks,
          { timeout: 60000 },
        );
      } catch (error) {
        const state = await main.evaluate(() => ({
          received: window.__streamProbe.recv.size,
          painted: window.__streamProbe.paint.size,
          frames: window.__streamProbe.frames.length,
          hiddenDuringTurn: window.__streamProbe.hiddenDuringTurn,
          visibility: document.visibilityState,
          hasFocus: document.hasFocus(),
          isStreaming: window.__pipperArchitectureStore.getState().state?.isStreaming,
          entries: window.__pipperArchitectureStore.getState().state?.entries.length,
        }));
        throw new Error(`Turn ${turn} did not settle: ${JSON.stringify(state)}`, { cause: error });
      }
      await main.waitForTimeout(200);
      const summary = await main.evaluate(() => window.__streamProbe.summary());
      if (turn > 0) results.push({ schedule: SCHEDULES[turn - 1].name, ...summary });
    }
    return results;
  } finally {
    await app.close();
  }
}

const report = {
  capturedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  chunksPerTurn: chunks,
  schedules: SCHEDULES,
  limitations:
    "Disposable instrumented builds (react-dom/profiling, probe hooks). Real Electron/IPC/ACP transport from the local mock agent; one displayed thread that grows by one mixed turn per schedule. Receive time is taken at the renderer bridge handler, so main-process and IPC latency are excluded. Paint time is a task posted from requestAnimationFrame, which runs after that frame's rendering steps; compositor presentation is later. Thought chunks are not timed.",
  variants: values.ref,
  runs: [],
};
try {
  const mirrors = values.ref.map((ref, i) => buildVariant(ref, i));
  for (let round = 0; round < rounds; round++) {
    const order = values.ref.map((_, i) => i);
    if (round % 2 === 1) order.reverse();
    for (const i of order) {
      console.log(`Round ${round + 1}/${rounds}: ${values.ref[i]}`);
      const results = await runOnce(mirrors[i], `v${i}`, round);
      report.runs.push({ round: round + 1, ref: values.ref[i], results });
      for (const r of results)
        console.log(
          `  ${r.schedule.padEnd(13)} notify ${r.storeNotifications} commits ${r.reactCommits} render ${r.reactRenderMs.toFixed(0)}ms paint p50 ${r.receiveToPaintMs.p50.toFixed(1)} p95 ${r.receiveToPaintMs.p95.toFixed(1)} max ${r.receiveToPaintMs.max.toFixed(1)} frames>33ms ${r.framesOver33ms} longtasks ${r.longTasks}`,
        );
    }
  }
  if (values.output) {
    mkdirSync(dirname(resolve(values.output)), { recursive: true });
    writeFileSync(resolve(values.output), JSON.stringify(report, null, 2));
  } else console.log(JSON.stringify(report, null, 2));
} finally {
  if (!values.keep) rmSync(root, { recursive: true, force: true });
}
