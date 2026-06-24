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
  files_changes: string[];
}

export interface ValidationResult {
  command: string;
  success: boolean;
  output: string;
  duration_ms: number;
}

export interface UpdateState {
  phase: UpdatePhase;
  updated_at: string;
  scheduled_for_quit: boolean;
  error: string | null;
  run_id: string | null;
}

export interface InstallationMetadata {
  installed_version: string;
  customized_head_commit: string;
  last_healthy_at: string;
}

export type AgentRunStatus =
  | "pending"
  | "activating"
  | "prompt_sent"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled";

export type PromotionStatus =
  | "pending"
  | "swapped"
  | "health_ok"
  | "finalized"
  | "rolled_back"
  | "failed";

export type UpdateFailureCode =
  | "AGENT_ACTIVATION"
  | "AGENT_PROMPT"
  | "AGENT_RUNTIME"
  | "AGENT_CANCELLED"
  | "VALIDATION"
  | "PROMOTION_SWAP"
  | "PROMOTION_HEALTH"
  | "PROMOTION_FINALIZE"
  | "ACTIVE_DRIFT"
  | "INSTALLATION_STALE";

export interface UpdateFailure {
  code: UpdateFailureCode;
  message: string;
  step: "preflight" | "agent" | "validation" | "promotion";
  at: string;
}

export interface UpdateRunAgentState {
  status: AgentRunStatus;
  activated_at?: string;
  prompt_sent_at?: string;
  ended_at?: string;
  error?: string;
  session_id?: string;
  last_event?: "tool_start" | "tool_end" | "message" | "agent_end";
  tool_count?: number;
  summary?: string;
  candidate_dirty_files?: string[];
}

export interface UpdateRunPromotionState {
  status: PromotionStatus;
  candidate_commit?: string;
  active_head_before?: string;
  active_head_after_swap?: string;
  swapped_at?: string;
  health_at?: string;
  finalized_at?: string;
  error?: string;
  rollback_reason?: string;
}

export interface UpdateRunRecord {
  run_id: string;
  started_at: string;
  installed_version_at_start: string;
  target_version: string;
  pr_url: string;
  pr_number: number;
  git_ref: string;
  files_changes: string[];
  active_head_at_start: string;
  candidate_commit?: string;
  validation_results?: ValidationResult[];
  agent: UpdateRunAgentState;
  promotion: UpdateRunPromotionState;
  failure?: UpdateFailure;
  finished_at?: string;
  outcome?: "completed" | "failed" | "cancelled";
  log_path?: string;
}

export interface PromotionReceipt {
  previous_path: string;
  active_head_before: string;
  active_head_after: string;
  candidate_head: string;
  swapped_at: string;
}

export interface UpdatePromptContext {
  candidate_path: string;
  pr_url: string;
  pr_number: number;
  git_ref: string;
  files_changes: string[];
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
