import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

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
  const project = join(intentsDir, "PreviewApp", "PipperIntentsPreview.xcodeproj");
  if (!existsSync(project)) return;
  const output = join(intentsDir, "dist");
  mkdirSync(output, { recursive: true });
  const developerCandidates = [
    join(os.homedir(), "Downloads", "Xcode-beta.app", "Contents", "Developer"),
    "/Applications/Xcode-beta.app/Contents/Developer",
  ];
  const developerDir = developerCandidates.find((candidate) => existsSync(candidate));
  const env = developerDir ? { ...process.env, DEVELOPER_DIR: developerDir } : process.env;
  const result = spawnSync(
    "xcodebuild",
    [
      "-project",
      project,
      "-target",
      "PipperIntents",
      "-configuration",
      "Release",
      `CONFIGURATION_BUILD_DIR=${output}`,
      "PRODUCT_BUNDLE_IDENTIFIER=com.maker-or.omni.PipperIntents",
      "CODE_SIGNING_ALLOWED=NO",
      "build",
    ],
    {
      cwd: root,
      env,
      stdio: "inherit",
    },
  );
  if (result.error) {
    throw new Error(`[build] xcodebuild is required for PipperIntents: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`[build] PipperIntents extension build failed with exit code ${result.status}`);
  }
  const extension = join(output, "PipperIntents.appex");
  if (!existsSync(extension)) {
    throw new Error(`[build] PipperIntents extension build did not produce ${extension}`);
  }
}

buildMacSleeplessHelpers();
buildPipperIntents();

// Fail loud: the PostHog key must be present in the build environment
// (VITE_POSTHOG_KEY secret in CI, .env locally) or the shipped app will
// silently capture zero analytics events.
if (!process.env.VITE_POSTHOG_KEY && !process.env.PIPPER_POSTHOG_KEY) {
  console.warn(
    "[build] WARNING: no VITE_POSTHOG_KEY/PIPPER_POSTHOG_KEY in the build environment. " +
      "The packaged app will not report analytics.",
  );
} else {
  console.log("[build] PostHog key present; analytics will be baked in.");
}
console.log(
  `[build] PostHog host: ${process.env.VITE_POSTHOG_HOST ?? process.env.PIPPER_POSTHOG_HOST ?? "https://us.i.posthog.com (default)"}`,
);
run(["electron-vite", "build"]);
