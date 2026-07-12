import { createHash, timingSafeEqual } from "node:crypto";
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { open } from "node:fs/promises";
import os from "node:os";
import { basename, join, resolve } from "node:path";
import { clipboard, shell } from "electron";
import type {
  LauncherDownloadProgress,
  LauncherUpdateDiagnostics,
  LauncherUpdateManifest,
  LauncherUpdateState,
} from "../contracts/launcher-updates.ts";
import {
  launcherArtifactFileName,
  launcherManagedDownloadPattern,
  resolveLauncherUpdatePlatform,
  type LauncherUpdatePlatform,
} from "./launcher-update-artifact.ts";
import {
  compareLauncherVersions,
  parseLauncherUpdateManifest,
} from "./launcher-update-manifest.ts";
import {
  assertLauncherUpdateTransition,
  createIdleLauncherUpdateState,
  readLauncherUpdateState,
  writeLauncherUpdateStateAtomic,
} from "./launcher-update-state.ts";

const FIVE_HOURS = 5 * 60 * 60 * 1000;
const CHECK_TIMEOUT = 10_000;
const DOWNLOAD_TIMEOUT = 30 * 60 * 1000;
const MAX_BYTES = 1024 * 1024 * 1024;

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n]+/g, " ")
    .slice(0, 400);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a.toLowerCase(), "hex");
  const right = Buffer.from(b.toLowerCase(), "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export class LauncherUpdateManager {
  private readonly platform: LauncherUpdatePlatform;
  private readonly options: {
    currentVersion: string;
    manifestUrl: string | null;
    rootPath: string;
    enabled: boolean;
    broadcastState: (state: LauncherUpdateState) => void;
    broadcastProgress: (progress: LauncherDownloadProgress) => void;
    fetchImpl?: typeof fetch;
  };
  private state: LauncherUpdateState;
  private dismissed = false;
  private checkPromise: Promise<LauncherUpdateState> | null = null;
  private downloadPromise: Promise<LauncherUpdateState> | null = null;
  private abortController: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: {
    currentVersion: string;
    manifestUrl: string | null;
    rootPath: string;
    enabled: boolean;
    platform?: LauncherUpdatePlatform;
    broadcastState: (state: LauncherUpdateState) => void;
    broadcastProgress: (progress: LauncherDownloadProgress) => void;
    fetchImpl?: typeof fetch;
  }) {
    this.options = options;
    this.platform = options.platform ?? resolveLauncherUpdatePlatform(process.platform);
    this.state = createIdleLauncherUpdateState(options.currentVersion);
  }

  private get statePath() {
    return join(this.options.rootPath, "state.json");
  }
  private get downloadsPath() {
    return join(this.options.rootPath, "downloads");
  }
  private fetch(input: string, init?: RequestInit) {
    return (this.options.fetchImpl ?? fetch)(input, init);
  }
  private isManagedDownloadPath(path: string): boolean {
    const root = `${resolve(this.downloadsPath)}/`;
    const resolved = resolve(path);
    return (
      resolved.startsWith(root) &&
      launcherManagedDownloadPattern(this.platform).test(basename(resolved))
    );
  }

  getState(): LauncherUpdateState {
    return structuredClone(this.state);
  }
  isDismissedForSession(): boolean {
    return this.dismissed;
  }

  private setState(
    phase: LauncherUpdateState["phase"],
    patch: Partial<LauncherUpdateState> = {},
    persist = true,
  ): LauncherUpdateState {
    assertLauncherUpdateTransition(this.state.phase, phase);
    this.state = {
      ...this.state,
      ...patch,
      phase,
      current_version: this.options.currentVersion,
      updated_at: new Date().toISOString(),
    };
    if (persist) writeLauncherUpdateStateAtomic(this.statePath, this.state);
    this.options.broadcastState(this.getState());
    return this.getState();
  }

  async recover(): Promise<LauncherUpdateState> {
    mkdirSync(this.downloadsPath, { recursive: true, mode: 0o700 });
    for (const file of readdirSync(this.downloadsPath))
      if (file.endsWith(".partial")) rmSync(join(this.downloadsPath, file), { force: true });
    try {
      this.state = readLauncherUpdateState(this.statePath, this.options.currentVersion);
      if (this.state.downloaded_path && !this.isManagedDownloadPath(this.state.downloaded_path))
        throw new Error("Launcher update state contains an unmanaged download path.");
      if (this.state.manifest) {
        const normalized = parseLauncherUpdateManifest(
          this.state.manifest,
          this.options.currentVersion,
          this.platform,
        );
        if (normalized) this.state.manifest = normalized;
      }
    } catch (error) {
      if (existsSync(this.statePath))
        renameSync(this.statePath, join(this.options.rootPath, `state.corrupt-${Date.now()}.json`));
      this.state = {
        ...createIdleLauncherUpdateState(this.options.currentVersion),
        error: `Recovered unreadable launcher update state: ${message(error)}`,
      };
      this.options.broadcastState(this.getState());
      return this.getState();
    }
    if (
      this.state.manifest &&
      compareLauncherVersions(this.options.currentVersion, this.state.manifest.version) >= 0
    ) {
      if (this.state.downloaded_path) rmSync(this.state.downloaded_path, { force: true });
      this.state = createIdleLauncherUpdateState(this.options.currentVersion);
      writeLauncherUpdateStateAtomic(this.statePath, this.state);
    } else if (this.state.phase === "checking") this.state.phase = "idle";
    else if (this.state.phase === "downloading") {
      // The crashed download's .partial file was already deleted above; drop
      // the stale path too so recovery actions (open download folder,
      // diagnostics) never point at a file that no longer exists.
      this.state.phase = this.state.manifest ? "available" : "idle";
      this.state.downloaded_path = null;
      this.state.downloaded_sha256 = null;
    } else if (
      this.state.phase === "downloaded" &&
      (!this.state.downloaded_path ||
        !existsSync(this.state.downloaded_path) ||
        !lstatSync(this.state.downloaded_path).isFile())
    ) {
      this.state.phase = this.state.manifest ? "available" : "idle";
      this.state.error = "The downloaded installer was removed. Download it again.";
      this.state.downloaded_path = null;
      this.state.downloaded_sha256 = null;
    }
    this.state.updated_at = new Date().toISOString();
    writeLauncherUpdateStateAtomic(this.statePath, this.state);
    this.options.broadcastState(this.getState());
    return this.getState();
  }

  startPeriodicChecks(): void {
    if (!this.timer && this.options.enabled && this.options.manifestUrl)
      this.timer = setInterval(() => void this.check(), FIVE_HOURS);
  }
  stopPeriodicChecks(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  check(): Promise<LauncherUpdateState> {
    if (this.checkPromise) return this.checkPromise;
    if (this.downloadPromise || !this.options.enabled || !this.options.manifestUrl)
      return Promise.resolve(this.getState());
    this.checkPromise = this.performCheck().finally(() => {
      this.checkPromise = null;
    });
    return this.checkPromise;
  }

  private async performCheck(): Promise<LauncherUpdateState> {
    const previous = this.getState();
    this.setState("checking", { error: null });
    let received = false;
    try {
      const response = await this.fetch(this.options.manifestUrl!, {
        cache: "no-store",
        signal: AbortSignal.timeout(CHECK_TIMEOUT),
      });
      received = true;
      if (!response.ok) throw new Error(`Manifest request failed with HTTP ${response.status}.`);
      const manifest = parseLauncherUpdateManifest(
        await response.json(),
        this.options.currentVersion,
        this.platform,
      );
      const checkedAt = new Date().toISOString();
      if (!manifest) {
        if (previous.downloaded_path) rmSync(previous.downloaded_path, { force: true });
        return this.setState("idle", {
          manifest: null,
          downloaded_path: null,
          downloaded_sha256: null,
          error: null,
          last_checked_at: checkedAt,
        });
      }
      const sameDownload =
        previous.phase === "downloaded" &&
        previous.manifest?.version === manifest.version &&
        previous.downloaded_sha256 === manifest.sha256 &&
        previous.downloaded_path &&
        existsSync(previous.downloaded_path);
      if (sameDownload)
        return this.setState("downloaded", {
          ...previous,
          manifest,
          error: null,
          last_checked_at: checkedAt,
        });
      if (previous.downloaded_path) rmSync(previous.downloaded_path, { force: true });
      return this.setState("available", {
        manifest,
        downloaded_path: null,
        downloaded_sha256: null,
        error: null,
        last_checked_at: checkedAt,
      });
    } catch (error) {
      const patch = {
        error: message(error),
        last_checked_at: received ? new Date().toISOString() : previous.last_checked_at,
      };
      if (
        previous.phase === "downloaded" &&
        previous.downloaded_path &&
        existsSync(previous.downloaded_path)
      )
        return this.setState("downloaded", { ...previous, ...patch });
      return this.setState("failed", patch);
    }
  }

  download(): Promise<LauncherUpdateState> {
    if (this.downloadPromise) return this.downloadPromise;
    if (!this.state.manifest || !["available", "failed"].includes(this.state.phase))
      return Promise.reject(new Error("No launcher update is available to download."));
    this.downloadPromise = this.performDownload(this.state.manifest).finally(() => {
      this.downloadPromise = null;
      this.abortController = null;
    });
    return this.downloadPromise;
  }

  retryDownload(): Promise<LauncherUpdateState> {
    return this.download();
  }

  private async performDownload(manifest: LauncherUpdateManifest): Promise<LauncherUpdateState> {
    this.abortController = new AbortController();
    const timeout = setTimeout(
      () => this.abortController?.abort(new Error("Download timed out.")),
      DOWNLOAD_TIMEOUT,
    );
    const partial = join(
      this.downloadsPath,
      `${launcherArtifactFileName(manifest.version, this.platform)}.partial`,
    );
    const final = partial.slice(0, -8);
    rmSync(partial, { force: true });
    rmSync(final, { force: true });
    this.setState("downloading", {
      error: null,
      downloaded_path: partial,
      downloaded_sha256: null,
    });
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      const response = await this.fetch(manifest.url, {
        redirect: "follow",
        signal: this.abortController.signal,
      });
      if (!response.ok || !response.body)
        throw new Error(`Installer request failed with HTTP ${response.status}.`);
      if (new URL(response.url || manifest.url).protocol !== "https:")
        throw new Error("Installer redirected to an insecure URL.");
      const lengthHeader = response.headers.get("content-length");
      if (lengthHeader != null && !/^\d+$/.test(lengthHeader))
        throw new Error("Installer content length is invalid.");
      const total = lengthHeader == null ? null : Number(lengthHeader);
      if (total != null && (!Number.isSafeInteger(total) || total < 0 || total > MAX_BYTES))
        throw new Error("Installer size is invalid or exceeds 1 GiB.");
      mkdirSync(this.downloadsPath, { recursive: true, mode: 0o700 });
      handle = await open(partial, "w", 0o600);
      const reader = response.body.getReader();
      const hash = createHash("sha256");
      let received = 0;
      let lastProgress = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_BYTES) throw new Error("Installer exceeds the 1 GiB size limit.");
        hash.update(value);
        let offset = 0;
        while (offset < value.byteLength) {
          const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset);
          if (bytesWritten <= 0) throw new Error("Unable to write the installer to disk.");
          offset += bytesWritten;
        }
        const now = Date.now();
        if (now - lastProgress >= 100) {
          this.options.broadcastProgress({
            received_bytes: received,
            total_bytes: total,
            percent: total ? Math.min(100, (received / total) * 100) : null,
          });
          lastProgress = now;
        }
      }
      await handle.sync();
      await handle.close();
      handle = null;
      const actual = hash.digest("hex");
      if (!hashesMatch(actual, manifest.sha256))
        throw new Error("Installer SHA-256 verification failed.");
      renameSync(partial, final);
      this.options.broadcastProgress({
        received_bytes: received,
        total_bytes: total,
        percent: total ? 100 : null,
      });
      return this.setState("downloaded", {
        downloaded_path: final,
        downloaded_sha256: actual,
        error: null,
      });
    } catch (error) {
      await handle?.close().catch(() => {});
      rmSync(partial, { force: true });
      const cancelled =
        this.abortController.signal.aborted && this.abortController.signal.reason === "user";
      return this.setState(cancelled ? "available" : "failed", {
        downloaded_path: null,
        downloaded_sha256: null,
        error: cancelled ? null : message(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async cancelDownload(): Promise<LauncherUpdateState> {
    if (!this.downloadPromise) return this.getState();
    this.abortController?.abort("user");
    await this.downloadPromise;
    return this.getState();
  }

  dismissForSession(): LauncherUpdateState {
    this.dismissed = true;
    this.options.broadcastState(this.getState());
    return this.getState();
  }
  showForSession(): void {
    this.dismissed = false;
    this.options.broadcastState(this.getState());
  }

  async verifyDownloadedInstaller(): Promise<string> {
    if (this.state.phase !== "downloaded" || !this.state.manifest || !this.state.downloaded_path)
      throw new Error("No verified launcher installer is ready.");
    if (!existsSync(this.state.downloaded_path) || !lstatSync(this.state.downloaded_path).isFile())
      throw new Error("The downloaded installer is missing.");
    const actual = await sha256File(this.state.downloaded_path);
    if (!hashesMatch(actual, this.state.manifest.sha256))
      throw new Error("The downloaded installer changed after verification.");
    return this.state.downloaded_path;
  }

  recordFailure(error: unknown, retainDownload = true): LauncherUpdateState {
    return this.setState("failed", {
      error: message(error),
      downloaded_path: retainDownload ? this.state.downloaded_path : null,
    });
  }
  async openDownloadFolder(): Promise<void> {
    if (!this.state.downloaded_path) throw new Error("No manager-owned download exists.");
    shell.showItemInFolder(this.state.downloaded_path);
  }
  async downloadInBrowser(): Promise<void> {
    if (!this.state.manifest) throw new Error("No validated artifact URL exists.");
    await shell.openExternal(this.state.manifest.url);
  }
  async clearDownloadedUpdate(): Promise<LauncherUpdateState> {
    await this.cancelDownload();
    if (this.state.downloaded_path) rmSync(this.state.downloaded_path, { force: true });
    return this.setState(this.state.manifest ? "available" : "idle", {
      downloaded_path: null,
      downloaded_sha256: null,
      error: null,
    });
  }

  getDiagnostics(): LauncherUpdateDiagnostics {
    const home = os.homedir();
    const redact = (value: string | null) => (value && home ? value.replace(home, "~") : value);
    const redactUrl = (value: string | null) => {
      if (!value) return null;
      try {
        const url = new URL(value);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
      } catch {
        return null;
      }
    };
    return {
      current_version: this.options.currentVersion,
      pending_version: this.state.manifest?.version ?? null,
      phase: this.state.phase,
      platform: this.platform,
      manifest_url: redactUrl(this.options.manifestUrl),
      artifact_url: redactUrl(this.state.manifest?.url ?? null),
      download_path: redact(this.state.downloaded_path),
      expected_sha256: this.state.manifest?.sha256 ?? null,
      actual_sha256: this.state.downloaded_sha256,
      last_checked_at: this.state.last_checked_at,
      updated_at: this.state.updated_at,
      last_error: this.state.error,
    };
  }

  copyDiagnostics(): void {
    const d = this.getDiagnostics();
    clipboard.writeText(
      Object.entries(d)
        .map(([key, value]) => `${key}: ${value ?? "—"}`)
        .join("\n"),
    );
  }
}
