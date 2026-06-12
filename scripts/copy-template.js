import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

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
  "public"
];

console.log("[Build] Copying guest template files to app-template...");
for (const file of filesToCopy) {
  const srcPath = join(srcDir, file);
  const destPath = join(destDir, file);
  if (existsSync(srcPath)) {
    cpSync(srcPath, destPath, { recursive: true });
    console.log(` - Copied ${file}`);
  } else {
    console.warn(` - Warning: ${file} not found!`);
  }
}

console.log("[Build] Template preparation complete!");
