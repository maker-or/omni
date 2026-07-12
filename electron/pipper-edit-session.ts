/**
 * Pipper edit-session accounting: which files an edit-mode agent changed,
 * and how to accept-list or revert exactly those files.
 *
 * The baseline is captured when edit mode starts: a fingerprint of every file
 * that was already dirty in the active workspace. Everything that is dirty
 * afterwards and either (a) wasn't dirty at baseline or (b) has a different
 * fingerprint than at baseline is attributed to the edit session.
 *
 * Invariants this module protects:
 * - Accept commits only files the edit session changed (never pre-existing
 *   unrelated dirt, never patch.md as a "changed file").
 * - Reject reverts only files the edit session changed; pre-existing dirty
 *   files the agent never touched survive a reject untouched.
 */
import * as fs from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type PipperEditBaseline = Map<string, string | null>;

export function dirtyFilesFromPorcelain(status: string): string[] {
  const paths: string[] = [];
  for (const line of status.split("\n")) {
    if (!line.trim()) continue;
    const body = line.slice(3);
    if (!body) continue;
    const renameParts = body.split(" -> ");
    if (renameParts.length > 1) {
      paths.push(renameParts[0], renameParts[renameParts.length - 1]);
    } else {
      paths.push(body);
    }
  }
  return paths.filter(Boolean);
}

export function isPatchMetadataFile(file: string): boolean {
  return file.replace(/\\/g, "/") === "patch.md";
}

function fingerprintPath(filePath: string): string {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) return `symlink:${fs.readlinkSync(filePath)}`;
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(filePath).sort();
    const hash = createHash("sha256");
    for (const entry of entries) {
      hash.update(entry);
      hash.update("\0");
      hash.update(fingerprintPath(join(filePath, entry)));
      hash.update("\0");
    }
    return `directory:${hash.digest("hex")}`;
  }
  return `file:${createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

export function workspaceFileFingerprint(root: string, file: string): string | null {
  const filePath = join(root, file);
  if (!fs.existsSync(filePath)) return null;
  return fingerprintPath(filePath);
}

async function gitStatusPorcelain(activePath: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: activePath });
  return String(stdout);
}

export async function capturePipperEditBaseline(activePath: string): Promise<PipperEditBaseline> {
  const files = dirtyFilesFromPorcelain(await gitStatusPorcelain(activePath)).filter(
    (file) => !isPatchMetadataFile(file),
  );
  return new Map(files.map((file) => [file, workspaceFileFingerprint(activePath, file)]));
}

export function changedSincePipperEditBaseline(
  baseline: PipperEditBaseline,
  activePath: string,
  file: string,
): boolean {
  if (!baseline.has(file)) return true;
  return baseline.get(file) !== workspaceFileFingerprint(activePath, file);
}

/** Files the edit session changed: dirty now AND not identical to baseline. */
export async function listPipperEditChangedFiles(
  activePath: string,
  baseline: PipperEditBaseline,
): Promise<string[]> {
  return dirtyFilesFromPorcelain(await gitStatusPorcelain(activePath)).filter(
    (file) =>
      !isPatchMetadataFile(file) && changedSincePipperEditBaseline(baseline, activePath, file),
  );
}

export interface PipperEditRevertResult {
  /** Files restored to their pre-edit-session state (or removed if created by it). */
  reverted: string[];
  /**
   * Files that were already dirty before the session AND were modified by it.
   * Their pre-session content is unknown (only a fingerprint was captured),
   * so they are left in place rather than destroyed.
   */
  kept: string[];
}

/**
 * Selectively reverts only what the edit session changed:
 * - files tracked in HEAD  -> `git checkout HEAD -- <file>`
 * - files created by the session (not in HEAD, not dirty at baseline) -> deleted
 * - untracked files that pre-dated the session but were modified by it -> kept
 *
 * Unlike a `git reset --hard && git clean -fd`, this never touches
 * pre-existing dirty files the agent did not modify.
 */
export async function revertPipperEditChanges(
  activePath: string,
  baseline: PipperEditBaseline,
): Promise<PipperEditRevertResult> {
  const changed = await listPipperEditChangedFiles(activePath, baseline);
  const { stdout } = await execFileAsync("git", ["ls-tree", "-r", "HEAD", "--name-only"], {
    cwd: activePath,
  });
  const inHead = new Set(
    String(stdout)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );

  const reverted: string[] = [];
  const kept: string[] = [];
  const toCheckout: string[] = [];
  const toRemove: string[] = [];
  for (const file of changed) {
    if (inHead.has(file)) {
      toCheckout.push(file);
    } else if (!baseline.has(file)) {
      toRemove.push(file);
    } else {
      kept.push(file);
    }
  }

  if (toRemove.length > 0) {
    // Unstage first in case the session staged its new files, then delete.
    await execFileAsync("git", ["reset", "-q", "HEAD", "--", ...toRemove], {
      cwd: activePath,
    }).catch(() => undefined);
    for (const file of toRemove) {
      fs.rmSync(join(activePath, file), { recursive: true, force: true });
      reverted.push(file);
    }
  }
  if (toCheckout.length > 0) {
    await execFileAsync("git", ["checkout", "HEAD", "--", ...toCheckout], { cwd: activePath });
    reverted.push(...toCheckout);
  }
  return { reverted, kept };
}
