import type { AnalyticsProperties, IntentCategory } from "./analytics-schema.ts";

const INTENT_PATTERNS: Array<[IntentCategory, RegExp]> = [
  ["bug_fix", /\b(bug|fix|broken|error|crash|issue|regression|not working)\b/i],
  ["ui_customization", /\b(ui|style|design|color|layout|spacing|button|modal|screen|visual)\b/i],
  ["workflow_change", /\b(flow|workflow|onboarding|step|state|navigation|shortcut)\b/i],
  ["new_feature", /\b(add|create|new feature|implement|build|support|enable)\b/i],
  ["integration", /\b(api|webhook|oauth|clerk|posthog|stripe|github|integration)\b/i],
  ["automation", /\b(automate|schedule|reminder|monitor|background|cron)\b/i],
  ["performance_improvement", /\b(performance|speed|slow|latency|optimi[sz]e|cache)\b/i],
];

const SAFE_IDENTIFIER = /^[A-Za-z0-9_.:/-]{1,128}$/;

export function categorizeIntent(input: string | null | undefined): IntentCategory {
  if (!input) return "unknown";
  for (const [category, pattern] of INTENT_PATTERNS) {
    if (pattern.test(input)) return category;
  }
  return "unknown";
}

export function sanitizeIdentifier(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.includes("\n") || trimmed.includes("\r")) return undefined;
  if (trimmed.startsWith("/") || trimmed.startsWith("~") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return undefined;
  }
  return SAFE_IDENTIFIER.test(trimmed) ? trimmed : undefined;
}

export function sanitizeErrorType(error: unknown): string | undefined {
  if (!error) return undefined;
  if (error instanceof Error && error.name) return sanitizeIdentifier(error.name);
  return sanitizeIdentifier(typeof error);
}

/** Clamp to a non-negative integer; drop non-finite values. */
function sanitizeCount(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.round(value));
}

/** Clamp to a non-negative number, preserving fractional precision (e.g. cost in USD). */
function sanitizeAmount(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, value);
}

export function sanitizeAnalyticsProperties(properties: AnalyticsProperties): AnalyticsProperties {
  const sanitized: AnalyticsProperties = {};
  if (properties.project_id) sanitized.project_id = sanitizeIdentifier(properties.project_id);
  if (properties.thread_id) sanitized.thread_id = sanitizeIdentifier(properties.thread_id);
  if (properties.model_id) sanitized.model_id = sanitizeIdentifier(properties.model_id);
  if (properties.model_provider) {
    sanitized.model_provider = sanitizeIdentifier(properties.model_provider);
  }
  if (properties.intent_category) sanitized.intent_category = properties.intent_category;
  if (properties.component_id) sanitized.component_id = sanitizeIdentifier(properties.component_id);
  if (properties.source) sanitized.source = properties.source;
  if (properties.icon) sanitized.icon = sanitizeIdentifier(properties.icon);
  if (properties.outcome) sanitized.outcome = properties.outcome;
  if (typeof properties.success === "boolean") sanitized.success = properties.success;
  if (properties.rejection_stage) sanitized.rejection_stage = properties.rejection_stage;
  if (typeof properties.execution_duration_ms === "number") {
    sanitized.execution_duration_ms = Math.max(0, Math.round(properties.execution_duration_ms));
  }
  if (typeof properties.files_changed_count === "number") {
    sanitized.files_changed_count = Math.max(0, Math.round(properties.files_changed_count));
  }
  if (properties.error_type) sanitized.error_type = sanitizeIdentifier(properties.error_type);
  if (properties.error_code) sanitized.error_code = sanitizeIdentifier(properties.error_code);

  // ─── v2: agent identity ──────────────────────────────────────────────────
  if (properties.agent_id) sanitized.agent_id = sanitizeIdentifier(properties.agent_id);
  if (properties.agent_name) sanitized.agent_name = sanitizeIdentifier(properties.agent_name);
  if (properties.active_agent_id) {
    sanitized.active_agent_id = sanitizeIdentifier(properties.active_agent_id);
  }
  if (properties.from_agent_id) {
    sanitized.from_agent_id = sanitizeIdentifier(properties.from_agent_id);
  }
  if (properties.to_agent_id) sanitized.to_agent_id = sanitizeIdentifier(properties.to_agent_id);

  // ─── v2: enum/string dimensions ──────────────────────────────────────────
  if (properties.stop_reason) sanitized.stop_reason = sanitizeIdentifier(properties.stop_reason);
  if (properties.tool_kind) sanitized.tool_kind = sanitizeIdentifier(properties.tool_kind);
  if (properties.install_kind) sanitized.install_kind = sanitizeIdentifier(properties.install_kind);
  if (properties.failure_code) sanitized.failure_code = sanitizeIdentifier(properties.failure_code);
  if (properties.phase) sanitized.phase = sanitizeIdentifier(properties.phase);
  if (properties.step) sanitized.step = sanitizeIdentifier(properties.step);
  if (properties.status) sanitized.status = sanitizeIdentifier(properties.status);
  if (properties.task_category) sanitized.task_category = properties.task_category;
  if (properties.target_version) {
    sanitized.target_version = sanitizeIdentifier(properties.target_version);
  }
  if (properties.cost_currency) {
    sanitized.cost_currency = sanitizeIdentifier(properties.cost_currency);
  }

  // ─── v2: numeric measures ────────────────────────────────────────────────
  sanitized.turn_duration_ms = sanitizeCount(properties.turn_duration_ms);
  sanitized.tokens_used = sanitizeCount(properties.tokens_used);
  sanitized.context_size = sanitizeCount(properties.context_size);
  sanitized.cost_amount = sanitizeAmount(properties.cost_amount);
  sanitized.session_duration_ms = sanitizeCount(properties.session_duration_ms);
  sanitized.tool_call_count = sanitizeCount(properties.tool_call_count);
  sanitized.tool_duration_ms = sanitizeCount(properties.tool_duration_ms);
  sanitized.connect_duration_ms = sanitizeCount(properties.connect_duration_ms);
  sanitized.build_duration_ms = sanitizeCount(properties.build_duration_ms);
  sanitized.download_duration_ms = sanitizeCount(properties.download_duration_ms);
  sanitized.promotion_duration_ms = sanitizeCount(properties.promotion_duration_ms);
  sanitized.health_check_duration_ms = sanitizeCount(properties.health_check_duration_ms);
  sanitized.total_duration_ms = sanitizeCount(properties.total_duration_ms);
  sanitized.time_to_accept_ms = sanitizeCount(properties.time_to_accept_ms);
  sanitized.time_in_edit_ms = sanitizeCount(properties.time_in_edit_ms);
  sanitized.iterations = sanitizeCount(properties.iterations);
  sanitized.depth = sanitizeCount(properties.depth);
  sanitized.heartbeat_seconds = sanitizeCount(properties.heartbeat_seconds);

  // ─── v2: boolean flags ───────────────────────────────────────────────────
  if (typeof properties.healthy === "boolean") sanitized.healthy = properties.healthy;
  if (typeof properties.has_images === "boolean") sanitized.has_images = properties.has_images;
  if (typeof properties.has_resources === "boolean") {
    sanitized.has_resources = properties.has_resources;
  }
  if (typeof properties.has_customizations === "boolean") {
    sanitized.has_customizations = properties.has_customizations;
  }

  // Drop keys the helpers resolved to `undefined` so they never reach PostHog.
  for (const key of Object.keys(sanitized) as Array<keyof AnalyticsProperties>) {
    if (sanitized[key] === undefined) delete sanitized[key];
  }
  return sanitized;
}
