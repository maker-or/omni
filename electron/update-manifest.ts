import type { UpdateManifest } from "../contracts/updates.ts";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

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

function requireRepositoryPullRequest(prUrl: string, repositoryUrl: string): void {
  const pr = new URL(prUrl);
  const repository = new URL(repositoryUrl);
  const repositoryPath = repository.pathname.replace(/\.git$/i, "").replace(/\/$/, "");
  const escapedPath = repositoryPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (
    pr.origin !== repository.origin ||
    !new RegExp(`^${escapedPath}/pull/\\d+/?$`).test(pr.pathname)
  ) {
    throw new Error("Manifest pr_url must identify a pull request in the configured repository.");
  }
}

function requireChangedFiles(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Manifest files_changes must be a non-empty array.");
  }
  const files = value.map((file) => {
    if (
      typeof file !== "string" ||
      !file ||
      file.startsWith("/") ||
      file.includes("\\") ||
      file.includes("\0") ||
      file.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw new Error("Manifest files_changes contains an unsafe path.");
    }
    return file;
  });
  if (new Set(files).size !== files.length) {
    throw new Error("Manifest files_changes must not contain duplicates.");
  }
  return files.sort();
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
  const allowed = new Set(["schema_version", "version", "description", "pr_url", "files_changes"]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`Unknown manifest fields: ${unknown.join(", ")}`);
  if (value.schema_version !== 1) throw new Error("Unsupported update manifest schema version.");
  if (typeof value.version !== "string" || !SEMVER.test(value.version)) {
    throw new Error("Manifest version is invalid.");
  }
  if (compareVersions(value.version, installedVersion) <= 0) {
    throw new Error("Manifest version is not newer than the installed version.");
  }
  const repositoryUrl = requireHttps(configuredRepositoryUrl, "configured repository URL");
  const prUrl = requireHttps(value.pr_url, "pr_url");
  requireRepositoryPullRequest(prUrl, repositoryUrl);
  if (typeof value.description !== "string" || !value.description.trim()) {
    throw new Error("Manifest description is required.");
  }
  return {
    schema_version: 1,
    version: value.version,
    description: value.description,
    pr_url: prUrl,
    files_changes: requireChangedFiles(value.files_changes),
  };
}
