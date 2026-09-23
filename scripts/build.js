import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const loadedEnv = loadEnv("production", root, "");

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

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

buildMacSleeplessHelpers();

// Release builds must fail loud: a packaged app without a PostHog key silently
// drops every event. Local builds may still run without analytics.
// loadEnv keeps local .env builds working; process.env takes precedence in CI.
const posthogKey = firstNonEmpty(
  process.env.VITE_POSTHOG_KEY,
  process.env.PIPPER_POSTHOG_KEY,
  loadedEnv.VITE_POSTHOG_KEY,
  loadedEnv.PIPPER_POSTHOG_KEY,
);
const posthogHost =
  firstNonEmpty(
    process.env.VITE_POSTHOG_HOST,
    process.env.PIPPER_POSTHOG_HOST,
    loadedEnv.VITE_POSTHOG_HOST,
    loadedEnv.PIPPER_POSTHOG_HOST,
  ) ?? "https://us.i.posthog.com";
if (!posthogKey) {
  const message =
    "[build] missing PostHog key. Set VITE_POSTHOG_KEY/PIPPER_POSTHOG_KEY " +
    "in CI or .env before building a release.";
  if (process.env.CI === "true" || process.env.PIPPER_REQUIRE_POSTHOG_CONFIG === "true") {
    console.error(`[build] ERROR: ${message}`);
    process.exit(1);
  }
  console.warn(`[build] WARNING: ${message}`);
} else {
  console.log("[build] PostHog key present; analytics will be baked in.");
}
// Electron Vite only exposes VITE_* values through import.meta.env. Map the
// accepted PIPPER_* aliases before spawning it so validation and the bundle
// always use the same resolved configuration.
if (posthogKey) process.env.VITE_POSTHOG_KEY = posthogKey;
process.env.VITE_POSTHOG_HOST = posthogHost;
console.log(`[build] PostHog host: ${posthogHost}`);
// Morning Brief integrations. Optional at build time: without them the brief
// shows its setup page and users can paste keys in Settings → Morning Brief.
for (const [target, aliases] of [
  ["VITE_PIPPER_COMPOSIO_API_KEY", ["PIPPER_COMPOSIO_API_KEY", "COMPOSIO_API_KEY"]],
  ["VITE_PIPPER_TYPESAFE_API_KEY", ["PIPPER_TYPESAFE_API_KEY", "TYPESAFE_API_KEY"]],
]) {
  const value = firstNonEmpty(
    process.env[target],
    ...aliases.map((name) => process.env[name]),
    loadedEnv[target],
    ...aliases.map((name) => loadedEnv[name]),
  );
  if (value) {
    process.env[target] = value;
    console.log(`[build] ${target} present; Morning Brief default key will be baked in.`);
  } else {
    console.warn(`[build] ${target} not set; Morning Brief will ask for a key at runtime.`);
  }
}
run(["electron-vite", "build"]);
