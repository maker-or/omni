import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  LATEST_MANIFEST_NAME,
  createGithubLauncherManifest,
  githubLatestManifestUrl,
  githubReleaseAssetUrl,
  inferGithubRepositoryFromRemote,
  launcherTagName,
  normalizeGithubRepository,
  readPackageVersion,
  resolveReleaseDmg,
  serializeManifest,
  verifyRemoteDmg,
  verifyRemoteManifest,
} from "./launcher-release.ts";

type Options = {
  dryRun: boolean;
  repo: string | null;
  resume: boolean;
  skipDownloadVerification: boolean;
  skipGitCheck: boolean;
};

type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
};

type ReleaseView = {
  assets: Array<{ name: string }>;
  isDraft: boolean;
  isPrerelease: boolean;
  url: string;
};

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const repository = resolveRepository(options.repo);
  const version = await readPackageVersion();
  const tag = launcherTagName(version);
  const dmg = await resolveReleaseDmg(version);
  const manifest = createGithubLauncherManifest(repository, version, dmg.sha256);
  const manifestPath = path.join("release", LATEST_MANIFEST_NAME);

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, serializeManifest(manifest));

  if (!options.dryRun && !options.skipGitCheck) assertCleanGitTree();

  const summary = {
    version,
    repository,
    tag,
    dmg_path: dmg.file,
    dmg_url: manifest.url,
    manifest_path: manifestPath,
    manifest_url: githubLatestManifestUrl(repository),
    sha256: dmg.sha256,
    size: dmg.size,
  };

  if (options.dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  run("gh", ["auth", "status", "--repo", repository]);

  const existingRelease = getReleaseView(repository, tag);
  if (existingRelease && !options.resume) {
    throw new Error(
      `Release ${tag} already exists. Use --resume only to repair a known partial publication.`,
    );
  }

  if (existingRelease) {
    await resumeRelease(
      repository,
      tag,
      existingRelease,
      dmg.file,
      manifestPath,
      manifest,
      dmg.size,
      options.skipDownloadVerification,
    );
  } else {
    run("gh", [
      "release",
      "create",
      tag,
      dmg.file,
      manifestPath,
      "--repo",
      repository,
      "--title",
      `Pipper Code ${version}`,
      "--notes",
      `Launcher release ${version}`,
      "--latest",
    ]);
  }

  await verifyRemoteManifest(
    githubReleaseAssetUrl(repository, tag, LATEST_MANIFEST_NAME),
    manifest,
  );
  await verifyRemoteManifest(githubLatestManifestUrl(repository), manifest);
  if (!options.skipDownloadVerification) await verifyRemoteDmg(manifest.url, dmg.sha256, dmg.size);

  console.log(JSON.stringify(summary, null, 2));
}

async function resumeRelease(
  repository: string,
  tag: string,
  release: ReleaseView,
  dmgPath: string,
  manifestPath: string,
  manifest: ReturnType<typeof createGithubLauncherManifest>,
  dmgSize: number,
  skipDownloadVerification: boolean,
): Promise<void> {
  if (release.isPrerelease) {
    throw new Error(`${tag} is marked as a prerelease and cannot back /releases/latest/.`);
  }

  const assetNames = new Set(release.assets.map((asset) => asset.name));
  const missingAssets: string[] = [];
  if (!assetNames.has(path.basename(dmgPath))) missingAssets.push(dmgPath);
  if (!assetNames.has(path.basename(manifestPath))) missingAssets.push(manifestPath);

  if (missingAssets.length === 0) {
    throw new Error(
      `Release ${tag} already has ${path.basename(dmgPath)} and ${LATEST_MANIFEST_NAME}.`,
    );
  }

  if (
    !skipDownloadVerification &&
    assetNames.has(path.basename(dmgPath)) &&
    missingAssets.includes(manifestPath)
  ) {
    await verifyRemoteDmg(manifest.url, manifest.sha256, dmgSize);
  }

  run("gh", ["release", "upload", tag, ...missingAssets, "--repo", repository]);
  if (release.isDraft) {
    run("gh", ["release", "edit", tag, "--repo", repository, "--draft=false", "--latest"]);
  } else {
    run("gh", ["release", "edit", tag, "--repo", repository, "--latest"]);
  }
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    dryRun: false,
    repo: null,
    resume: false,
    skipDownloadVerification: false,
    skipGitCheck: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--resume") {
      options.resume = true;
    } else if (arg === "--skip-download-verification") {
      options.skipDownloadVerification = true;
    } else if (arg === "--skip-git-check") {
      options.skipGitCheck = true;
    } else if (arg === "--repo") {
      const value = argv[++index];
      if (!value) throw new Error("--repo requires OWNER/REPO.");
      options.repo = value;
    } else if (arg.startsWith("--repo=")) {
      options.repo = arg.slice("--repo=".length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function resolveRepository(option: string | null): string {
  if (option) return normalizeGithubRepository(option);
  if (process.env.PIPPER_RELEASE_REPOSITORY)
    return normalizeGithubRepository(process.env.PIPPER_RELEASE_REPOSITORY);
  if (process.env.GITHUB_REPOSITORY)
    return normalizeGithubRepository(process.env.GITHUB_REPOSITORY);

  const remote = runCapture("git", ["config", "--get", "remote.origin.url"], true).stdout.trim();
  const inferred = remote ? inferGithubRepositoryFromRemote(remote) : null;
  if (inferred) return inferred;

  const ghRepo = runCapture(
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    true,
  ).stdout.trim();
  if (ghRepo) return normalizeGithubRepository(ghRepo);

  throw new Error("Unable to infer GitHub release repository. Set PIPPER_RELEASE_REPOSITORY.");
}

function assertCleanGitTree(): void {
  const status = runCapture("git", ["status", "--porcelain=v1"], false).stdout.trim();
  if (status) {
    throw new Error(
      "Working tree is not clean. Commit or stash source changes before publishing a launcher release.",
    );
  }
}

function getReleaseView(repository: string, tag: string): ReleaseView | null {
  const result = runCapture(
    "gh",
    ["release", "view", tag, "--repo", repository, "--json", "assets,isDraft,isPrerelease,url"],
    true,
  );
  if (result.status !== 0) return null;
  return JSON.parse(result.stdout) as ReleaseView;
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status ?? 1}.`);
  }
}

function runCapture(command: string, args: string[], allowFailure: boolean): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  const output = {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
  if (!allowFailure && output.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit ${output.status}: ${output.stderr.trim()}`,
    );
  }
  return output;
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
