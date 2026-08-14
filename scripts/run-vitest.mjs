import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sqliteFlag = "--experimental-sqlite";
const nodeOptions = process.env.NODE_OPTIONS?.includes(sqliteFlag)
  ? process.env.NODE_OPTIONS
  : [process.env.NODE_OPTIONS, sqliteFlag].filter(Boolean).join(" ");
const vitestEntry = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));

const result = spawnSync(process.execPath, [vitestEntry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
  },
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
