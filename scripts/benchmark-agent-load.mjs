import { _electron } from "playwright";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { processTree, measureDirectory } from "./audit-resources.mjs";

const { values } = parseArgs({
  options: {
    "app-root": { type: "string", default: process.cwd() },
    "check-settings": { type: "boolean", default: false },
    agents: { type: "string", default: "8" },
    output: { type: "string", default: "docs/performance/agent-load.json" },
  },
});
const count = Number(values.agents);
if (!Number.isSafeInteger(count) || count < 1 || count > 32)
  throw new Error("--agents must be 1–32");
const cwd = process.cwd();
const appRoot = resolve(values["app-root"]);
const root = mkdtempSync(join(tmpdir(), "pipper-agent-load-"));
let app;
try {
  const project = join(root, "project");
  mkdirSync(project);
  writeFileSync(join(project, "README.md"), "Resource benchmark fixture\n");
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
  const registry = join(root, "electron/agents");
  mkdirSync(registry, { recursive: true });
  cpSync(join(cwd, "electron/agents/mock-agent.mjs"), join(registry, "mock-agent.mjs"));
  const agents = Array.from({ length: count }, (_, index) => ({
    id: index === 0 ? "pipper-mock" : `resource-mock-${index}`,
    name: `resource-mock-${index}`,
    displayName: `Resource mock ${index + 1}`,
    command: "node",
    args: [],
    installKind: "mock",
  }));
  writeFileSync(
    join(registry, "config.json"),
    JSON.stringify({ agents, defaultAgentId: "pipper-mock" }),
  );
  const fixture = join(root, "turns.jsonl");
  const lines = [];
  const source = readFileSync(join(cwd, "src/lib/tool-call-payload.ts"), "utf8");
  for (let turn = 0; turn < 4; turn++) {
    lines.push(JSON.stringify({ kind: "turn", index: turn }));
    for (const update of [
      { sessionUpdate: "user_message_chunk", content: { type: "text", text: `Turn ${turn}` } },
      {
        sessionUpdate: "tool_call",
        toolCallId: `read-${turn}`,
        title: "Read fixture",
        kind: "read",
        status: "completed",
        rawOutput: randomBytes(384 * 1024).toString("base64"),
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: `Turn ${turn} complete.\n\n\`\`\`typescript\n${source}\n\`\`\``,
        },
      },
    ])
      lines.push(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: "fixture", update },
        }),
      );
  }
  writeFileSync(fixture, `${lines.join("\n")}\n`);
  const env = {
    ...process.env,
    PIPPER_BENCHMARK_MODE: "1",
    PIPPER_DEV_USER_DATA_PATH: join(root, "userdata"),
    PIPPER_LIBRARY_PATH: join(root, "library"),
    PIPPER_WORKTREES_PATH: join(root, "worktrees"),
    PIPPER_BENCHMARK_PROJECT_PATH: project,
    PIPPER_BENCHMARK_FIXTURE: fixture,
    PIPPER_REMOTE_ENABLED: "0",
    ANALYTICS_ENABLED: "false",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const started = performance.now();
  app = await _electron.launch({
    args: [join(appRoot, "out/main/index.js")],
    cwd: root,
    env,
    timeout: 30_000,
  });
  const main = await app.firstWindow();
  await main.waitForFunction(() => Boolean(window.omni?.agent && window.omni?.projects), {
    timeout: 30_000,
  });
  const projectId = await main.evaluate(async () => (await window.omni.projects.getActive())?.id);
  if (!projectId) throw new Error("No benchmark project activated");
  const stages = [
    { name: "startup", elapsedMs: performance.now() - started, ...processTree(app.process().pid) },
  ];
  const threads = [];
  for (const agent of agents) {
    threads.push(
      await main.evaluate(
        async ({ projectId, agentId }) => {
          const workspace = await window.omni.worktrees.create({ projectId, name: agentId });
          const thread = await window.omni.agent.createThread(
            projectId,
            agentId,
            null,
            agentId,
            workspace.path,
          );
          await window.omni.tabs.open(thread.id);
          return thread;
        },
        { projectId, agentId: agent.id },
      ),
    );
  }
  stages.push({ name: "agents-ready", ...processTree(app.process().pid) });
  for (let turn = 0; turn < 4; turn++) {
    await main.evaluate(
      async ({ ids, turn }) => {
        await Promise.all(
          ids.map((threadId) =>
            window.omni.agent.sendPrompt({ threadId, message: `Workload turn ${turn}` }),
          ),
        );
      },
      { ids: threads.map((thread) => thread.id), turn },
    );
    stages.push({ name: `turn-${turn + 1}-settled`, ...processTree(app.process().pid) });
  }
  // The app debounces snapshot writes by 2s. This is outside turn timings.
  await main.waitForTimeout(3000);
  const hydrated = await main.evaluate(async (threads) => {
    const result = [];
    for (const thread of threads) {
      const calls = await window.omni.agent.getToolCalls(thread.id);
      result.push({
        threadId: thread.id,
        tools: Object.keys(calls).length,
        payloads: Object.values(calls).filter((call) => call.rawOutput !== undefined).length,
      });
    }
    return result;
  }, threads);
  if (hydrated.some((item) => item.tools !== 4 || item.payloads !== 4))
    throw new Error(`Incomplete tool history: ${JSON.stringify(hydrated)}`);
  stages.push({ name: "persisted-payloads-expanded", ...processTree(app.process().pid) });
  let settingsVerified = false;
  let automaticInstallSkipped = false;
  if (values["check-settings"]) {
    const opened = app.waitForEvent("window");
    await app.evaluate(({ Menu }) => {
      const find = (items) => {
        for (const item of items) {
          if (item.label === "Settings…") return item;
          const child = item.submenu && find(item.submenu.items);
          if (child) return child;
        }
      };
      const settings = find(Menu.getApplicationMenu().items);
      if (!settings) throw new Error("Settings menu not found");
      settings.click();
    });
    const settings = await opened;
    await settings.getByRole("button", { name: "Storage", exact: true }).click();
    const toggle = settings
      .locator('[data-pipper-id="settings-worktree-auto-install"]')
      .getByRole("switch");
    await toggle.waitFor();
    await toggle.click();
    await settings.waitForFunction(
      async () => (await window.omni.worktrees.getAutoInstall()) === false,
    );
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({ name: "install-fixture", version: "1.0.0", private: true }),
    );
    execFileSync("git", ["-C", project, "add", "package.json"]);
    execFileSync("git", [
      "-C",
      project,
      "-c",
      "user.name=Benchmark",
      "-c",
      "user.email=benchmark@localhost",
      "commit",
      "-qm",
      "Node workspace fixture",
    ]);
    const skipped = await main.evaluate(async (projectId) => {
      const progress = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          off();
          reject(new Error("No install progress"));
        }, 10_000);
        const off = window.omni.worktrees.onSetupProgress((event) => {
          if (event.workspaceName !== "no-install-check") return;
          clearTimeout(timeout);
          off();
          resolve(event);
        });
      });
      const workspace = await window.omni.worktrees.create({ projectId, name: "no-install-check" });
      return { workspace, progress: await progress };
    }, projectId);
    if (
      skipped.progress.status !== "skipped" ||
      skipped.progress.manager !== "npm" ||
      existsSync(join(skipped.workspace.path, "package-lock.json")) ||
      existsSync(join(skipped.workspace.path, "node_modules"))
    )
      throw new Error("Automatic install opt-out was not honored");
    automaticInstallSkipped = true;
    await main.evaluate(
      async ({ projectId, path }) => window.omni.worktrees.delete({ projectId, path }),
      { projectId, path: skipped.workspace.path },
    );
    await settings.locator('[data-pipper-id="settings-compact-database"]').click();
    await settings.getByRole("status").filter({ hasText: "reclaimed" }).waitFor();
    settingsVerified = true;
    mkdirSync(join(cwd, ".tmp-check"), { recursive: true });
    await settings.screenshot({ path: join(cwd, ".tmp-check/storage-settings.png") });
  }
  const report = {
    capturedAt: new Date().toISOString(),
    buildSha256: createHash("sha256")
      .update(readFileSync(join(appRoot, "out/main/index.js")))
      .digest("hex"),
    agents: count,
    worktrees: threads.length,
    turnsPerAgent: 4,
    agentType:
      "real mock ACP processes; these measurements do not represent Codex/Claude CLI memory",
    stages,
    settingsVerified,
    automaticInstallSkipped,
    hydrated,
    disk: [
      await measureDirectory(join(root, "userdata")),
      await measureDirectory(join(root, "worktrees")),
    ],
  };
  writeFileSync(resolve(values.output), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      stages.map(({ name, summedRssBytes, processes }) => ({
        name,
        summedRssBytes,
        processes: processes.length,
      })),
      null,
      2,
    ),
  );
} finally {
  if (app) await app.close();
  rmSync(root, { recursive: true, force: true });
}
