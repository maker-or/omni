import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Arch, Platform, build } from "electron-builder";

const require = createRequire(import.meta.url);
const { generateAssetCatalogForIcon } = require("app-builder-lib/out/util/macosIconComposer.js");

const root = fileURLToPath(new URL("..", import.meta.url));
const appBundle = join(root, "release", "mac-arm64", "Pipper Code (Alpha).app");
const previewDirectory = join(root, "release", "dmg-preview");
const lastMountFile = join(previewDirectory, "last-mount.txt");
const volumeName = "Pipper Installer Preview";
const mountPoint = join("/Volumes", volumeName);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

async function main() {
  if (process.platform !== "darwin") {
    throw new Error("DMG previews require macOS.");
  }
  if (!existsSync(join(appBundle, "Contents", "Info.plist"))) {
    throw new Error("Build the app once with `bun run dist` before previewing the DMG.");
  }

  const mountedImages = spawnSync("hdiutil", ["info", "-plist"], { encoding: "utf8" });
  if (mountedImages.error) throw mountedImages.error;
  if (mountedImages.status !== 0) throw new Error("Could not inspect mounted disk images.");
  const previousMount = existsSync(lastMountFile)
    ? readFileSync(lastMountFile, "utf8").trim()
    : join(previewDirectory, "mount");
  if (previousMount !== mountPoint && !previousMount.startsWith(`${previewDirectory}/mount`)) {
    throw new Error("Previous preview mount is outside the preview directory.");
  }
  const escapedMountPoint = previousMount
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (mountedImages.stdout.includes(`<string>${escapedMountPoint}</string>`)) {
    run("hdiutil", ["detach", previousMount]);
  }

  console.log("[DMG preview] Reusing the existing app bundle; rebuilding only the installer.");
  mkdirSync(previewDirectory, { recursive: true });
  const stagingDirectory = mkdtempSync(join(previewDirectory, "app-"));
  const previewApp = join(stagingDirectory, "Pipper Code (Alpha).app");
  let artifacts;
  try {
    // Clone the existing bundle on APFS; only icon resources are regenerated.
    try {
      run("cp", ["-cR", appBundle, previewApp]);
    } catch {
      // Unsupported clone filesystems can leave a partial destination.
      rmSync(previewApp, { recursive: true, force: true });
      run("cp", ["-R", appBundle, previewApp]);
    }
    const { assetCatalog, icnsFile } = await generateAssetCatalogForIcon(join(root, "pipper.icon"));
    const resources = join(previewApp, "Contents", "Resources");
    writeFileSync(join(resources, "Assets.car"), assetCatalog);
    writeFileSync(join(resources, "icon.icns"), icnsFile);
    artifacts = await build({
      projectDir: root,
      prepackaged: previewApp,
      targets: Platform.MAC.createTarget("dmg", Arch.arm64),
      publish: "never",
      config: {
        extends: join(root, "electron-builder.yml"),
        directories: { output: "release/dmg-preview" },
        mac: { artifactName: "pipper-installer-preview.${ext}" },
        dmg: {
          icon: join(resources, "icon.icns"),
          title: volumeName,
          format: "UDRO",
          writeUpdateInfo: false,
        },
      },
    });
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }

  const dmg = artifacts.find((artifact) => artifact.endsWith(".dmg"));
  if (!dmg) throw new Error("Packaging did not produce a DMG preview.");
  mkdirSync(previewDirectory, { recursive: true });
  // Finder background aliases expect the normal /Volumes mount location.
  // Give previews a distinct name so they cannot resolve to a release DMG
  // that the user already has mounted.
  run("hdiutil", ["attach", "-nobrowse", "-noautoopen", dmg]);
  writeFileSync(lastMountFile, mountPoint);
  run("open", [mountPoint]);
  console.log(`[DMG preview] Opened ${dmg}`);
}

main().catch((error) => {
  console.error(`[DMG preview] ${error.message}`);
  process.exitCode = 1;
});
