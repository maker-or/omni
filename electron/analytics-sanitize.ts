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
  return sanitized;
}
