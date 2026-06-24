import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { promisify } from "node:util";
import type { UpdateContext, UpdateManifest } from "../contracts/updates.ts";
import { getUpdatesPath } from "./workspace-manager.ts";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout.trimEnd();
}

function safeRelativePath(value: string): string {
  const clean = normalize(value).replace(/^[/\\]+/, "");
  if (!clean || clean.startsWith("..") || clean.includes("\0"))
    throw new Error(`Unsafe upstream path: ${value}`);
  return clean;
}

export async function assertCleanWorkspace(path: string): Promise<void> {
  const status = await git(path, ["status", "--porcelain"]);
  if (status)
    throw new Error(
      "Active workspace has uncommitted changes. Accept or reject the current edit first.",
    );
}

export async function getGitHead(path: string): Promise<string> {
  return git(path, ["rev-parse", "HEAD"]);
}

export async function acquireUpdateContext(
  candidatePath: string,
  manifest: UpdateManifest,
  repositoryUrl: string,
): Promise<UpdateContext> {
  const repository = new URL(repositoryUrl);
  const pr = new URL(manifest.pr_url);
  const repositoryPath = repository.pathname.replace(/\.git$/i, "").replace(/\/$/, "");
  const match = pr.pathname.match(
    new RegExp(`^${repositoryPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/pull/(\\d+)/?$`),
  );
  if (pr.origin !== repository.origin || !match) {
    throw new Error("Update PR URL does not belong to the configured upstream repository.");
  }
  const prNumber = match[1]!;
  const targetRef = `refs/pipper-update/pr-${prNumber}`;
  const contextPath = join(getUpdatesPath(), "context");
  await mkdir(contextPath, { recursive: true });
  await git(candidatePath, [
    "fetch",
    "--no-tags",
    repositoryUrl,
    `+refs/pull/${prNumber}/head:${targetRef}`,
  ]);
  const target = (await git(candidatePath, ["rev-parse", targetRef])).toLowerCase();
  const diffResponse = await fetch(`${manifest.pr_url}.diff`, {
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!diffResponse.ok) {
    throw new Error(`Pull request diff request failed (${diffResponse.status}).`);
  }
  const upstreamDiff = await diffResponse.text();
  if (!upstreamDiff.trim()) throw new Error("Pull request diff is empty.");
  const changed = manifest.files_changes.map(safeRelativePath);
  const upstreamFilesPath = join(contextPath, "upstream-files");
  await mkdir(upstreamFilesPath, { recursive: true });
  for (const file of changed) {
    try {
      const content = await git(candidatePath, ["show", `${target}:${file}`]);
      const destination = join(upstreamFilesPath, file);
      const backtrack = relative(upstreamFilesPath, destination);
      if (backtrack.startsWith("..")) throw new Error(`Unsafe upstream path: ${file}`);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content);
    } catch (error) {
      if (existsSync(join(upstreamFilesPath, file))) throw error;
    }
  }
  const manifestPath = join(contextPath, "manifest.json");
  const upstreamDiffPath = join(contextPath, "upstream.diff");
  const changedFilesPath = join(contextPath, "changed-files.json");
  await Promise.all([
    writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(upstreamDiffPath, upstreamDiff),
    writeFile(changedFilesPath, `${JSON.stringify(changed, null, 2)}\n`),
  ]);
  await readFile(manifestPath, "utf8");
  return {
    manifest,
    candidate_path: candidatePath,
    upstream_diff_path: upstreamDiffPath,
    changed_files_path: changedFilesPath,
    upstream_changed_files: changed,
  };
}

export function buildUpdaterPrompt(context: UpdateContext): string {
  return `You are updating a customized Pipper application.

Working directory:
${context.candidate_path}

You may modify files only inside this directory.
PR: ${context.manifest.pr_url}

Goal:
Port the upstream change represented by the supplied upstream PR onto this customized instance while preserving user customizations.

Sources of truth:
- The current customized candidate workspace and its local Git history.
- Upstream pull-request diff: ${context.upstream_diff_path}
- patch.md in the working directory. Use each change_id with git log -S when exact edit-mode changes need to be inspected.
- Files changed in the upstream PR: ${context.changed_files_path}
- Full upstream versions of those files: ${join(getUpdatesPath(), "context", "upstream-files")}


Rules:
- Preserve user-facing customizations unless they directly prevent the update.
- Apply all behavior introduced by the upstream change.
- Do not modify launcher or updater code, active, backup, previous, shared dependencies, or update state files.
- Do not modify files outside the candidate directory.
- Merge package.json semantically and preserve user-added dependencies where compatible.
- Do not manually edit bun.lock; the coordinator regenerates it.
- Do not commit or push.
- When complete, provide a concise summary of applied changes and unresolved risks.
- If upstream behavior conflicts with a customized implementation of the same feature, follow the upstream behavior while preserving unrelated user-specific behavior.`;
}
