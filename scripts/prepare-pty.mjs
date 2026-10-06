import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/** Package installs can drop executable bits from node-pty's macOS launch helper. */
export function preparePtyHelpers(
  packageRoot = dirname(require.resolve("node-pty/package.json")),
  platform = process.platform,
) {
  if (platform !== "darwin") return;
  for (const directory of [
    "build/Release",
    "build/Debug",
    "prebuilds/darwin-arm64",
    "prebuilds/darwin-x64",
  ]) {
    const helper = join(packageRoot, directory, "spawn-helper");
    if (!existsSync(helper)) continue;
    const mode = statSync(helper).mode & 0o777;
    if ((mode & 0o111) !== 0o111) chmodSync(helper, mode | 0o111);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  preparePtyHelpers();
}
