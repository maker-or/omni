import {
  PIPPER_LAUNCHER_MAC_MANIFEST_URL,
  PIPPER_LAUNCHER_WINDOWS_MANIFEST_URL,
} from "../../../contracts/launcher-release-urls.ts";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export type LauncherManifest = {
  schema_version: 1;
  version: string;
  url: string;
  sha256: string;
};

type GithubReleaseAsset = {
  name: string;
  browser_download_url: string;
};

type GithubRelease = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: GithubReleaseAsset[];
};

export function compareSemver(left: string, right: string): number {
  const parse = (value: string): [number, number, number] | null => {
    const match = SEMVER.exec(value);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };

  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function isLauncherManifest(value: unknown, extension: string): value is LauncherManifest {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(record).sort()) !==
    JSON.stringify(["schema_version", "sha256", "url", "version"])
  ) {
    return false;
  }
  if (
    record.schema_version !== 1 ||
    typeof record.version !== "string" ||
    !SEMVER.test(record.version) ||
    typeof record.url !== "string" ||
    typeof record.sha256 !== "string" ||
    !/^[0-9a-fA-F]{64}$/.test(record.sha256)
  ) {
    return false;
  }
  try {
    const url = new URL(record.url);
    return url.protocol === "https:" && url.pathname.toLowerCase().endsWith(extension);
  } catch {
    return false;
  }
}

async function tryFetchManifest(url: string, extension: string): Promise<LauncherManifest | null> {
  try {
    const response = await fetch(url, { cache: "no-store", redirect: "follow" });
    if (!response.ok) return null;
    const manifest = await response.json();
    return isLauncherManifest(manifest, extension) ? manifest : null;
  } catch {
    return null;
  }
}

function githubRepositoryFromManifestUrl(manifestUrl: string): string {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/latest\/download\//.exec(
    manifestUrl,
  );
  if (!match) {
    throw new Error(`Unsupported launcher manifest URL: ${manifestUrl}`);
  }
  return match[1]!;
}

async function fetchManifestFromReleaseHistory(
  repository: string,
  manifestName: string,
  extension: string,
): Promise<LauncherManifest | null> {
  const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=30`, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Pipper-Marketing",
    },
  });
  if (!response.ok) return null;

  const releases = (await response.json()) as GithubRelease[];
  let best: LauncherManifest | null = null;

  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    const asset = release.assets.find((entry) => entry.name === manifestName);
    if (!asset) continue;
    const manifest = await tryFetchManifest(asset.browser_download_url, extension);
    if (!manifest) continue;
    if (!best || compareSemver(manifest.version, best.version) > 0) {
      best = manifest;
    }
  }

  return best;
}

export async function fetchLauncherManifest(
  latestManifestUrl: string,
  manifestName: string,
  extension: string,
): Promise<LauncherManifest | null> {
  const latest = await tryFetchManifest(latestManifestUrl, extension);
  if (latest) return latest;

  const repository = githubRepositoryFromManifestUrl(latestManifestUrl);
  return fetchManifestFromReleaseHistory(repository, manifestName, extension);
}

export async function fetchMacLauncherManifest(): Promise<LauncherManifest | null> {
  return fetchLauncherManifest(PIPPER_LAUNCHER_MAC_MANIFEST_URL, "latest.json", ".dmg");
}

export async function fetchWindowsLauncherManifest(): Promise<LauncherManifest | null> {
  return fetchLauncherManifest(PIPPER_LAUNCHER_WINDOWS_MANIFEST_URL, "latest-windows.json", ".exe");
}

export const launcherManifestHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
} as const;
