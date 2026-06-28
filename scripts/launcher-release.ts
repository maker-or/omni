import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type LauncherManifest = {
  schema_version: 1;
  version: string;
  url: string;
  sha256: string;
};

export type ReleaseDmg = {
  file: string;
  name: string;
  sha256: string;
  size: number;
};

export const LATEST_MANIFEST_NAME = "latest.json";
export const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function launcherTagName(version: string): string {
  assertVersion(version);
  return `v${version}`;
}

export function launcherDmgName(version: string): string {
  assertVersion(version);
  return `pipper-${version}-arm64.dmg`;
}

export function normalizeGithubRepository(repository: string): string {
  let value = repository.trim();
  if (value.startsWith("https://github.com/")) value = value.slice("https://github.com/".length);
  if (value.startsWith("git@github.com:")) value = value.slice("git@github.com:".length);
  value = value.replace(/\.git$/, "").replace(/^\/+|\/+$/g, "");

  const match = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/.exec(value);
  if (!match) {
    throw new Error(
      "GitHub release repository must be OWNER/REPO, https://github.com/OWNER/REPO, or git@github.com:OWNER/REPO.git.",
    );
  }
  return match[1]!;
}

export function inferGithubRepositoryFromRemote(remoteUrl: string): string | null {
  try {
    return normalizeGithubRepository(remoteUrl);
  } catch {
    return null;
  }
}

export function githubReleaseAssetUrl(repository: string, tag: string, assetName: string): string {
  const repo = normalizeGithubRepository(repository);
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
}

export function githubLatestManifestUrl(repository: string): string {
  const repo = normalizeGithubRepository(repository);
  return `https://github.com/${repo}/releases/latest/download/${LATEST_MANIFEST_NAME}`;
}

export function createGithubLauncherManifest(
  repository: string,
  version: string,
  sha256: string,
): LauncherManifest {
  assertVersion(version);
  assertSha256(sha256);
  return {
    schema_version: 1,
    version,
    url: githubReleaseAssetUrl(repository, launcherTagName(version), launcherDmgName(version)),
    sha256: sha256.toLowerCase(),
  };
}

export function serializeManifest(manifest: LauncherManifest): string {
  return `${JSON.stringify(validateManifest(manifest), null, 2)}\n`;
}

export function validateManifest(value: unknown): LauncherManifest {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error("Launcher manifest is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(record).sort()) !==
    JSON.stringify(["schema_version", "sha256", "url", "version"])
  ) {
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
  if (url.protocol !== "https:" || !url.pathname.toLowerCase().endsWith(".dmg")) {
    throw new Error("Launcher artifact must be an HTTPS DMG URL.");
  }
  if (typeof record.sha256 !== "string" || !/^[0-9a-fA-F]{64}$/.test(record.sha256)) {
    throw new Error("Launcher artifact SHA-256 is invalid.");
  }
  return {
    schema_version: 1,
    version: record.version,
    url: url.toString(),
    sha256: record.sha256.toLowerCase(),
  };
}

export function manifestsMatch(left: LauncherManifest, right: LauncherManifest): boolean {
  return (
    left.schema_version === right.schema_version &&
    left.version === right.version &&
    left.url === right.url &&
    left.sha256 === right.sha256
  );
}

export async function readPackageVersion(packageJsonPath = "package.json"): Promise<string> {
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: unknown };
  if (typeof pkg.version !== "string" || !SEMVER.test(pkg.version)) {
    throw new Error("Root package version is invalid.");
  }
  return pkg.version;
}

export async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function resolveReleaseDmg(
  version: string,
  releaseDir = "release",
): Promise<ReleaseDmg> {
  const expected = launcherDmgName(version);
  let entries: string[];
  try {
    entries = await readdir(releaseDir);
  } catch (error) {
    throw new Error(
      `Unable to read ${releaseDir}/: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const dmgs = entries.filter((name) => name.toLowerCase().endsWith(".dmg"));
  if (dmgs.length !== 1 || dmgs[0] !== expected) {
    throw new Error(
      `${releaseDir}/ must contain exactly ${expected}; found: ${dmgs.join(", ") || "none"}`,
    );
  }
  const file = path.join(releaseDir, expected);
  const stats = await stat(file);
  if (!stats.isFile()) throw new Error(`${file} is not a file.`);
  return {
    file,
    name: expected,
    size: stats.size,
    sha256: await hashFile(file),
  };
}

export async function verifyRemoteManifest(
  manifestUrl: string,
  expected: LauncherManifest,
): Promise<void> {
  let lastProblem = "verification did not run";
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const url = new URL(manifestUrl);
    url.searchParams.set("verify", `${Date.now()}-${attempt}`);
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        lastProblem = `HTTP ${response.status}`;
      } else {
        const actual = validateManifest(await response.json());
        if (manifestsMatch(actual, expected)) return;
        lastProblem = `received manifest version ${actual.version}`;
      }
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  throw new Error(`Remote manifest verification failed after retries: ${lastProblem}.`);
}

export async function verifyRemoteDmg(
  dmgUrl: string,
  expectedSha256: string,
  expectedSize: number,
): Promise<{ finalUrl: string; sha256: string; size: number }> {
  assertSha256(expectedSha256);
  const response = await fetch(dmgUrl, { cache: "no-store", redirect: "follow" });
  if (!response.ok) throw new Error(`Unable to download launcher DMG: HTTP ${response.status}`);
  if (!response.body) throw new Error("Unable to download launcher DMG: response body is empty.");

  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    hash.update(chunk);
  }
  const sha256 = hash.digest("hex");
  if (size !== expectedSize) {
    throw new Error(`Downloaded DMG size mismatch: expected ${expectedSize}, received ${size}.`);
  }
  if (sha256 !== expectedSha256.toLowerCase()) {
    throw new Error(
      `Downloaded DMG SHA-256 mismatch: expected ${expectedSha256}, received ${sha256}.`,
    );
  }
  return { finalUrl: response.url, sha256, size };
}

function assertVersion(version: string): void {
  if (!SEMVER.test(version)) throw new Error(`Invalid launcher version: ${version}`);
}

function assertSha256(sha256: string): void {
  if (!/^[0-9a-fA-F]{64}$/.test(sha256)) throw new Error(`Invalid SHA-256: ${sha256}`);
}
