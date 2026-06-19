import type { UpdateManifest } from "../contracts/updates.ts";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const ALLOWED_VALIDATION_COMMANDS = new Set(["bun run lint", "bun run build", "bun run doctor"]);

export function compareVersions(left: string, right: string): number {
  const a = left.match(SEMVER);
  const b = right.match(SEMVER);
  if (!a || !b) throw new Error("Version must use semantic version format.");
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(a[index]) - Number(b[index]);
    if (difference !== 0) return Math.sign(difference);
  }
  if (a[4] === b[4]) return 0;
  if (!a[4]) return 1;
  if (!b[4]) return -1;
  return a[4].localeCompare(b[4], undefined, { numeric: true });
}

function requireHttps(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${field} must use HTTPS.`);
  return url.toString().replace(/\/$/, "");
}

function normalizeRepositoryUrl(value: string): string {
  return value
    .replace(/\.git$/i, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

export function parseUpdateManifest(
  input: unknown,
  installedVersion: string,
  configuredRepositoryUrl: string,
): UpdateManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Update manifest must be an object.");
  }
  const value = input as Record<string, unknown>;
  const allowed = new Set([
    "schema_version",
    "version",
    "description",
    "pr_url",
    "repository_url",
    "base_commit",
    "target_commit",
    "published_at",
    "minimum_version",
    "validation_commands",
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`Unknown manifest fields: ${unknown.join(", ")}`);
  if (value.schema_version !== 1) throw new Error("Unsupported update manifest schema version.");
  if (typeof value.version !== "string" || !SEMVER.test(value.version)) {
    throw new Error("Manifest version is invalid.");
  }
  if (compareVersions(value.version, installedVersion) <= 0) {
    throw new Error("Manifest version is not newer than the installed version.");
  }
  if (typeof value.minimum_version !== "string" || !SEMVER.test(value.minimum_version)) {
    throw new Error("Manifest minimum_version is invalid.");
  }
  if (compareVersions(installedVersion, value.minimum_version) < 0) {
    throw new Error("Installed version is below the update minimum version.");
  }
  const repositoryUrl = requireHttps(value.repository_url, "repository_url");
  if (normalizeRepositoryUrl(repositoryUrl) !== normalizeRepositoryUrl(configuredRepositoryUrl)) {
    throw new Error("Manifest repository does not match the configured upstream repository.");
  }
  const prUrl = requireHttps(value.pr_url, "pr_url");
  if (typeof value.base_commit !== "string" || !FULL_SHA.test(value.base_commit)) {
    throw new Error("Manifest base_commit must be a full commit hash.");
  }
  if (typeof value.target_commit !== "string" || !FULL_SHA.test(value.target_commit)) {
    throw new Error("Manifest target_commit must be a full commit hash.");
  }
  if (typeof value.description !== "string" || !value.description.trim()) {
    throw new Error("Manifest description is required.");
  }
  if (typeof value.published_at !== "string" || Number.isNaN(Date.parse(value.published_at))) {
    throw new Error("Manifest published_at is invalid.");
  }
  if (
    !Array.isArray(value.validation_commands) ||
    value.validation_commands.some(
      (command) => typeof command !== "string" || !ALLOWED_VALIDATION_COMMANDS.has(command.trim()),
    )
  ) {
    throw new Error("Manifest validation_commands contains an unsupported command.");
  }
  return {
    schema_version: 1,
    version: value.version,
    description: value.description,
    pr_url: prUrl,
    repository_url: repositoryUrl,
    base_commit: value.base_commit.toLowerCase(),
    target_commit: value.target_commit.toLowerCase(),
    published_at: new Date(value.published_at).toISOString(),
    minimum_version: value.minimum_version,
    validation_commands: [...value.validation_commands],
  };
}
