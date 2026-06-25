import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function dirtyFilesFromStatus(status: string): string[] {
  return status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.slice(3).split(" -> ").at(-1) ?? "")
    .filter(Boolean);
}

export interface UpstreamFileDiffStat {
  file: string;
  diffLines: number;
  hasDiff: boolean;
}

export interface CandidateWorkspaceDiagnostics {
  candidateHead: string;
  gitStatusShort: string;
  dirtyFiles: string[];
  upstreamDiffs: UpstreamFileDiffStat[];
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 });
  return stdout.trimEnd();
}

export async function getCandidateWorkspaceDiagnostics(
  candidatePath: string,
  gitRef: string,
  filesChanges: string[],
): Promise<CandidateWorkspaceDiagnostics> {
  const [candidateHead, gitStatusShort] = await Promise.all([
    git(candidatePath, ["rev-parse", "HEAD"]),
    git(candidatePath, ["status", "--short"]),
  ]);
  const dirtyFiles = dirtyFilesFromStatus(gitStatusShort);
  const upstreamDiffs: UpstreamFileDiffStat[] = [];
  for (const file of filesChanges) {
    try {
      const diff = await git(candidatePath, ["diff", "--numstat", `HEAD...${gitRef}`, "--", file]);
      const diffLines = diff
        .split("\n")
        .filter(Boolean)
        .reduce((total, line) => {
          const [added, removed] = line.split("\t");
          return total + Number(added ?? 0) + Number(removed ?? 0);
        }, 0);
      upstreamDiffs.push({ file, diffLines, hasDiff: diffLines > 0 });
    } catch {
      upstreamDiffs.push({ file, diffLines: 0, hasDiff: false });
    }
  }
  return { candidateHead, gitStatusShort, dirtyFiles, upstreamDiffs };
}

export function formatDiagnosticsForLog(
  label: string,
  diagnostics: CandidateWorkspaceDiagnostics,
): string[] {
  const lines = [
    `candidate_diag=${label} head=${diagnostics.candidateHead}`,
    `candidate_diag=${label} dirty_count=${diagnostics.dirtyFiles.length}`,
  ];
  if (diagnostics.dirtyFiles.length > 0) {
    lines.push(`candidate_diag=${label} dirty_files=${JSON.stringify(diagnostics.dirtyFiles)}`);
  }
  if (diagnostics.gitStatusShort) {
    for (const statusLine of diagnostics.gitStatusShort.split("\n")) {
      lines.push(`candidate_diag=${label} git_status ${statusLine}`);
    }
  } else {
    lines.push(`candidate_diag=${label} git_status <clean>`);
  }
  for (const upstream of diagnostics.upstreamDiffs) {
    lines.push(
      `candidate_diag=${label} upstream file=${upstream.file} pending_lines=${upstream.diffLines} has_diff=${upstream.hasDiff}`,
    );
  }
  return lines;
}
