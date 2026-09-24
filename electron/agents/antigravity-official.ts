import { createHash, randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, platform, arch } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VERSION = "1.2.1";
const MAX_ARCHIVE_BYTES = 300 * 1024 * 1024;
const RELEASES = {
  "darwin-arm64": {
    archive:
      "https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-1.2.1-darwin-arm64.zip",
    sha256: "0fab9938812e6b32b3b543e65e4f3a0025ceef755413db13542d9a9b81ea803c",
    executable: "agy_acp_server.par",
    files: ["agy_acp_server.par", "localharness_external"],
    args: [],
  },
  "win32-x64": {
    archive:
      "https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-1.2.1-windows-x86_64.zip",
    sha256: "9b82493819bc14613baa76264d55ad307ddd8ab4a8d6e110edb32da35498c07b",
    executable: "agy_acp_server.exe",
    files: ["agy_acp_server.exe", "localharness_external.exe"],
    args: [],
  },
} as const;

type Release = (typeof RELEASES)[keyof typeof RELEASES];
export function antigravityRelease(): Release | null {
  return RELEASES[`${platform()}-${arch()}` as keyof typeof RELEASES] ?? null;
}

export function antigravityCacheRoot(): string {
  const base =
    process.env.PIPPER_ACP_AGENT_CACHE ??
    (platform() === "darwin"
      ? join(homedir(), "Library", "Caches", "Pipper Code")
      : platform() === "win32"
        ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Pipper Code")
        : join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "pipper-code"));
  return join(base, "agents", "antigravity-acp", VERSION);
}

export function installedAntigravityPath(): string | null {
  const release = antigravityRelease();
  if (!release) return null;
  return join(antigravityCacheRoot(), release.executable);
}

async function isInstalled(release: Release): Promise<boolean> {
  try {
    const root = antigravityCacheRoot();
    const marker = JSON.parse(await readFile(join(root, "install.json"), "utf8"));
    if (marker.version !== VERSION || marker.sha256 !== release.sha256) return false;
    await Promise.all(release.files.map((file) => stat(join(root, file))));
    return true;
  } catch {
    return false;
  }
}

function command(command: string, args: string[], timeout = 30_000): Promise<string> {
  return execFileAsync(command, args, { timeout, maxBuffer: 1024 * 1024 }).then(
    ({ stdout }) => stdout,
  );
}

async function extractOne(archive: string, file: string, destination: string): Promise<void> {
  const args = platform() === "win32" ? ["-xOf", archive, file] : ["-p", archive, file];
  const child = spawn(platform() === "win32" ? "tar" : "unzip", args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-1000);
  });
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  try {
    await pipeline(child.stdout, createWriteStream(destination, { mode: 0o700 }));
    if ((await closed) !== 0) throw new Error(`Could not extract ${file}: ${stderr}`);
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
}

async function download(release: Release, archive: string): Promise<void> {
  const response = await fetch(release.archive, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body || new URL(response.url).hostname !== "dl.google.com")
    throw new Error(`Antigravity download failed (HTTP ${response.status}).`);
  const hash = createHash("sha256");
  let size = 0;
  await pipeline(
    Readable.fromWeb(response.body as never),
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > MAX_ARCHIVE_BYTES) callback(new Error("Antigravity archive is too large."));
        else {
          hash.update(chunk);
          callback(null, chunk);
        }
      },
    }),
    createWriteStream(archive, { mode: 0o600 }),
  );
  if (hash.digest("hex") !== release.sha256)
    throw new Error("Antigravity download checksum did not match the pinned release.");
}

let installing: Promise<string> | null = null;
/** Download Google's pinned ACP server into an app cache, never into the app bundle. */
export async function ensureAntigravityInstalled(): Promise<string> {
  const release = antigravityRelease();
  if (!release)
    throw new Error(`Official Antigravity ACP is not supported on ${platform()} ${arch()}.`);
  if (await isInstalled(release)) return join(antigravityCacheRoot(), release.executable);
  if (installing) return installing;
  installing = (async () => {
    const root = antigravityCacheRoot();
    const parent = join(root, "..");
    await mkdir(parent, { recursive: true });
    const lockPath = `${root}.lock`;
    let lock: Awaited<ReturnType<typeof open>> | null = null;
    for (let attempt = 0; attempt < 1200; attempt++) {
      try {
        lock = await open(lockPath, "wx", 0o600);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (await isInstalled(release)) return join(root, release.executable);
        try {
          if ((await stat(lockPath)).mtimeMs < Date.now() - 5 * 60_000)
            await rm(lockPath, { force: true });
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    if (!lock) throw new Error("Timed out waiting for Antigravity installation.");
    const stage = `${root}.${randomUUID()}.tmp`;
    try {
      if (await isInstalled(release)) return join(root, release.executable);
      await mkdir(stage, { recursive: true, mode: 0o700 });
      const archive = join(stage, "download.zip");
      await download(release, archive);
      const names = (
        await command(
          platform() === "win32" ? "tar" : "unzip",
          platform() === "win32" ? ["-tf", archive] : ["-Z", "-1", archive],
        )
      )
        .trim()
        .split(/\r?\n/);
      if (
        names.length !== release.files.length ||
        names.some((name) => !release.files.includes(name as never))
      )
        throw new Error("Antigravity archive contained unexpected files.");
      for (const file of release.files) {
        await extractOne(archive, file, join(stage, file));
        if (platform() !== "win32") await chmod(join(stage, file), 0o700);
      }
      await rm(archive);
      await writeFile(
        join(stage, "install.json"),
        JSON.stringify({ version: VERSION, sha256: release.sha256 }),
        { mode: 0o600 },
      );
      await rm(root, { recursive: true, force: true });
      await rename(stage, root);
      return join(root, release.executable);
    } finally {
      await rm(stage, { recursive: true, force: true });
      await lock.close();
      await rm(lockPath, { force: true });
    }
  })().finally(() => {
    installing = null;
  });
  return installing;
}
