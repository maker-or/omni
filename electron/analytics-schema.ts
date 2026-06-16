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
  | "thread_created"
  | "component_mutation_requested"
  | "mutation_started"
  | "mutation_completed"
  | "mutation_accepted"
  | "mutation_rejected"
  | "rollback_executed"
  | "agent_run_completed";

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
}

export interface AnalyticsEvent {
  name: AnalyticsEventName;
  windowType?: AnalyticsWindowType;
  properties?: AnalyticsProperties;
}
