import { del, head, list, put } from "@vercel/blob";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const PREFIX = "desktop/launcher/";
const MANIFEST_PATH = `${PREFIX}latest.json`;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is required.");

type Manifest = { schema_version: 1; version: string; url: string; sha256: string };
function validateManifest(value: unknown): Manifest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Remote launcher manifest is invalid.");
  const m = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(m).sort()) !==
    JSON.stringify(["schema_version", "sha256", "url", "version"])
  )
    throw new Error("Remote launcher manifest fields are invalid.");
  if (
    m.schema_version !== 1 ||
    typeof m.version !== "string" ||
    !SEMVER.test(m.version) ||
    typeof m.url !== "string" ||
    new URL(m.url).protocol !== "https:" ||
    !new URL(m.url).pathname.toLowerCase().endsWith(".dmg") ||
    typeof m.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(m.sha256)
  )
    throw new Error("Remote launcher manifest values are invalid.");
  return m as Manifest;
}
async function hashFile(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function findManifestUrl(): Promise<string> {
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: MANIFEST_PATH, cursor, token });
    const match = page.blobs.find((blob) => blob.pathname === MANIFEST_PATH);
    if (match) return match.url;
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  throw new Error("No launcher manifest is published.");
}

async function prune() {
  const manifestUrl = await findManifestUrl();
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to read launcher manifest: HTTP ${response.status}`);
  const manifest = validateManifest(await response.json());
  const currentPath = new URL(manifest.url).pathname.replace(/^\//, "");
  let cursor: string | undefined;
  const deletions: string[] = [];
  do {
    const page = await list({ prefix: PREFIX, cursor, token });
    for (const blob of page.blobs)
      if (blob.pathname.endsWith(".dmg") && blob.pathname !== currentPath) deletions.push(blob.url);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  for (const url of deletions) {
    await del(url, { token });
    console.log(`Deleted ${url}`);
  }
  console.log(`Retained ${manifest.url}`);
}

async function publish() {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as { version?: string };
  if (!pkg.version || !SEMVER.test(pkg.version))
    throw new Error("Root package version is invalid.");
  const expected = `pipper-${pkg.version}-arm64.dmg`;
  const dmgs = (await readdir("release")).filter((name) => name.toLowerCase().endsWith(".dmg"));
  if (dmgs.length !== 1 || dmgs[0] !== expected)
    throw new Error(
      `release/ must contain exactly ${expected}; found: ${dmgs.join(", ") || "none"}`,
    );
  const file = path.join("release", expected);
  const pathname = `${PREFIX}${expected}`;
  const existing = await list({ prefix: pathname, token });
  if (existing.blobs.some((blob) => blob.pathname === pathname))
    throw new Error(`Refusing to overwrite published artifact ${pathname}.`);
  const sha256 = await hashFile(file);
  const local = await stat(file);
  const artifact = await put(pathname, createReadStream(file), {
    access: "public",
    token,
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 31536000,
    contentType: "application/x-apple-diskimage",
    multipart: true,
  });
  const remote = await head(artifact.url, { token });
  if (
    remote.size !== local.size ||
    remote.contentType !== "application/x-apple-diskimage" ||
    remote.pathname !== pathname
  )
    throw new Error("Remote artifact verification failed.");
  const manifest: Manifest = {
    schema_version: 1,
    version: pkg.version,
    url: artifact.downloadUrl,
    sha256,
  };
  const manifestBlob = await put(MANIFEST_PATH, JSON.stringify(manifest), {
    access: "public",
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json",
  });
  const verify = await fetch(manifestBlob.url, { cache: "no-store" });
  if (!verify.ok) throw new Error(`Remote manifest verification failed: HTTP ${verify.status}.`);
  const verifiedManifest = validateManifest(await verify.json());
  if (JSON.stringify(verifiedManifest) !== JSON.stringify(manifest))
    throw new Error("Remote manifest verification returned unexpected content.");
  console.log(
    JSON.stringify(
      {
        version: pkg.version,
        dmg_url: manifest.url,
        manifest_url: manifestBlob.url,
        size: local.size,
        sha256,
      },
      null,
      2,
    ),
  );
}

(process.argv.includes("--prune-old") ? prune() : publish()).catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
