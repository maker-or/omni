const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export type LauncherManifest = {
  schema_version: 1;
  version: string;
  url: string;
  sha256: string;
};

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

export const launcherManifestHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
} as const;
