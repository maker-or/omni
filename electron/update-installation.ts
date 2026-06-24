import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { InstallationMetadata } from "../contracts/updates.ts";
import { getActivePath, getInstallationMetadataPath } from "./workspace-manager.ts";

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

export function readAndValidateInstallationAgainstActive(opts?: {
  repair?: boolean;
  activePath?: string;
  installationPath?: string;
}): InstallationMetadata {
  const activePath = opts?.activePath ?? getActivePath();
  const installationPath = opts?.installationPath ?? getInstallationMetadataPath();
  const installation = readInstallationMetadata(installationPath);
  const status = execFileSync("git", ["status", "--porcelain"], {
    cwd: activePath,
    encoding: "utf8",
  });
  if (status.trim()) return installation;
  const activeHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: activePath,
    encoding: "utf8",
  }).trim();
  if (installation.customized_head_commit === activeHead) return installation;
  if (!opts?.repair) throw new Error(STALE_INSTALLATION_METADATA_ERROR);
  const repaired = {
    ...installation,
    customized_head_commit: activeHead,
    last_healthy_at: new Date().toISOString(),
  };
  writeInstallationMetadata(repaired, installationPath);
  return repaired;
}
