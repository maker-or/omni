import { execFile } from "node:child_process";
import { normalize } from "node:path";
import { promisify } from "node:util";
import type { UpdateManifest, UpdatePromptContext } from "../contracts/updates.ts";

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

export function getUpdatePrNumber(manifest: UpdateManifest, repositoryUrl: string): number {
  const repository = new URL(repositoryUrl);
  const pr = new URL(manifest.pr_url);
  const repositoryPath = repository.pathname.replace(/\.git$/i, "").replace(/\/$/, "");
  const match = pr.pathname.match(
    new RegExp(`^${repositoryPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/pull/(\\d+)/?$`),
  );
  if (pr.origin !== repository.origin || !match) {
    throw new Error("Update PR URL does not belong to the configured upstream repository.");
  }
  return Number(match[1]);
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

export async function fetchUpstreamRef(
  candidatePath: string,
  manifest: UpdateManifest,
  repositoryUrl: string,
): Promise<UpdatePromptContext> {
  const prNumber = getUpdatePrNumber(manifest, repositoryUrl);
  const targetRef = `refs/pipper-update/pr-${prNumber}`;
  await git(candidatePath, [
    "fetch",
    "--no-tags",
    repositoryUrl,
    `+refs/pull/${prNumber}/head:${targetRef}`,
  ]);
  await git(candidatePath, ["rev-parse", targetRef]);
  return {
    candidate_path: candidatePath,
    pr_url: manifest.pr_url,
    pr_number: prNumber,
    git_ref: targetRef,
    files_changes: manifest.files_changes.map(safeRelativePath),
  };
}

export function buildUpdaterPrompt(context: UpdatePromptContext): string {
  return `You are updating a customized Pipper application.

Working directory:
${context.candidate_path}

You may modify files only inside this directory.
PR: ${context.pr_url} (#${context.pr_number})
Git ref: ${context.git_ref}
Files changed:
${context.files_changes.map((file) => `- ${file}`).join("\n")}

Goal:
Port the upstream change represented by the supplied upstream PR onto this customized instance while preserving user customizations.

Sources of truth:
- The current customized candidate workspace and its local Git history.
- The fetched upstream PR ref: ${context.git_ref}
- patch.md in the working directory. Use each change_id with git log -S when exact edit-mode changes need to be inspected.
- Use git show ${context.git_ref}:<path> to inspect upstream file versions.
- Use git diff HEAD...${context.git_ref} -- <path> to inspect upstream changes.


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
