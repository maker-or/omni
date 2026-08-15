import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
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
    "ServiceManagement",
    "-framework",
    "Foundation",
    join(source, "control", "main.m"),
    "-o",
    join(output, "omni-sleeplessctl"),
  ]);
}

buildMacSleeplessHelpers();
run(["electron-vite", "build"]);
