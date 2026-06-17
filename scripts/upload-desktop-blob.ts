import { put } from "@vercel/blob";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

type Architecture = "arm64" | "x64";

type ReleaseTarget = {
  architecture: Architecture;
  envKey: string;
  pathname: string;
};

type MatchedArtifact = ReleaseTarget & {
  fileName: string;
  filePath: string;
};

const releaseDir = path.join(process.cwd(), "release");

const releaseTargets: Record<Architecture, ReleaseTarget> = {
  arm64: {
    architecture: "arm64",
    envKey: "PUBLIC_PIPPER_MAC_ARM64_DMG_URL",
    pathname: "desktop/latest/pipper-mac-arm64.dmg",
  },
  x64: {
    architecture: "x64",
    envKey: "PUBLIC_PIPPER_MAC_X64_DMG_URL",
    pathname: "desktop/latest/pipper-mac-x64.dmg",
  },
};

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function getArchitecture(fileName: string): Architecture | null {
  const normalized = fileName.toLowerCase();

  if (normalized.includes("arm64")) {
    return "arm64";
  }

  if (normalized.includes("x64") || normalized.includes("x86_64")) {
    return "x64";
  }

  return null;
}

async function getFileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

async function main() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  if (!token) {
    fail("BLOB_READ_WRITE_TOKEN is required.");
  }

  let entries: string[];
  try {
    entries = await readdir(releaseDir);
  } catch {
    fail(`release/ directory does not exist at ${releaseDir}.`);
  }

  const dmgFiles = entries.filter((entry) => entry.toLowerCase().endsWith(".dmg"));

  if (dmgFiles.length === 0) {
    fail("No .dmg files found in release/.");
  }

  console.log(`Discovered DMG files: ${dmgFiles.join(", ")}`);

  const matchesByArchitecture = new Map<Architecture, MatchedArtifact[]>();

  for (const fileName of dmgFiles) {
    const architecture = getArchitecture(fileName);

    if (!architecture) {
      console.log(`Skipping ${fileName}: no supported architecture marker found.`);
      continue;
    }

    const target = releaseTargets[architecture];
    const artifact: MatchedArtifact = {
      ...target,
      fileName,
      filePath: path.join(releaseDir, fileName),
    };

    const matches = matchesByArchitecture.get(architecture) ?? [];
    matches.push(artifact);
    matchesByArchitecture.set(architecture, matches);

    console.log(`Matched ${fileName} as ${architecture} -> ${target.pathname}`);
  }

  const artifacts: MatchedArtifact[] = [];

  for (const architecture of Object.keys(releaseTargets) as Architecture[]) {
    const matches = matchesByArchitecture.get(architecture) ?? [];

    if (matches.length > 1) {
      fail(
        `More than one ${architecture} DMG found: ${matches
          .map((artifact) => artifact.fileName)
          .join(", ")}`,
      );
    }

    if (matches.length === 1) {
      artifacts.push(matches[0]);
    }
  }

  if (artifacts.length === 0) {
    fail("No supported arm64 or x64 DMG artifacts found in release/.");
  }

  const envLines: string[] = [];

  for (const artifact of artifacts) {
    const sha256 = await getFileSha256(artifact.filePath);
    const parsedPath = path.posix.parse(artifact.pathname);
    const immutablePathname = path.posix.join(
      parsedPath.dir,
      sha256,
      parsedPath.base,
    );

    console.log(`Uploading ${artifact.fileName} to ${immutablePathname}`);

    const body = createReadStream(artifact.filePath);
    const blob = await put(immutablePathname, body, {
      access: "public",
      token,
      allowOverwrite: true,
      addRandomSuffix: false,
      multipart: true,
    });

    envLines.push(`${artifact.envKey}=${blob.downloadUrl}`);
    envLines.push(`${artifact.envKey}_SHA256=${sha256}`);
  }

  console.log("Environment variables:");
  for (const line of envLines) {
    console.log(line);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
