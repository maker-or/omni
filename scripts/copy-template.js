import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const srcDir = process.cwd();
const destDir = join(srcDir, "app-template");

console.log("[Build] Cleaning old app-template...");
if (existsSync(destDir)) {
  rmSync(destDir, { recursive: true, force: true });
}
mkdirSync(destDir, { recursive: true });

const filesToCopy = [
  "package.json",
  ".gitignore",
  "vite.config.ts",
  "vitest.config.ts",
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
  const launcherVersion = packageJson.version;
  const workspaceVersion = packageJson.pipper?.workspaceVersion;
  if (!SEMVER.test(launcherVersion ?? "") || !SEMVER.test(workspaceVersion ?? "")) {
    throw new Error(
      "package.json launcher and pipper.workspaceVersion must be valid semantic versions",
    );
  }
  const templatePackage = { ...packageJson, version: workspaceVersion };
  delete templatePackage.pipper;
  writeFileSync(join(destDir, "package.json"), `${JSON.stringify(templatePackage, null, 2)}\n`);
  writeFileSync(
    join(destDir, "installation.json"),
    `${JSON.stringify(
      {
        installed_version: workspaceVersion,
      },
      null,
      2,
    )}\n`,
  );
  console.log(" - Generated installation.json");
} catch (error) {
  console.error(` - Failed to generate template version metadata: ${error}`);
  process.exit(1);
}

console.log("[Build] Template preparation complete!");
