import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * App Intents extensions contain generated Metadata.appintents resources.
 * Sign the nested extension after electron-builder copies extraFiles and
 * before it signs the containing app, so the parent resource seal is valid.
 */
export default function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const extensionPath = join(appPath, "Contents", "Extensions", "PipperIntents.appex");
  if (!existsSync(extensionPath)) return;

  const result = spawnSync(
    "codesign",
    [
      "--force",
      "--sign",
      "-",
      "--timestamp=none",
      "--entitlements",
      "native/pipper-intents/Extension/PipperIntents.entitlements",
      extensionPath,
    ],
    { cwd: context.packager.projectDir, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`codesign failed for PipperIntents.appex with exit code ${result.status}`);
  }
}
