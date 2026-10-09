import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
const outDirectory = join(root, "out");

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

function run(args) {
  const result = spawnSync("bun", ["x", ...args], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`posthog-cli ${args.join(" ")} exited with status ${result.status}`);
  }
}

// The CLI talks to the PostHog *app* host, which differs from the ingestion
// host baked into the bundle (e.g. us.i.posthog.com). Derive it from the same
// region signal the build uses, and allow an explicit override.
function resolveHost() {
  const configured = firstNonEmpty(
    process.env.POSTHOG_CLI_HOST,
    process.env.PIPPER_POSTHOG_CLI_HOST,
  );
  if (configured) return configured;
  const ingestion =
    firstNonEmpty(process.env.VITE_POSTHOG_HOST, process.env.PIPPER_POSTHOG_HOST) ?? "";
  return ingestion.includes("eu") ? "https://eu.posthog.com" : "https://us.posthog.com";
}

function main() {
  if (!existsSync(join(outDirectory, "main"))) {
    console.log("[sourcemaps] No out/ build found; run `bun run build` first. Skipping.");
    return;
  }

  const apiKey = firstNonEmpty(process.env.POSTHOG_CLI_API_KEY);
  const projectId = firstNonEmpty(process.env.POSTHOG_CLI_PROJECT_ID);
  const host = resolveHost();
  const cliVersion = firstNonEmpty(process.env.POSTHOG_CLI_VERSION);
  const cliPackage = cliVersion ? `@posthog/cli@${cliVersion}` : "@posthog/cli";
  const strict = process.env.PIPPER_REQUIRE_POSTHOG_SOURCEMAPS === "true";

  if (!apiKey || !projectId) {
    const message =
      "[sourcemaps] POSTHOG_CLI_API_KEY/POSTHOG_CLI_PROJECT_ID are not set; skipping upload.";
    if (strict) {
      console.error(`${message} Set them, or unset PIPPER_REQUIRE_POSTHOG_SOURCEMAPS.`);
      process.exit(1);
    }
    console.warn(`${message} Shipped stack traces will stay minified.`);
    return;
  }

  // The sourcemap commands authenticate and target a project through these.
  process.env.POSTHOG_CLI_HOST = host;
  process.env.POSTHOG_CLI_API_KEY = apiKey;
  process.env.POSTHOG_CLI_PROJECT_ID = projectId;

  // inject stamps a chunkId into each minified chunk and its hidden map so
  // PostHog can match runtime frames back to the release's symbols. It must run
  // before packaging so the shipped chunks carry the injected id.
  console.log(`[sourcemaps] Injecting release context into ${outDirectory} (host ${host}).`);
  run([cliPackage, "sourcemap", "inject", "--directory", outDirectory]);

  console.log(`[sourcemaps] Uploading ${packageJson.name}@${packageJson.version}.`);
  run([
    cliPackage,
    "sourcemap",
    "upload",
    "--directory",
    outDirectory,
    "--release-name",
    packageJson.name,
    "--release-version",
    packageJson.version,
    // Delete the .map files once uploaded: they must never be packaged.
    "--delete-after",
  ]);
  console.log("[sourcemaps] Upload complete; local .map files removed.");
}

try {
  main();
} catch (error) {
  console.error(`[sourcemaps] ${error.message}`);
  process.exitCode = 1;
}
