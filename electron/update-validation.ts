import { exec } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { UpdateManifest, ValidationResult } from "../contracts/updates.ts";

const execAsync = promisify(exec);

const PROTECTED_PREFIXES = [
  "electron/",
  "contracts/updates",
  "contracts/launcher-updates",
  "src/store/update-store",
  "src/store/launcher-update-store",
  "src/components/update-",
  "src/components/launcher-update",
  "src/launch/update-stage",
];

async function run(path: string, command: string): Promise<ValidationResult> {
  const started = Date.now();
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: path,
      maxBuffer: 20 * 1024 * 1024,
    });
    return {
      command,
      success: true,
      output: `${stdout}${stderr}`.trim(),
      duration_ms: Date.now() - started,
    };
  } catch (error: any) {
    return {
      command,
      success: false,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`.trim(),
      duration_ms: Date.now() - started,
    };
  }
}

export async function validateCandidate(
  path: string,
  manifest: UpdateManifest,
): Promise<ValidationResult[]> {
  for (const required of [
    "package.json",
    "bun.lock",
    "src/main.tsx",
    "src/App.tsx",
    "index.html",
  ]) {
    if (!existsSync(join(path, required)))
      throw new Error(`Candidate is missing required entry point: ${required}`);
  }
  const packageJson = JSON.parse(readFileSync(join(path, "package.json"), "utf8")) as {
    version?: string;
  };
  if (packageJson.version && packageJson.version !== manifest.version) {
    throw new Error(
      `Candidate package version ${packageJson.version} does not match ${manifest.version}.`,
    );
  }
  const status = await run(path, "git status --short");
  const changedFiles = status.output
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => line.slice(3).split(" -> "));
  if (changedFiles.length === 0) throw new Error("Update agent produced no candidate changes.");
  const protectedFile = changedFiles.find((file) =>
    PROTECTED_PREFIXES.some((prefix) => file.startsWith(prefix)),
  );
  if (protectedFile)
    throw new Error(`Update modified protected launcher/updater file: ${protectedFile}`);
  const commands = ["bun run build"];
  const results = [status];
  for (const command of commands) {
    const result = await run(path, command);
    results.push(result);
    if (!result.success)
      throw Object.assign(new Error(`Validation failed: ${command}`), {
        results,
      });
  }
  return results;
}
