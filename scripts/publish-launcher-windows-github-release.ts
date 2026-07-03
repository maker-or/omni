import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  LATEST_WINDOWS_MANIFEST_NAME,
  createGithubLauncherWindowsManifest,
  githubLatestWindowsManifestUrl,
  githubReleaseAssetUrl,
  inferGithubRepositoryFromRemote,
  launcherTagName,
  normalizeGithubRepository,
  readPackageVersion,
  resolveReleaseWindowsExe,
  serializeWindowsManifest,
  verifyRemoteWindowsExe,
  verifyRemoteWindowsManifest,
} from "./launcher-release.ts";

type Options = {
  dryRun: boolean;
  repo: string | null;
  skipDownloadVerification: boolean;
  skipGitCheck: boolean;
  version: string | null;
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
  const version = options.version ?? (await readPackageVersion());
  if (options.version) {
    const packageVersion = await readPackageVersion();
    if (version !== packageVersion) {
      throw new Error(
        `Requested version ${version} does not match package.json version ${packageVersion}.`,
      );
    }
  }
  const tag = launcherTagName(version);
  const installer = await resolveReleaseWindowsExe(version);
  const manifest = createGithubLauncherWindowsManifest(repository, version, installer.sha256);
  const manifestPath = path.join("release", LATEST_WINDOWS_MANIFEST_NAME);

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, serializeWindowsManifest(manifest));

  if (!options.dryRun && !options.skipGitCheck) assertCleanGitTree();

  const summary = {
    version,
    repository,
    tag,
    installer_path: installer.file,
    installer_url: manifest.url,
    manifest_path: manifestPath,
    manifest_url: githubLatestWindowsManifestUrl(repository),
    sha256: installer.sha256,
    size: installer.size,
  };

  if (options.dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  assertGithubAuth();

  const existingRelease = getReleaseView(repository, tag);
  if (existingRelease) {
    await publishToExistingRelease(
      repository,
      tag,
      existingRelease,
      installer.file,
      manifestPath,
      manifest,
      installer.size,
      options.skipDownloadVerification,
    );
  } else {
    run("gh", [
      "release",
      "create",
      tag,
      installer.file,
      manifestPath,
      "--repo",
      repository,
      "--title",
      `Pipper Code ${version}`,
      "--notes",
      `Launcher release ${version} (Windows)`,
      "--latest",
    ]);
  }

  await verifyRemoteWindowsManifest(
    githubReleaseAssetUrl(repository, tag, LATEST_WINDOWS_MANIFEST_NAME),
    manifest,
  );
  await verifyRemoteWindowsManifest(githubLatestWindowsManifestUrl(repository), manifest);
  if (!options.skipDownloadVerification) {
    await verifyRemoteWindowsExe(manifest.url, installer.sha256, installer.size);
  }

  console.log(JSON.stringify(summary, null, 2));
}

async function publishToExistingRelease(
  repository: string,
  tag: string,
  release: ReleaseView,
  installerPath: string,
  manifestPath: string,
  manifest: ReturnType<typeof createGithubLauncherWindowsManifest>,
  installerSize: number,
  skipDownloadVerification: boolean,
): Promise<void> {
  if (release.isPrerelease) {
    throw new Error(`${tag} is marked as a prerelease and cannot back /releases/latest/.`);
  }

  const installerName = path.basename(installerPath);
  const assetNames = new Set(release.assets.map((asset) => asset.name));
  const missingAssets: string[] = [];
  if (!assetNames.has(installerName)) missingAssets.push(installerPath);
  if (!assetNames.has(LATEST_WINDOWS_MANIFEST_NAME)) missingAssets.push(manifestPath);

  if (missingAssets.length === 0) {
    throw new Error(
      `Release ${tag} already has ${installerName} and ${LATEST_WINDOWS_MANIFEST_NAME}.`,
    );
  }

  if (
    !skipDownloadVerification &&
    assetNames.has(installerName) &&
    missingAssets.includes(manifestPath)
  ) {
    await verifyRemoteWindowsExe(manifest.url, manifest.sha256, installerSize);
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
    skipDownloadVerification: false,
    skipGitCheck: false,
    version: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--dry-run") {
      options.dryRun = true;
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
    } else if (arg === "--version") {
      const value = argv[++index];
      if (!value) throw new Error("--version requires a semantic version.");
      options.version = value;
    } else if (arg.startsWith("--version=")) {
      options.version = arg.slice("--version=".length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function resolveRepository(option: string | null): string {
  if (option) return normalizeGithubRepository(option);
  if (process.env.PIPPER_RELEASE_REPOSITORY) {
    return normalizeGithubRepository(process.env.PIPPER_RELEASE_REPOSITORY);
  }
  if (process.env.GITHUB_REPOSITORY) {
    return normalizeGithubRepository(process.env.GITHUB_REPOSITORY);
  }

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

function assertGithubAuth(): void {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return;
  run("gh", ["auth", "status"]);
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
