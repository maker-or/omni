export const UPDATE_PHASES = [
  "idle",
  "available",
  "scheduled",
  "preparing",
  "fetching-upstream",
  "agent-running",
  "installing-dependencies",
  "validating",
  "ready-to-promote",
  "promoting",
  "awaiting-health-check",
  "completed",
  "failed",
  "rolling-back",
] as const;

export type UpdatePhase = (typeof UPDATE_PHASES)[number];

export interface UpdateManifest {
  schema_version: 1;
  version: string;
  description: string;
  pr_url: string;
  repository_url: string;
  base_commit: string;
  target_commit: string;
  published_at: string;
  minimum_version: string;
  validation_commands: string[];
}

export interface ValidationResult {
  command: string;
  success: boolean;
  output: string;
  duration_ms: number;
}

export interface UpdateState {
  phase: UpdatePhase;
  from_version: string | null;
  to_version: string | null;
  manifest: UpdateManifest | null;
  started_at: string | null;
  updated_at: string;
  scheduled_for_quit: boolean;
  candidate_path: string | null;
  previous_path: string | null;
  dismissed_for_session: boolean;
  error: string | null;
  progress_message: string | null;
  validation_results: ValidationResult[];
  candidate_commit: string | null;
  agent_summary: string | null;
}

export interface InstallationMetadata {
  installed_version: string;
  official_base_commit: string;
  customized_head_commit: string;
  last_healthy_at: string;
}

export interface UpdateContext {
  manifest: UpdateManifest;
  installation: InstallationMetadata;
  candidate_path: string;
  upstream_diff_path: string;
  customization_diff_path: string;
  changed_files_path: string;
  upstream_changed_files: string[];
}

export interface UpdateProgress {
  phase: UpdatePhase;
  message: string;
  detail?: string;
}

export interface UpdateRunResult {
  success: boolean;
  cancelled?: boolean;
  error?: string;
}
