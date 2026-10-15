// Verify monitor worker delivery through the actual built application.
import { createHash } from "node:crypto";
import { _electron } from "playwright";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  cpSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
const cwd = process.cwd();
const root = mkdtempSync(join(tmpdir(), "pipper-monitor-worker-check-"));
let app;
try {
  const project = join(root, "project");
  mkdirSync(project);
  writeFileSync(join(project, "README.md"), "Isolated monitor worker check\n");
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
  writeFileSync(
    join(registry, "config.json"),
    JSON.stringify({
      agents: [
        {
          id: "pipper-mock",
          name: "pipper-mock",
          displayName: "Local mock",
          command: "node",
          args: [],
          installKind: "mock",
        },
      ],
      defaultAgentId: "pipper-mock",
    }),
  );
  const env = {
    ...process.env,
    PIPPER_BENCHMARK_MODE: "1",
    PIPPER_DEV_USER_DATA_PATH: join(root, "userdata"),
    PIPPER_LIBRARY_PATH: join(root, "library"),
    PIPPER_WORKTREES_PATH: join(root, "worktrees"),
    PIPPER_BENCHMARK_PROJECT_PATH: project,
    PIPPER_REMOTE_ENABLED: "0",
    ANALYTICS_ENABLED: "false",
    PIPPER_MONITOR: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({
    args: [join(cwd, "out/main/index.js")],
    cwd: root,
    env,
    timeout: 30000,
  });
  const main = await app.firstWindow();
  await main.waitForFunction(() => Boolean(window.omni?.monitor));
  await main.waitForTimeout(2500);
  const live = await main.evaluate(() => window.omni.monitor.getLive());
  const built = readFileSync(join(cwd, "out/main/index.js"), "utf8");
  const report = {
    builtMainSha256: createHash("sha256").update(built).digest("hex"),
    capturedAt: new Date().toISOString(),
    scope:
      "Actual previously built Electron app with isolated user data, local mock registry and temporary Git repository. No application source edits or source instrumentation. This checks that the emitted worker starts (no main-thread fallback), not CPU overhead.",
    builtWorkerReference: built.includes("./monitor-worker.js"),
    resolvedWorkerExists: existsSync(join(cwd, "out/main/monitor-worker.js")),
    live,
  };
  const reportPath = join(cwd, "docs/architecture/opencode/monitor-worker-verification.json");
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  if (!live?.pipelineTelemetry || live.recentTicks.length === 0)
    throw new Error("Monitor did not produce observable health and samples");
  if (live.pipelineTelemetry.workerMode !== "worker" || live.pipelineTelemetry.workerFailures > 0)
    throw new Error(`Monitor worker did not start: ${live.pipelineTelemetry.lastError}`);
  console.log(
    JSON.stringify(
      {
        workerPathPresent: report.resolvedWorkerExists,
        health: live.pipelineTelemetry,
        sampleTicks: live.recentTicks.length,
      },
      null,
      2,
    ),
  );
} finally {
  if (app) await app.close();
  rmSync(root, { recursive: true, force: true });
}
