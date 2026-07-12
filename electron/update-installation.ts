import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import type { InstallationMetadata } from "../contracts/updates.ts";
import { getActivePath, getInstallationMetadataPath } from "./workspace-manager.ts";

export const STALE_INSTALLATION_METADATA_ERROR =
  "Installation metadata is stale: active workspace HEAD does not match installation.json.";

export function readInstallationMetadata(
  path = getInstallationMetadataPath(),
): InstallationMetadata {
  return JSON.parse(readFileSync(path, "utf8")) as InstallationMetadata;
}

// installation.json records which version/commit Pipper believes is installed; it is
// the trusted identity the rest of the update system validates against. Writing it with
// a single writeFileSync risked leaving a truncated/corrupt file behind a crash or power
// loss mid-write, which would then fail every later read (JSON.parse) with no way to
// recover automatically. Write to a temp file, fsync, then rename so a crash always
// leaves either the previous complete file or the new complete file, never a partial one.
export function writeInstallationMetadata(
  metadata: InstallationMetadata,
  path = getInstallationMetadataPath(),
): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  const fd = openSync(temporaryPath, "w", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporaryPath, path);
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
