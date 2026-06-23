import { readFileSync, writeFileSync } from "node:fs";
import type { InstallationMetadata } from "../contracts/updates.ts";
import { getInstallationMetadataPath } from "./workspace-manager.ts";

export const STALE_INSTALLATION_METADATA_ERROR =
  "Installation metadata is stale: active workspace HEAD does not match installation.json.";

export function readInstallationMetadata(
  path = getInstallationMetadataPath(),
): InstallationMetadata {
  return JSON.parse(readFileSync(path, "utf8")) as InstallationMetadata;
}

export function writeInstallationMetadata(
  metadata: InstallationMetadata,
  path = getInstallationMetadataPath(),
): void {
  writeFileSync(path, `${JSON.stringify(metadata, null, 2)}\n`);
}

export function assertInstallationMetadataMatchesActive(
  installation: InstallationMetadata,
  activeHead: string,
): void {
  if (installation.customized_head_commit === activeHead) return;
  throw new Error(STALE_INSTALLATION_METADATA_ERROR);
}
