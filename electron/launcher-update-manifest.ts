import type { LauncherUpdateManifest } from "../contracts/launcher-updates.ts";
import {
  launcherArtifactExtension,
  launcherArtifactLabel,
  resolveLauncherUpdatePlatform,
  type LauncherUpdatePlatform,
} from "./launcher-update-artifact.ts";

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const KEYS = ["schema_version", "version", "url", "sha256"].sort();

export function compareLauncherVersions(a: string, b: string): number {
  const am = SEMVER.exec(a);
  const bm = SEMVER.exec(b);
  if (!am || !bm) throw new Error("Invalid semantic version.");
  for (let i = 1; i <= 3; i += 1) {
    const difference = Number(am[i]) - Number(bm[i]);
    if (difference) return difference;
  }
  const ap = am[4];
  const bp = bm[4];
  if (!ap && !bp) return 0;
  if (!ap) return 1;
  if (!bp) return -1;
  const aa = ap.split(".");
  const ba = bp.split(".");
  for (let i = 0; i < Math.max(aa.length, ba.length); i += 1) {
    if (aa[i] == null) return -1;
    if (ba[i] == null) return 1;
    if (aa[i] === ba[i]) continue;
    const an = /^\d+$/.test(aa[i]!) ? Number(aa[i]) : null;
    const bn = /^\d+$/.test(ba[i]!) ? Number(ba[i]) : null;
    if (an != null && bn != null) return an - bn;
    if (an != null) return -1;
    if (bn != null) return 1;
    return aa[i]!.localeCompare(ba[i]!);
  }
  return 0;
}

export function parseLauncherUpdateManifest(
  input: unknown,
  installedVersion: string,
  platform: LauncherUpdatePlatform = resolveLauncherUpdatePlatform(process.platform),
): LauncherUpdateManifest | null {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw new Error("Launcher manifest must be a JSON object.");
  }
  const record = input as Record<string, unknown>;
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(KEYS)) {
    throw new Error(
      "Launcher manifest must contain exactly schema_version, version, url, and sha256.",
    );
  }
  if (record.schema_version !== 1) throw new Error("Unsupported launcher manifest schema.");
  if (typeof record.version !== "string" || !SEMVER.test(record.version)) {
    throw new Error("Launcher manifest version is invalid.");
  }
  if (typeof record.url !== "string") throw new Error("Launcher artifact URL is invalid.");
  let url: URL;
  try {
    url = new URL(record.url);
  } catch {
    throw new Error("Launcher artifact URL is invalid.");
  }
  const extension = launcherArtifactExtension(platform);
  if (url.protocol !== "https:" || !url.pathname.toLowerCase().endsWith(extension)) {
    throw new Error(`Launcher artifact must be an HTTPS ${launcherArtifactLabel(platform)} URL.`);
  }
  if (typeof record.sha256 !== "string" || !/^[0-9a-fA-F]{64}$/.test(record.sha256)) {
    throw new Error("Launcher artifact SHA-256 is invalid.");
  }
  if (compareLauncherVersions(record.version, installedVersion) <= 0) return null;
  return {
    schema_version: 1,
    version: record.version,
    url: url.toString(),
    sha256: record.sha256.toLowerCase(),
  };
}
