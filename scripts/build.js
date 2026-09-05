import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function run(args) {
  const result = spawnSync("bun", ["x", "--bun", ...args], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function buildMacSleeplessHelpers() {
  if (process.platform !== "darwin") return;
  const source = join(root, "native", "sleepless");
  const output = join(source, "dist");
  mkdirSync(output, { recursive: true });
  const common = [
    "--sdk",
    "macosx",
    "clang",
    "-O2",
    "-fobjc-arc",
    "-arch",
    "arm64",
    "-mmacosx-version-min=13.0",
  ];
  runCommand("xcrun", [
    ...common,
    "-framework",
    "IOKit",
    "-framework",
    "Security",
    "-framework",
    "Foundation",
    join(source, "daemon", "main.m"),
    "-o",
    join(output, "omni-sleeplessd"),
  ]);
  runCommand("xcrun", [
    ...common,
    "-framework",
    "Security",
    "-framework",
    "Foundation",
    join(source, "control", "main.m"),
    "-o",
    join(output, "omni-sleeplessctl"),
  ]);

  for (const helper of ["omni-sleeplessd", "omni-sleeplessctl"]) {
    const helperPath = join(output, helper);
    if (!existsSync(helperPath)) {
      throw new Error(`Sleepless helper build did not produce ${helperPath}`);
    }
  }
}

function buildPipperIntents() {
  if (process.platform !== "darwin") return;
  const intentsDir = join(root, "native", "pipper-intents");
  if (!existsSync(join(intentsDir, "Package.swift"))) return;
  const result = spawnSync("swift", ["build", "--disable-sandbox"], {
    cwd: intentsDir,
    stdio: "inherit",
  });
  if (result.error) {
    console.warn("[build] swift not available, skipping PipperIntents:", result.error.message);
    return;
  }
  if (result.status !== 0) {
    throw new Error(`[build] PipperIntents swift build failed with exit code ${result.status}`);
  }
}

buildMacSleeplessHelpers();
buildPipperIntents();
run(["electron-vite", "build"]);
