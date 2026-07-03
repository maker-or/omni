import { put } from "@vercel/blob";
import { spawnSync } from "node:child_process";
import { PIPPER_RELEASE_REPOSITORY } from "../contracts/launcher-release-urls.ts";
import {
  createGithubLauncherManifest,
  githubLatestManifestUrl,
  inferGithubRepositoryFromRemote,
  normalizeGithubRepository,
  readPackageVersion,
  resolveReleaseDmg,
  serializeManifest,
  verifyRemoteDmg,
  verifyRemoteManifest,
} from "./launcher-release.ts";

type Options = {
  blobPath: string;
  dryRun: boolean;
  repo: string | null;
  skipDownloadVerification: boolean;
};

const DEFAULT_BLOB_MANIFEST_PATH = "desktop/launcher/latest.json";

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const repository = resolveRepository(options.repo);
  const version = await readPackageVersion();
  const dmg = await resolveReleaseDmg(version);
  const manifest = createGithubLauncherManifest(repository, version, dmg.sha256);

  if (!options.skipDownloadVerification) await verifyRemoteDmg(manifest.url, dmg.sha256, dmg.size);

  const summary = {
    version,
    repository,
    bridge_manifest_path: options.blobPath,
    github_manifest_url: githubLatestManifestUrl(repository),
    dmg_url: manifest.url,
    sha256: dmg.sha256,
    size: dmg.size,
  };

  if (options.dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is required.");

  const blob = await put(options.blobPath, serializeManifest(manifest), {
    access: "public",
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json",
  });
  await verifyRemoteManifest(blob.url, manifest);

  console.log(
    JSON.stringify(
      {
        ...summary,
        bridge_manifest_url: blob.url,
      },
      null,
      2,
    ),
  );
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    blobPath: process.env.PIPPER_BLOB_LAUNCHER_MANIFEST_PATH ?? DEFAULT_BLOB_MANIFEST_PATH,
    dryRun: false,
    repo: null,
    skipDownloadVerification: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--skip-download-verification") {
      options.skipDownloadVerification = true;
    } else if (arg === "--repo") {
      const value = argv[++index];
      if (!value) throw new Error("--repo requires OWNER/REPO.");
      options.repo = value;
    } else if (arg.startsWith("--repo=")) {
      options.repo = arg.slice("--repo=".length);
    } else if (arg === "--blob-path") {
      const value = argv[++index];
      if (!value) throw new Error("--blob-path requires a Vercel Blob pathname.");
      options.blobPath = value;
    } else if (arg.startsWith("--blob-path=")) {
      options.blobPath = arg.slice("--blob-path=".length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.blobPath.endsWith(".json")) {
    throw new Error("Bridge manifest Blob path must end with .json.");
  }
  return options;
}

function resolveRepository(option: string | null): string {
  if (option) return normalizeGithubRepository(option);
  return normalizeGithubRepository(PIPPER_RELEASE_REPOSITORY);
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
