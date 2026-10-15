import { _electron } from "playwright";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { installArchitectureProbe } from "./architecture-probe-runtime.mjs";
import { processTree } from "./audit-resources.mjs";

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "3" },
    output: { type: "string", default: "docs/architecture/workflow-measurements.json" },
  },
});
const runs = Number(values.runs);
if (!Number.isSafeInteger(runs) || runs < 1 || runs > 10) throw new Error("--runs must be 1–10");
const cwd = process.cwd();
const root = mkdtempSync(join(tmpdir(), "pipper-architecture-"));
const report = {
  capturedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  baselineCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  instrumented: true,
  limitations:
    "Disposable build of current working tree. Real Electron/IPC/Git/SQLite/ACP transport; local mock provider, no network or customer repository. Instrumentation adds overhead. Method spans are inclusive and overlap; do not sum them. Renderer IPC completion is not painted UI. Monitoring enabled unless run says otherwise. Controlled initialization delay only demonstrates queue blocking.",
  runs: [],
};
let app;
try {
  const mirror = join(root, "source");
  mkdirSync(mirror);
  const archive = execFileSync("git", ["archive", "HEAD"], { maxBuffer: 100 * 1024 * 1024 });
  const extracted = spawnSync("tar", ["-xf", "-", "-C", mirror], { input: archive });
  if (extracted.status !== 0) throw new Error("Cannot extract source mirror");
  const changed = execFileSync("git", ["diff", "--name-only", "-z"], { encoding: "utf8" }).split(
    "\0",
  );
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    encoding: "utf8",
  }).split("\0");
  for (const file of new Set([...changed, ...untracked])) {
    if (!file || /^(docs\/|\.tmp-check\/)/.test(file)) continue;
    mkdirSync(dirname(join(mirror, file)), { recursive: true });
    cpSync(join(cwd, file), join(mirror, file));
  }
  symlinkSync(join(cwd, "node_modules"), join(mirror, "node_modules"), "dir");
  const mainPath = join(mirror, "electron/main.ts");
  writeFileSync(
    mainPath,
    readFileSync(mainPath, "utf8") +
      `\n// Disposable architecture measurement exposure; never part of application source.\nimport __architectureCP from "node:child_process";\nimport __architectureFsp from "node:fs/promises";\nimport {syncBuiltinESMExports as __architectureSync} from "node:module";\nimport {AsyncLocalStorage as __architectureALS} from "node:async_hooks";\nglobalThis.__pipperArchitecture = {getManager:()=>agentManager,getDb:()=>getDb(),setSelectedAgentIds,fs,fsp:__architectureFsp,cp:__architectureCP,syncBuiltinESMExports:__architectureSync,AsyncLocalStorage:__architectureALS,setVisible:(visible)=>{windowVisibilityGate.setWindowVisible(visible);windowVisibilityGate.setRendererVisible(visible);}};\n`,
  );
  const rendererPath = join(mirror, "src/main.tsx");
  writeFileSync(
    rendererPath,
    readFileSync(rendererPath, "utf8") +
      '\nimport {useAgentStore as __archStore} from "./store/agent-store";\nwindow.__pipperArchitectureStore=__archStore;\n',
  );
  console.log("Building disposable instrumented app");
  const build = spawnSync("bun", ["x", "--bun", "electron-vite", "build"], {
    cwd: mirror,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (build.status !== 0) throw new Error(build.stdout + build.stderr);
  for (let run = 0; run < runs; run++) {
    const fixtureRoot = join(root, `run-${run}`);
    mkdirSync(fixtureRoot);
    const project = join(fixtureRoot, "project");
    mkdirSync(project);
    writeFileSync(join(project, "README.md"), "Architecture workload\n");
    execFileSync("git", ["init", "-b", "main", project]);
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
    const mock = readFileSync(join(cwd, "electron/agents/mock-agent.mjs"), "utf8").replace(
      "function handleRequest(msg) {",
      'async function handleRequest(msg) {\n if(msg.method === "initialize" && process.env.PIPPER_PROBE_INIT_DELAY_MS) await sleep(Number(process.env.PIPPER_PROBE_INIT_DELAY_MS));',
    );
    writeFileSync(join(registry, "mock-agent.mjs"), mock);
    const agents = Array.from({ length: 8 }, (_, i) => ({
      id: i === 0 ? "pipper-mock" : `architecture-mock-${i}`,
      name: `architecture-mock-${i}`,
      displayName: `Architecture mock ${i}`,
      command: "node",
      args: [],
      installKind: "mock",
    }));
    agents.push({
      id: "architecture-slow",
      name: "architecture-slow",
      displayName: "Controlled slow mock",
      command: "node",
      args: [],
      installKind: "mock",
      env: { PIPPER_PROBE_INIT_DELAY_MS: "400" },
    });
    writeFileSync(
      join(registry, "config.json"),
      JSON.stringify({ agents, defaultAgentId: "pipper-mock" }),
    );
    const fixture = join(fixtureRoot, "turns.jsonl");
    const updates = [
      { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Probe prompt" } },
      ...Array.from({ length: 80 }, (_, i) => ({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `Chunk ${i}. ` },
      })),
      {
        sessionUpdate: "tool_call",
        toolCallId: "probe-tool",
        title: "Read fixture",
        kind: "read",
        status: "completed",
        rawOutput: "payload".repeat(16384),
      },
    ];
    writeFileSync(
      fixture,
      updates
        .map((update) =>
          JSON.stringify({
            jsonrpc: "2.0",
            method: "session/update",
            params: { sessionId: "fixture", update },
          }),
        )
        .join("\n") + "\n",
    );
    const env = {
      ...process.env,
      PIPPER_BENCHMARK_MODE: "1",
      PIPPER_DEV_USER_DATA_PATH: join(fixtureRoot, "userdata"),
      PIPPER_LIBRARY_PATH: join(fixtureRoot, "library"),
      PIPPER_WORKTREES_PATH: join(fixtureRoot, "worktrees"),
      PIPPER_BENCHMARK_PROJECT_PATH: project,
      PIPPER_BENCHMARK_FIXTURE: fixture,
      PIPPER_REMOTE_ENABLED: "0",
      ANALYTICS_ENABLED: "false",
      PIPPER_MONITOR: run % 2 === 0 ? "1" : "0",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    console.log(`Workflow run ${run + 1}/${runs}, monitor ${env.PIPPER_MONITOR}`);
    const started = performance.now();
    app = await _electron.launch({
      args: [join(mirror, "out/main/index.js")],
      cwd: fixtureRoot,
      env,
      timeout: 30000,
    });
    const main = await app.firstWindow();
    await main.waitForFunction(() => Boolean(window.omni?.agent));
    const projectId = await main.evaluate(async () => (await window.omni.projects.getActive())?.id);
    if (!projectId) throw new Error("Missing fixture project");
    await main.waitForTimeout(1200);
    await app.evaluate((_electron, source) => {
      // oxlint-disable-next-line no-eval -- Execute only our serialized local probe in the disposable Electron process.
      globalThis.__archProbe = (0, eval)(`(${source})`)(globalThis.__pipperArchitecture);
    }, installArchitectureProbe.toString());
    const startupToFixtureMs = performance.now() - started;
    const stages = [];
    const stage = async (name, fn) => {
      console.log(`  ${name}`);
      const mainStarted = await app.evaluate(
        (_electron, name) => globalThis.__archProbe.begin(name),
        name,
      );
      const t = performance.now();
      const value = await fn();
      const elapsedMs = performance.now() - t;
      await app.evaluate(() => globalThis.__archProbe.end());
      stages.push({ name, elapsedMs, mainStarted });
      return value;
    };
    const create = (agentId, title) =>
      main.evaluate(
        ({ projectId, agentId, title }) =>
          window.omni.agent.createThread(projectId, title, null, agentId, null),
        { projectId, agentId, title },
      );
    await stage("cold-provider-thread", () => create("architecture-mock-1", "Cold provider"));
    const first = await stage("first-thread-warm-provider", () => create("pipper-mock", "First"));
    await stage("renderer-store-create", () =>
      main.evaluate(
        (projectId) =>
          window.__pipperArchitectureStore
            .getState()
            .createThread(projectId, "Renderer store", null, "pipper-mock", null),
        projectId,
      ),
    );
    const second = await stage("warm-same-agent-create", () => create("pipper-mock", "Second"));
    const documentVisibility = await main.evaluate(() => document.visibilityState);
    // Explicitly select the production gate path; OS occlusion is otherwise nondeterministic.
    await app.evaluate(() => globalThis.__pipperArchitecture.setVisible(true));
    await stage("background-prompt", () =>
      main.evaluate(
        (threadId) => window.omni.agent.sendPrompt({ threadId, message: "Probe prompt" }),
        first.id,
      ),
    );
    await stage("active-prompt", () =>
      main.evaluate(
        (threadId) => window.omni.agent.sendPrompt({ threadId, message: "Active probe prompt" }),
        second.id,
      ),
    );
    await stage("snapshot-settle", async () => {
      await main.waitForTimeout(2300);
      await app.evaluate(
        async (_electron, id) => globalThis.__archProbe.manager.flushThreadSnapshot(id),
        first.id,
      );
    });
    await stage("resident-switches-10", async () => {
      for (let i = 0; i < 10; i++)
        await main.evaluate(
          (id) => window.omni.agent.switchThread(id),
          i % 2 === 0 ? first.id : second.id,
        );
    });
    await stage("close-persisted-thread", () =>
      app.evaluate(
        async (_electron, id) => globalThis.__archProbe.manager.closeThreadSession(id),
        first.id,
      ),
    );
    await stage("restore-persisted-thread", () =>
      main.evaluate((id) => window.omni.agent.switchThread(id), first.id),
    );
    const hydrated = await stage("hydrate-tool", () =>
      main.evaluate((id) => window.omni.agent.getToolCalls(id), first.id),
    );
    if (hydrated["probe-tool"]?.rawOutput !== "payload".repeat(16384))
      throw new Error("Persisted tool payload did not survive restore");
    await stage("create-worktree", () =>
      main.evaluate(
        (projectId) => window.omni.worktrees.create({ projectId, name: "architecture-worktree" }),
        projectId,
      ),
    );
    await stage("background-create-blocks-switch", () =>
      app.evaluate(
        async (_electron, { projectId, id }) => {
          const p = globalThis.__archProbe;
          const begin = performance.now();
          const slow = p.manager.createThread(
            projectId,
            "Controlled slow",
            null,
            "architecture-slow",
            null,
            null,
            { background: true },
          );
          await new Promise((r) => setTimeout(r, 20));
          const switching = performance.now();
          await p.manager.switchThread(id);
          const switched = performance.now();
          await slow;
          globalThis.__queueResult = {
            injectedInitializeDelayMs: 400,
            totalMs: performance.now() - begin,
            switchWaitMs: switched - switching,
          };
        },
        { projectId, id: first.id },
      ),
    );
    const queue = await app.evaluate(() => globalThis.__queueResult);
    await stage("close-all-sessions", () =>
      app.evaluate(async () => {
        const p = globalThis.__archProbe;
        for (const id of p.manager.sessions.keys()) await p.manager.closeThreadSession(id);
      }),
    );
    const beforeCatalog = await app.evaluate(() => globalThis.__archProbe.read());
    await stage("catalog-eight-agents", async () => {
      await app.evaluate(
        (_electron, ids) => globalThis.__archProbe.setSelectedAgentIds(ids),
        agents.slice(0, 8).map((a) => a.id),
      );
      await main.evaluate(() => window.omni.agent.getModelCatalogs());
    });
    const afterCatalog = await app.evaluate(() => globalThis.__archProbe.read());
    if (afterCatalog.residentSessions !== 0 || afterCatalog.connections.length !== 9)
      throw new Error("Catalog lifecycle measurement did not reach expected state");
    const catalogProcessTree = processTree(app.process().pid);
    await stage("catalog-repeat", () => main.evaluate(() => window.omni.agent.getModelCatalogs()));
    await stage("idle-ten-seconds", () => main.waitForTimeout(10000));
    const measurement = await app.evaluate(() => globalThis.__archProbe.read());
    const activeDeltas = measurement.totals
      .filter(
        (x) =>
          x.stage === "active-prompt" &&
          x.name === "IPC.send" &&
          x.detail === "agent:event:session-update",
      )
      .reduce((n, x) => n + x.calls, 0);
    if (activeDeltas !== 82)
      throw new Error(`Expected 82 visible active deltas, got ${activeDeltas}`);
    report.runs.push({
      run: run + 1,
      documentVisibility,
      visibilityGateForcedVisibleForPrompts: true,
      monitor: env.PIPPER_MONITOR === "1",
      startupToFixtureMs,
      stages,
      queue,
      beforeCatalog: {
        residentSessions: beforeCatalog.residentSessions,
        connections: beforeCatalog.connections,
        memory: beforeCatalog.memory,
      },
      afterCatalog: {
        residentSessions: afterCatalog.residentSessions,
        connections: afterCatalog.connections,
        memory: afterCatalog.memory,
      },
      catalogProcessTree,
      ...measurement,
    });
    await app.close();
    app = null;
    mkdirSync(dirname(resolve(values.output)), { recursive: true });
    writeFileSync(resolve(values.output), JSON.stringify(report, null, 2));
  }
  console.log(
    JSON.stringify(
      report.runs.map((r) => ({
        run: r.run,
        stages: r.stages,
        queue: r.queue,
        catalogConnections: r.afterCatalog.connections.length,
      })),
      null,
      2,
    ),
  );
} finally {
  if (app) await app.close();
  rmSync(root, { recursive: true, force: true });
}
