import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

function run(args) {
  const result = spawnSync("bun", ["x", "--bun", ...args], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (existsSync("electron/main.ts")) {
  run(["electron-vite", "build"]);
  const copy = spawnSync(process.execPath, ["scripts/copy-template.js"], { stdio: "inherit" });
  if (copy.error) throw copy.error;
  if (copy.status !== 0) process.exit(copy.status ?? 1);
} else {
  run(["vite", "build"]);
}
