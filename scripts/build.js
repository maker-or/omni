import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

function run(args) {
  const command = process.platform === "win32" ? "bunx.cmd" : "bunx";
  const result = spawnSync(command, ["--bun", ...args], { stdio: "inherit" });
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
