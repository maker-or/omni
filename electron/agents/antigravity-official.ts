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
/**
 * How long a caller with a bounded UI phase budget (a thread switch) waits for
 * a first-use install before reporting progress. Matches the download's own
 * abort timeout. The install is shared and keeps running, so a later call
 * returns as soon as it completes.
 */
export const ANTIGRAVITY_INSTALL_WAIT_MS = 180_000;
/** A live installer refreshes its lock mtime on this cadence. */
const LOCK_HEARTBEAT_MS = 30_000;
/** Silence longer than this means the lock holder died without cleaning up. */
const LOCK_STALE_MS = 5 * 60_000;
const LOCK_WAIT_ATTEMPTS = 1200;
const LOCK_WAIT_INTERVAL_MS = 300;

export interface AntigravityRelease {
  archive: string;
  sha256: string;
  executable: string;
  files: readonly string[];
  args: readonly string[];
}

const RELEASES: Record<string, AntigravityRelease> = {
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
};

export function antigravityRelease(): AntigravityRelease | null {
  return RELEASES[`${platform()}-${arch()}`] ?? null;
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

interface InstallMarker {
  version: string;
  sha256: string;
  /** Extracted file name → byte size, so a damaged cache is repaired. */
  files: Record<string, number>;
}

async function isInstalled(release: AntigravityRelease): Promise<boolean> {
  try {
    const root = antigravityCacheRoot();
    const marker = JSON.parse(await readFile(join(root, "install.json"), "utf8")) as InstallMarker;
    if (marker.version !== VERSION || marker.sha256 !== release.sha256) return false;
    // Presence alone is not proof the cache is intact: a truncated or replaced
    // executable would be spawned on every use instead of being repaired. The
    // marker records each extracted file's size, so a damaged cache fails this
    // check and reinstalls. A marker without sizes (pre-integrity cache) also
    // fails, which reinstalls once.
    if (!marker.files) return false;
    for (const file of release.files) {
      if ((await stat(join(root, file))).size !== marker.files[file]) return false;
    }
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

async function download(release: AntigravityRelease, archive: string): Promise<void> {
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

/** Read the cross-process lock's nonce; null when no lock file exists. */
async function readLockNonce(lockPath: string): Promise<string | null> {
  try {
    return (await readFile(lockPath, "utf8")).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Remove a lock whose holder died. The nonce is re-read immediately before
 * unlinking: a concurrent installer may already have reclaimed the stale lock
 * and created its own, and deleting that fresh lock would let two installers
 * promote the same cache directory.
 */
async function reclaimStaleLock(lockPath: string): Promise<void> {
  const observed = await readLockNonce(lockPath);
  if (observed === null) return;
  let stale: boolean;
  try {
    stale = (await stat(lockPath)).mtimeMs < Date.now() - LOCK_STALE_MS;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return;
  }
  if (!stale) return;
  if ((await readLockNonce(lockPath)) !== observed) return;
  await rm(lockPath, { force: true });
}

let installing: Promise<string> | null = null;
/** Download Google's pinned ACP server into an app cache, never into the app bundle. */
export async function ensureAntigravityInstalled(
  options: { release?: AntigravityRelease } = {},
): Promise<string> {
  const release = options.release ?? antigravityRelease();
  if (!release)
    throw new Error(`Official Antigravity ACP is not supported on ${platform()} ${arch()}.`);
  if (await isInstalled(release)) return join(antigravityCacheRoot(), release.executable);
  if (installing) return installing;
  installing = (async () => {
    const root = antigravityCacheRoot();
    const parent = join(root, "..");
    await mkdir(parent, { recursive: true });
    const lockPath = `${root}.lock`;
    const lockNonce = randomUUID();
    let lock: Awaited<ReturnType<typeof open>> | null = null;
    for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt++) {
      try {
        lock = await open(lockPath, "wx", 0o600);
        await lock.writeFile(lockNonce);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (await isInstalled(release)) return join(root, release.executable);
        await reclaimStaleLock(lockPath);
        await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_INTERVAL_MS));
      }
    }
    if (!lock) throw new Error("Timed out waiting for Antigravity installation.");
    const heldLock = lock;
    // Keep the lock mtime fresh for the whole install. Without a heartbeat a
    // long download or extraction looks abandoned and a second installer
    // reclaims the lock, letting both promote the same cache directory.
    const heartbeat = setInterval(() => {
      const now = new Date();
      void heldLock.utimes(now, now).catch(() => {
        // Losing the heartbeat means the lock was reclaimed; promotion below
        // re-verifies ownership before touching the cache.
      });
    }, LOCK_HEARTBEAT_MS);
    heartbeat.unref?.();
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
        names.some((name) => !release.files.includes(name))
      )
        throw new Error("Antigravity archive contained unexpected files.");
      const files: Record<string, number> = {};
      for (const file of release.files) {
        await extractOne(archive, file, join(stage, file));
        if (platform() !== "win32") await chmod(join(stage, file), 0o700);
        files[file] = (await stat(join(stage, file))).size;
      }
      await rm(archive);
      await writeFile(
        join(stage, "install.json"),
        JSON.stringify({ version: VERSION, sha256: release.sha256, files }),
        { mode: 0o600 },
      );
      // Promotion is destructive (remove + rename): only the lock owner may
      // do it, or two installers can interleave cache generations.
      if ((await readLockNonce(lockPath)) !== lockNonce)
        throw new Error("Antigravity installation lock was reclaimed; retry the install.");
      await rm(root, { recursive: true, force: true });
      await rename(stage, root);
      return join(root, release.executable);
    } finally {
      await rm(stage, { recursive: true, force: true });
      clearInterval(heartbeat);
      // Only release the lock if it is still ours: a concurrent installer that
      // judged this lock stale and replaced it owns the path now.
      if ((await readLockNonce(lockPath)) === lockNonce) await rm(lockPath, { force: true });
      await heldLock.close();
    }
  })().finally(() => {
    installing = null;
  });
  return installing;
}

/**
 * Wait for a first-use install without outlasting the caller's UI budget.
 * Resolves false when the install is still running at the deadline; the
 * install itself is shared and keeps going, so a later call returns as soon as
 * it finishes. Genuine install failures still reject.
 */
export async function waitForAntigravityInstall(timeoutMs: number): Promise<boolean> {
  const install = ensureAntigravityInstalled();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([install.then(() => true), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
