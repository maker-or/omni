import { app } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SubagentConfig } from "../../contracts/acp.ts";

const FILE_NAME = "subagents.json";

export const DEFAULT_SUBAGENT_CONFIG: SubagentConfig = {
  enabled: true,
  allowedAgents: "all",
  maxConcurrent: 3,
  maxDepth: 2,
  autoApprovePermissions: true,
  runTimeoutMs: 10 * 60_000,
};

export function subagentConfigPath(baseDir?: string): string {
  return join(baseDir ?? app.getPath("userData"), FILE_NAME);
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Coerce arbitrary JSON into a valid config; unknown fields are dropped. */
export function sanitizeSubagentConfig(raw: unknown): SubagentConfig {
  const parsed = (raw ?? {}) as Partial<Record<keyof SubagentConfig, unknown>>;
  const defaults = DEFAULT_SUBAGENT_CONFIG;
  const allowedAgents =
    parsed.allowedAgents === "all"
      ? ("all" as const)
      : Array.isArray(parsed.allowedAgents)
        ? parsed.allowedAgents.filter((id): id is string => typeof id === "string")
        : defaults.allowedAgents;
  return {
    enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : defaults.enabled,
    allowedAgents,
    maxConcurrent: clamp(parsed.maxConcurrent, 1, 8, defaults.maxConcurrent),
    maxDepth: clamp(parsed.maxDepth, 1, 4, defaults.maxDepth),
    autoApprovePermissions:
      typeof parsed.autoApprovePermissions === "boolean"
        ? parsed.autoApprovePermissions
        : defaults.autoApprovePermissions,
    runTimeoutMs: clamp(parsed.runTimeoutMs, 30_000, 60 * 60_000, defaults.runTimeoutMs),
  };
}

export async function readSubagentConfig(baseDir?: string): Promise<SubagentConfig> {
  try {
    const raw = await readFile(subagentConfigPath(baseDir), "utf-8");
    return sanitizeSubagentConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SUBAGENT_CONFIG };
  }
}

export async function writeSubagentConfig(
  config: Partial<SubagentConfig>,
  baseDir?: string,
): Promise<SubagentConfig> {
  const current = await readSubagentConfig(baseDir);
  const next = sanitizeSubagentConfig({ ...current, ...config });
  const path = subagentConfigPath(baseDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(next, null, 2), "utf-8");
  return next;
}
