import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { promisify } from "node:util";
import type { InstallationMetadata, UpdateContext, UpdateManifest } from "../contracts/updates.ts";
import { getUpdatesPath } from "./workspace-manager.ts";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 50 * 1024 * 1024 });
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
  installation: InstallationMetadata,
): Promise<UpdateContext> {
  if (manifest.base_commit !== installation.official_base_commit.toLowerCase()) {
    throw new Error("Update base is incompatible with the installed official base commit.");
  }
  const contextPath = join(getUpdatesPath(), "context");
  await mkdir(contextPath, { recursive: true });
  await git(candidatePath, [
    "fetch",
    "--no-tags",
    manifest.repository_url,
    manifest.base_commit,
    manifest.target_commit,
  ]);
  const target = await git(candidatePath, ["rev-parse", manifest.target_commit]);
  if (target.toLowerCase() !== manifest.target_commit)
    throw new Error("Fetched target does not match pinned manifest commit.");
  const base = await git(candidatePath, ["rev-parse", manifest.base_commit]);
  if (base.toLowerCase() !== manifest.base_commit)
    throw new Error("Fetched PR base does not match the manifest.");
  const upstreamDiff = await git(candidatePath, [
    "diff",
    "--binary",
    `${manifest.base_commit}..${manifest.target_commit}`,
  ]);
  const customizationDiff = await git(candidatePath, [
    "diff",
    "--binary",
    `${installation.official_base_commit}..${installation.customized_head_commit}`,
  ]);
  const changed = (
    await git(candidatePath, [
      "diff",
      "--name-only",
      `${manifest.base_commit}..${manifest.target_commit}`,
    ])
  )
    .split("\n")
    .filter(Boolean)
    .map(safeRelativePath);
  const upstreamFilesPath = join(contextPath, "upstream-files");
  await mkdir(upstreamFilesPath, { recursive: true });
  for (const file of changed) {
    try {
      const content = await git(candidatePath, ["show", `${manifest.target_commit}:${file}`]);
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
  const customizationDiffPath = join(contextPath, "customization.diff");
  const changedFilesPath = join(contextPath, "changed-files.json");
  await Promise.all([
    writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(upstreamDiffPath, upstreamDiff),
    writeFile(customizationDiffPath, customizationDiff),
    writeFile(changedFilesPath, `${JSON.stringify(changed, null, 2)}\n`),
    writeFile(
      join(contextPath, "pr-metadata.json"),
      `${JSON.stringify({ pr_url: manifest.pr_url, base_sha: base, head_sha: target }, null, 2)}\n`,
    ),
  ]);
  await readFile(manifestPath, "utf8");
  return {
    manifest,
    installation,
    candidate_path: candidatePath,
    upstream_diff_path: upstreamDiffPath,
    customization_diff_path: customizationDiffPath,
    changed_files_path: changedFilesPath,
    upstream_changed_files: changed,
  };
}

export function buildUpdaterPrompt(context: UpdateContext): string {
  return `You are updating a customized Pipper application.

Working directory:
${context.candidate_path}

You may modify files only inside this directory.

Current installed version: ${context.installation.installed_version}
Target version: ${context.manifest.version}
Official base commit: ${context.installation.official_base_commit}
Pinned upstream target: ${context.manifest.target_commit}
PR: ${context.manifest.pr_url}

Goal:
Port the upstream change represented by the supplied upstream diff onto this customized instance while preserving user customizations.

Sources of truth:
1. Customization diff: ${context.customization_diff_path}
2. Upstream diff: ${context.upstream_diff_path}
3. patch.md in the working directory.
4. Upstream changed-file list: ${context.changed_files_path}
5. Full upstream file contents under ${join(getUpdatesPath(), "context", "upstream-files")}.

Rules:
- Preserve user-facing customizations unless they directly prevent the update.
- Apply all behavior introduced by the upstream change.
- Do not modify launcher or updater code, active, backup, previous, shared dependencies, or update state files.
- Do not modify files outside the candidate directory.
- Merge package.json semantically and preserve user-added dependencies where compatible.
- Do not manually edit bun.lock; the coordinator regenerates it.
- Do not commit or push.
- When complete, provide a concise summary of applied changes and unresolved risks.`;
}
