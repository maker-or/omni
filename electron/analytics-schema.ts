export type AnalyticsWindowType = "launch" | "main" | "companion" | "background";

export type AnalyticsSource =
  | "launch"
  | "agent_panel"
  | "agent_runtime"
  | "companion"
  | "overlay"
  | "overlay_comment"
  | "companion_prompt"
  | "chat_prompt"
  | "unknown";

export type IntentCategory =
  | "ui_customization"
  | "workflow_change"
  | "new_feature"
  | "integration"
  | "automation"
  | "performance_improvement"
  | "bug_fix"
  | "unknown";

export type MutationOutcome = "success" | "error" | "cancelled";

export type AnalyticsEventName =
  | "app_opened"
  | "project_created"
  | "worktree_created"
  | "workspace_switched"
  | "thread_created"
  | "component_mutation_requested"
  | "mutation_started"
  | "mutation_completed"
  | "mutation_accepted"
  | "mutation_rejected"
  | "rollback_executed"
  | "agent_run_completed"
  // v2 — usage & duration
  | "app_closed"
  | "app_heartbeat"
  // v2 — agents
  | "prompt_submitted"
  | "turn_completed"
  | "turn_failed"
  | "tokens_reported"
  | "tool_call_finished"
  | "subagent_run_completed"
  | "agent_connected"
  | "agent_connection_failed"
  | "agent_switched"
  // v2 — self-improving loop (visual/edit mode)
  | "edit_mode_entered"
  | "edit_build_reloaded"
  | "edit_accepted"
  | "edit_rejected"
  | "edit_rollback_health"
  // v2 — self-improving loop (launcher update)
  | "update_available"
  | "update_download_completed"
  | "update_promoted"
  | "update_health_result"
  | "update_completed"
  | "update_rolled_back"
  | "onboarding_step";

export interface AnalyticsBaseProperties {
  app_version: string;
  session_id: string;
  window_type: AnalyticsWindowType;
  platform: NodeJS.Platform;
}

export interface AnalyticsProperties {
  project_id?: string;
  thread_id?: string;
  model_id?: string;
  model_provider?: string;
  intent_category?: IntentCategory;
  component_id?: string;
  source?: AnalyticsSource;
  icon?: string;
  outcome?: MutationOutcome;
  execution_duration_ms?: number;
  files_changed_count?: number;
  error_type?: string;
  error_code?: string;
  success?: boolean;
  rejection_stage?: "before_completion" | "after_completion" | "after_review";

  // v2 — agent identity (also promoted onto base properties when available)
  agent_id?: string;
  agent_name?: string;
  active_agent_id?: string;
  from_agent_id?: string;
  to_agent_id?: string;

  // v2 — enum/string dimensions
  stop_reason?: string;
  tool_kind?: string;
  install_kind?: string;
  failure_code?: string;
  phase?: string;
  step?: string;
  status?: string;
  task_category?: IntentCategory;
  target_version?: string;
  cost_currency?: string;

  // v2 — numeric measures (clamped >= 0, rounded by the sanitizer)
  turn_duration_ms?: number;
  tokens_used?: number;
  context_size?: number;
  cost_amount?: number;
  session_duration_ms?: number;
  tool_call_count?: number;
  tool_duration_ms?: number;
  connect_duration_ms?: number;
  build_duration_ms?: number;
  download_duration_ms?: number;
  promotion_duration_ms?: number;
  health_check_duration_ms?: number;
  total_duration_ms?: number;
  time_to_accept_ms?: number;
  time_in_edit_ms?: number;
  iterations?: number;
  depth?: number;
  heartbeat_seconds?: number;

  // v2 — boolean flags
  /** Workspace context: true when the event happened on the project root ("main"). */
  is_main?: boolean;
  healthy?: boolean;
  has_images?: boolean;
  has_resources?: boolean;
  has_customizations?: boolean;
}

export interface AnalyticsEvent {
  name: AnalyticsEventName;
  windowType?: AnalyticsWindowType;
  properties?: AnalyticsProperties;
}
