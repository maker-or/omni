/**
 * Morning Brief contracts shared by the Electron main process (which collects,
 * analyzes and renders the brief) and the renderer (which shows it inside the
 * embedded browser and surfaces generation status).
 */

/** Toolkits the brief reads from, by Composio toolkit slug. */
export const BRIEF_SOURCES = ["gmail", "googlecalendar", "github", "linear", "slack"] as const;
export type BriefSource = (typeof BRIEF_SOURCES)[number];

export const BRIEF_SOURCE_LABELS: Record<BriefSource, string> = {
  gmail: "Gmail",
  googlecalendar: "Google Calendar",
  github: "GitHub",
  linear: "Linear",
  slack: "Slack",
};

/** What a raw signal represents; drives deterministic scoring boosts. */
export type BriefSignalKind =
  | "email"
  | "event"
  | "pr_review_requested"
  | "pr_authored"
  | "issue_assigned"
  | "mention"
  | "ticket"
  | "notification"
  | "message";

/**
 * One normalized unit of information from a connected tool. Collectors emit
 * these; everything downstream (Jev triage, ranking, writing, rendering) is
 * source-agnostic.
 */
export interface BriefSignal {
  /** Stable within one brief run: `${source}:${nativeId}`. */
  id: string;
  source: BriefSource;
  kind: BriefSignalKind;
  title: string;
  /** Short plain-text body (already truncated). */
  snippet: string;
  url: string | null;
  /** ISO timestamp of the latest activity on the item. */
  timestamp: string | null;
  /** ISO timestamp when the item starts (events) or is due (tickets). */
  startsAt?: string | null;
  endsAt?: string | null;
  dueAt?: string | null;
  /** People involved (sender, author, attendees) as display names. */
  people: string[];
  /** Container label: repo, channel, project, calendar. */
  container?: string | null;
  /** Source-specific identifiers used to build follow-up actions. */
  refs?: Record<string, string | number | null>;
}

/** Jev's per-signal judgment (all values come from Typesafe answers). */
export interface BriefTriage {
  /** P(user must personally do something). 0..1 */
  needsAction: number;
  /** Importance to the user today, 0 (noise) .. 4 (critical). */
  importance: number;
  /** Time pressure, 0 (whenever) .. 3 (within hours). */
  urgency: number;
  section: BriefSection;
  /** Jev's confidence in the section choice. */
  confidence: number;
  help: BriefHelpKind;
}

export type BriefSection = "todo" | "context" | "fyi" | "noise";
export type BriefHelpKind = "draft_reply" | "review_code" | "prep_meeting" | "work_ticket" | "none";

export interface BriefRankedSignal {
  signal: BriefSignal;
  triage: BriefTriage;
  /** Composite priority computed in code from triage + deterministic facts. */
  priority: number;
}

/**
 * Something Pipper can do to push an item forward. Every action is executed
 * only after an explicit click in the brief page.
 */
export type BriefAction =
  | {
      id: string;
      kind: "agent";
      label: string;
      /** Prompt prefilled into a new Pipper thread draft (never auto-sent). */
      prompt: string;
    }
  | {
      id: string;
      kind: "composio";
      label: string;
      /** Tool slug Jev selected (e.g. GMAIL_CREATE_EMAIL_DRAFT). */
      tool: string;
      /** Arguments that will be sent; shown to the user before confirming. */
      arguments: Record<string, unknown>;
      /** Human-readable preview of what will be written. */
      preview: string;
      risk: "read_only" | "mutating" | "destructive";
    }
  | { id: string; kind: "link"; label: string; url: string };

export interface BriefItem {
  id: string;
  signalIds: string[];
  source: BriefSource;
  title: string;
  /** One sentence: why this earns a place in the brief. */
  why: string;
  url: string | null;
  meta: string | null;
  priority: number;
  actions: BriefAction[];
}

export interface BriefAgendaEntry {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  url: string | null;
  attendees: string[];
  /** Prep note written for the meeting, if any. */
  note: string | null;
}

export interface BriefSourceReport {
  source: BriefSource;
  connected: boolean;
  itemCount: number;
  error: string | null;
}

/** The fully analyzed, written brief. Rendered to HTML and persisted as JSON. */
export interface BriefDocument {
  version: 1;
  /** Local calendar date the brief is for, YYYY-MM-DD. */
  date: string;
  generatedAt: string;
  trigger: BriefTrigger;
  greeting: string;
  headline: string;
  summary: string;
  todos: BriefItem[];
  context: BriefItem[];
  /** The single most valuable thing Pipper can move forward right now. */
  push: BriefItem | null;
  agenda: BriefAgendaEntry[];
  sources: BriefSourceReport[];
  /** Which writer produced the prose ("anthropic", "claude-cli", "builtin", ...). */
  writer: string;
  analysis: { model: string | null; signalsAnalyzed: number; signalsKept: number };
}

export type BriefTrigger = "launch" | "schedule" | "resume" | "connection" | "refresh";

export type BriefPhase =
  | "idle"
  | "collecting"
  | "analyzing"
  | "writing"
  | "rendering"
  | "ready"
  | "needs-setup"
  | "error";

export interface BriefStatus {
  phase: BriefPhase;
  /** Human-readable progress line for the loading surface. */
  message: string | null;
  /** Local date of the most recent successfully generated brief. */
  latestDate: string | null;
  /** URL the embedded browser should load for the current brief surface. */
  url: string | null;
  error: string | null;
  updatedAt: string;
}

export interface BriefConnection {
  source: BriefSource;
  label: string;
  connected: boolean;
  /** Set while an authorization link is outstanding. */
  pending: boolean;
}

export interface BriefSettings {
  enabled: boolean;
  /** Local time "HH:MM" for the scheduled daily brief. */
  scheduleTime: string;
  /** Open the brief automatically on the first launch of the day. */
  openOnLaunch: boolean;
  /** Overrides for the baked-in / env keys. Empty string means "use default". */
  composioApiKey: string;
  typesafeApiKey: string;
  anthropicApiKey: string;
}

/** Settings as exposed to the renderer: keys are never sent back in clear. */
export interface BriefSettingsView {
  enabled: boolean;
  scheduleTime: string;
  openOnLaunch: boolean;
  hasComposioKey: boolean;
  hasTypesafeKey: boolean;
  hasWriterKey: boolean;
  composioKeySource: "settings" | "env" | "none";
  typesafeKeySource: "settings" | "env" | "none";
}

export type BriefSettingsPatch = Partial<
  Pick<
    BriefSettings,
    | "enabled"
    | "scheduleTime"
    | "openOnLaunch"
    | "composioApiKey"
    | "typesafeApiKey"
    | "anthropicApiKey"
  >
>;

/** Main → renderer: open (or focus) the brief in the embedded browser. */
export interface BriefOpenRequest {
  url: string;
  /** Switch the workspace to the brief tab (false: add the tab quietly). */
  focus: boolean;
}

/** Main → renderer: start a Pipper thread draft from a brief action. */
export interface BriefAgentPromptRequest {
  prompt: string;
}

/** Custom scheme that serves brief pages into the embedded browser. */
export const BRIEF_SCHEME = "pipper-brief";
export const BRIEF_HOST = "brief";
export const BRIEF_LATEST_URL = `${BRIEF_SCHEME}://${BRIEF_HOST}/today`;

export interface BriefAgentProviderConfig {
  agentId: string;
  provider: string;
  displayName: string;
}

/**
 * Supported ACP agent providers.
 * Used by the Morning Brief writer to cycle through the user's selected providers using each agent's default model.
 */
export const SUPPORTED_BRIEF_PROVIDERS: Record<string, BriefAgentProviderConfig> = {
  "claude-agent-acp": {
    agentId: "claude-agent-acp",
    provider: "anthropic",
    displayName: "Claude",
  },
  "codex-acp": {
    agentId: "codex-acp",
    provider: "openai",
    displayName: "Codex",
  },
  "gemini-acp": {
    agentId: "gemini-acp",
    provider: "google",
    displayName: "Gemini",
  },
  "cursor-acp": {
    agentId: "cursor-acp",
    provider: "cursor",
    displayName: "Cursor",
  },
  "grok-acp": {
    agentId: "grok-acp",
    provider: "xai",
    displayName: "Grok",
  },
  "copilot-acp": {
    agentId: "copilot-acp",
    provider: "github",
    displayName: "Copilot",
  },
  "opencode-acp": {
    agentId: "opencode-acp",
    provider: "opencode",
    displayName: "OpenCode",
  },
  "antigravity-acp": {
    agentId: "antigravity-acp",
    provider: "antigravity",
    displayName: "Antigravity",
  },
  "devin-acp": {
    agentId: "devin-acp",
    provider: "devin",
    displayName: "Devin",
  },
};

export type BriefCandidateProvider = BriefAgentProviderConfig;

/**
 * Returns candidate providers for the given user-selected agent IDs.
 * Cycles through each provider chosen during onboarding with its default model.
 * If no selected agent IDs are given, falls back to all supported providers.
 */
export function resolveBriefCandidateProviders(
  selectedAgentIds: readonly string[] = [],
): BriefCandidateProvider[] {
  const chosenIds = selectedAgentIds.filter((id) => id in SUPPORTED_BRIEF_PROVIDERS);
  const targetIds = chosenIds.length > 0 ? chosenIds : Object.keys(SUPPORTED_BRIEF_PROVIDERS);

  const candidates: BriefCandidateProvider[] = [];
  for (const agentId of targetIds) {
    const config = SUPPORTED_BRIEF_PROVIDERS[agentId];
    if (config) {
      candidates.push(config);
    }
  }
  return candidates;
}

/** Backwards-compatible alias for resolveBriefCandidateProviders. */
export const resolveBriefCandidateModels = resolveBriefCandidateProviders;
