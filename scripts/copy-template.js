import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

const srcDir = process.cwd();
const destDir = join(srcDir, "app-template");

console.log("[Build] Cleaning old app-template...");
if (existsSync(destDir)) {
  rmSync(destDir, { recursive: true, force: true });
}
mkdirSync(destDir, { recursive: true });

const filesToCopy = [
  "package.json",
  "vite.config.ts",
  "components.json",
  "index.html",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "tsconfig.electron.json",
  "src",
  "@",
  "contracts",
  "public",
  "scripts/build.js",
  "patch.md",
  "AGENT.md",
  "DESIGN.md",
];

console.log("[Build] Copying guest template files to app-template...");
for (const file of filesToCopy) {
  const srcPath = join(srcDir, file);
  const destPath = join(destDir, file);
  if (existsSync(srcPath)) {
    mkdirSync(dirname(destPath), { recursive: true });
    cpSync(srcPath, destPath, { recursive: true });
    console.log(` - Copied ${file}`);
  } else {
    console.warn(` - Warning: ${file} not found!`);
  }
}

try {
  const packageJson = JSON.parse(readFileSync(join(srcDir, "package.json"), "utf8"));
  const officialBaseCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: srcDir,
    encoding: "utf8",
  }).trim();
  writeFileSync(
    join(destDir, "installation.json"),
    `${JSON.stringify(
      {
        installed_version: packageJson.version,
        official_base_commit: officialBaseCommit,
      },
      null,
      2,
    )}\n`,
  );
  console.log(" - Generated installation.json");
} catch (error) {
  console.warn(` - Warning: could not generate installation metadata: ${error}`);
}

console.log("[Build] Template preparation complete!");
