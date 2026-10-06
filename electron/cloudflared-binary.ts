import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Pinned cloudflared release. Upgrading = bump the version and replace every
 * digest below with GitHub's `digest` field for that release's assets
 * (api.github.com/repos/cloudflare/cloudflared/releases). Use GitHub's
 * digests, not the checksum list in the release notes: the macOS archives
 * are re-uploaded after signing, so the notes' values for them go stale.
 */
export const CLOUDFLARED_VERSION = "2026.9.3";

export interface CloudflaredAsset {
  file: string;
  sha256: string;
  /** macOS ships as a .tgz holding the binary; other platforms ship it raw. */
  archive: "tgz" | "raw";
}

const ASSETS: Readonly<Record<string, CloudflaredAsset>> = {
  "darwin-arm64": {
    file: "cloudflared-darwin-arm64.tgz",
    sha256: "587c2cfb1c230fe36c7fa7727da78be459dae028cabe8c001291999350f07095",
    archive: "tgz",
  },
  "darwin-x64": {
    file: "cloudflared-darwin-amd64.tgz",
    sha256: "d1155d0837487f261183b15c1eab6c4ebcad9dc49b94675f1524c3564cea3977",
    archive: "tgz",
  },
  "linux-x64": {
    file: "cloudflared-linux-amd64",
    sha256: "77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2",
    archive: "raw",
  },
  "linux-arm64": {
    file: "cloudflared-linux-arm64",
    sha256: "aaeb2d7d0da3614634c7e03ab13487a1522c2e79165ed2929cfe23d5e95b326d",
    archive: "raw",
  },
  "win32-x64": {
    file: "cloudflared-windows-amd64.exe",
    sha256: "f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2",
    archive: "raw",
  },
};

/** Largest download accepted; the real assets are 20–55 MB. */
const MAX_DOWNLOAD_BYTES = 120 * 1024 * 1024;
const VALIDATE_TIMEOUT_MS = 15_000;

export interface CloudflaredBinaryOptions {
  /** Managed installs live under <installRoot>/<version>/<platform>-<arch>/. */
  installRoot: string;
  /** Explicit binary (PIPPER_CLOUDFLARED_PATH). Used as-is, never downloaded. */
  overridePath?: string | null;
  /** Binary shipped inside the app bundle, if a build includes one. */
  bundledPath?: string | null;
  platform?: NodeJS.Platform;
  arch?: string;
  version?: string;
  assets?: Readonly<Record<string, CloudflaredAsset>>;
  downloadBaseUrl?: string;
  fetchImpl?: typeof fetch;
  onProgress?: (phase: "downloading" | "verifying" | "installed") => void;
}

/** Run `<bin> --version`; resolves to its output or throws if it isn't cloudflared. */
async function validateBinary(bin: string, expectVersion?: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync(bin, ["--version"], {
    timeout: VALIDATE_TIMEOUT_MS,
    windowsHide: true,
  });
  const output = `${stdout}${stderr}`.trim();
  if (!/cloudflared version/i.test(output)) {
    throw new Error(`${bin} is not a cloudflared binary`);
  }
  if (expectVersion && !output.includes(expectVersion)) {
    throw new Error(`${bin} is not cloudflared ${expectVersion}: ${output}`);
  }
  return output;
}

/** Stream `url` to `dest`, capping size; resolves to the file's SHA-256 hex. */
async function download(url: string, dest: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_DOWNLOAD_BYTES) throw new Error(`Download too large: ${declared} bytes`);
  const hash = createHash("sha256");
  const out = createWriteStream(dest, { mode: 0o600 });
  let size = 0;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > MAX_DOWNLOAD_BYTES) throw new Error("Download exceeded the size limit");
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve());
      out.once("error", reject);
    });
  }
  return hash.digest("hex");
}

/**
 * Finds a usable cloudflared, installing the pinned release on first use so
 * users never install anything themselves. Order: explicit override →
 * bundled binary → managed install → download. A download is only accepted
 * when its SHA-256 matches the pinned digest, and it is staged in a scratch
 * directory and moved into place only after it runs, so a partial or
 * tampered download is never left where a later launch would pick it up.
 */
export class CloudflaredBinary {
  private readonly options: CloudflaredBinaryOptions;
  private pending: Promise<string> | null = null;

  constructor(options: CloudflaredBinaryOptions) {
    this.options = options;
  }

  /** Absolute path of a validated cloudflared binary. Concurrent calls share one install. */
  resolve(): Promise<string> {
    this.pending ??= this.locate().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private get platformKey(): string {
    return `${this.options.platform ?? process.platform}-${this.options.arch ?? process.arch}`;
  }

  private get version(): string {
    return this.options.version ?? CLOUDFLARED_VERSION;
  }

  /** Where the managed binary lives (whether or not it is installed yet). */
  managedPath(): string {
    const exe =
      (this.options.platform ?? process.platform) === "win32" ? "cloudflared.exe" : "cloudflared";
    return join(this.options.installRoot, this.version, this.platformKey, exe);
  }

  private async locate(): Promise<string> {
    const { overridePath, bundledPath } = this.options;
    if (overridePath) {
      await validateBinary(overridePath);
      return overridePath;
    }
    if (bundledPath && existsSync(bundledPath)) {
      await validateBinary(bundledPath);
      return bundledPath;
    }
    const managed = this.managedPath();
    if (existsSync(managed)) {
      try {
        await validateBinary(managed, this.version);
        return managed;
      } catch {
        // Broken or replaced install: fall through and reinstall.
      }
    }
    return this.install();
  }

  private async install(): Promise<string> {
    const asset = (this.options.assets ?? ASSETS)[this.platformKey];
    if (!asset) throw new Error(`No cloudflared build is pinned for ${this.platformKey}`);
    const finalPath = this.managedPath();
    const finalDir = join(finalPath, "..");
    const staging = `${finalDir}.staging-${randomBytes(6).toString("hex")}`;
    await mkdir(staging, { recursive: true });
    try {
      const base =
        this.options.downloadBaseUrl ??
        `https://github.com/cloudflare/cloudflared/releases/download/${this.version}`;
      const archivePath = join(staging, asset.file);
      this.options.onProgress?.("downloading");
      const digest = await download(
        `${base}/${asset.file}`,
        archivePath,
        this.options.fetchImpl ?? fetch,
      );
      this.options.onProgress?.("verifying");
      if (digest !== asset.sha256) {
        throw new Error(
          `cloudflared checksum mismatch for ${asset.file}: expected ${asset.sha256}, got ${digest}`,
        );
      }
      const exeName = finalPath.slice(finalDir.length + 1);
      const stagedBinary = join(staging, exeName);
      if (asset.archive === "tgz") {
        const unpack = join(staging, "unpack");
        await mkdir(unpack);
        await execFileAsync("tar", ["-xzf", archivePath, "-C", unpack], { timeout: 60_000 });
        const entries = await readdir(unpack);
        if (!entries.includes("cloudflared")) {
          throw new Error(`${asset.file} does not contain a cloudflared binary`);
        }
        await rename(join(unpack, "cloudflared"), stagedBinary);
      } else {
        await rename(archivePath, stagedBinary);
      }
      await chmod(stagedBinary, 0o755);
      await validateBinary(stagedBinary, this.version);
      // Move into place last: an interrupted install leaves only staging junk.
      await rm(finalDir, { recursive: true, force: true });
      await mkdir(join(finalDir, ".."), { recursive: true });
      await mkdir(finalDir);
      await rename(stagedBinary, finalPath);
      this.options.onProgress?.("installed");
      return finalPath;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}
