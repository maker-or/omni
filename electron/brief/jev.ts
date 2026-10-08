import type {
  BriefHelpKind,
  BriefSection,
  BriefSignal,
  BriefTriage,
} from "../../contracts/brief.ts";
import type { BriefIdentity } from "./collectors.ts";

/**
 * Jev (TypeSafe System One) triage.
 *
 * Each signal is one small System One request carrying several typed
 * questions (fan-out within the request). Questions reference the structured
 * state by name — `item`, `user` — as the TypeSafe docs recommend, and the
 * LLM-written focus profile rides along in `user.focus` so the writer's
 * reasoning about "what matters to this person" guides Jev's judgments.
 */

/** The part of `TypeSafeClient` we use; injectable for tests. */
export interface JevClient {
  systemOne(request: {
    state: unknown;
    model?: string;
    questions: Record<string, unknown>;
  }): PromiseLike<unknown>;
}

export const JEV_MODEL = "jev-latest";

const IMPORTANCE_LEVELS = [
  "Noise: automated, promotional, or irrelevant to the user",
  "Low: nice to know, no consequence if skipped",
  "Medium: relevant to the user's work this week",
  "High: affects the user's current priorities, a teammate is waiting, or a commitment is at stake",
  "Critical: blocking others, a deadline today, an incident, or an explicit ask from leadership or a customer",
];

const URGENCY_LEVELS = [
  "No time pressure",
  "Should be handled this week",
  "Should be handled today",
  "Needs attention within the next few hours",
];

const SECTION_CRITERIA: Record<BriefSection, string> = {
  todo: "An outstanding to-do: the user personally owes a reply, review, decision, fix, or deliverable",
  context:
    "Useful context: the user does not need to act, but knowing it changes how they plan or work today",
  fyi: "Low-stakes update the user can skim later",
  noise: "Automated, promotional, duplicate, or irrelevant; leave it out of the brief",
};

const HELP_CRITERIA: Record<BriefHelpKind, string> = {
  draft_reply: "Drafting a written reply (email, chat message, or comment) would move this forward",
  review_code: "Reviewing, testing, or checking out code or a pull request would move this forward",
  prep_meeting: "Preparing notes, an agenda, or background for an upcoming meeting",
  work_ticket: "Investigating or implementing the work described in a ticket or issue",
  none: "Nothing an assistant could usefully do right now",
};

export const TRIAGE_QUESTIONS = {
  needs_action: {
    type: "noul",
    instructions:
      "Does `user` personally need to do something about `item` (reply, review, decide, attend with preparation, fix, or deliver)?",
    criteria: {
      true: "The user owes an action or response",
      false: "Informational only, or someone else owns the next step",
    },
  },
  importance: {
    type: "score",
    instructions:
      "How important is `item` to `user` today, given their role and `user.focus`? Rate the consequence of the user not seeing it this morning.",
    criteria: IMPORTANCE_LEVELS,
  },
  urgency: {
    type: "score",
    instructions:
      "Given `now` and any deadline, start time, or waiting person in `item`, how soon does `user` need to act on or know about it?",
    criteria: URGENCY_LEVELS,
  },
  section: {
    type: "choice",
    instructions: "Where does `item` belong in the user's morning brief?",
    criteria: SECTION_CRITERIA,
  },
  help: {
    type: "choice",
    instructions:
      "Which kind of help from an AI coding and writing assistant would most move `item` forward for `user`?",
    criteria: HELP_CRITERIA,
  },
} as const;

interface NoulAnswer {
  type: "noul";
  noul: number;
}
interface ScoreAnswer {
  type: "score";
  score: number;
  confidence?: number;
}
interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence?: number;
}

function readAnswers(response: unknown): Record<string, unknown> | null {
  const data = (response as { data?: unknown })?.data ?? response;
  const answers = (data as { answers?: unknown })?.answers;
  return typeof answers === "object" && answers !== null
    ? (answers as Record<string, unknown>)
    : null;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Map a raw System One response into a `BriefTriage`, or null if malformed. */
export function parseTriage(response: unknown): BriefTriage | null {
  const answers = readAnswers(response);
  if (!answers) return null;
  const needs = answers.needs_action as NoulAnswer | undefined;
  const importance = answers.importance as ScoreAnswer | undefined;
  const urgency = answers.urgency as ScoreAnswer | undefined;
  const section = answers.section as ChoiceAnswer | undefined;
  const help = answers.help as ChoiceAnswer | undefined;
  if (!needs || !importance || !urgency || !section) return null;
  const sectionChoice = section.choice as BriefSection;
  if (!(sectionChoice in SECTION_CRITERIA)) return null;
  const helpChoice = (help?.choice ?? "none") as BriefHelpKind;
  return {
    needsAction: Math.max(0, Math.min(1, finite(needs.noul, 0))),
    importance: Math.max(0, Math.min(4, finite(importance.score, 2))),
    urgency: Math.max(0, Math.min(3, finite(urgency.score, 1))),
    section: sectionChoice,
    confidence: finite(section.confidence, 0),
    help: helpChoice in HELP_CRITERIA ? helpChoice : "none",
  };
}

/** The compact, model-facing view of a signal (no ids or refs noise). */
export function signalForModel(signal: BriefSignal): Record<string, unknown> {
  const out: Record<string, unknown> = {
    source: signal.source,
    kind: signal.kind,
    title: signal.title,
  };
  if (signal.snippet) out.content = signal.snippet;
  if (signal.people.length) out.people = signal.people;
  if (signal.container) out.where = signal.container;
  if (signal.timestamp) out.last_activity = signal.timestamp;
  if (signal.startsAt) out.starts_at = signal.startsAt;
  if (signal.dueAt) out.due_at = signal.dueAt;
  const priorityLabel = signal.refs?.priorityLabel;
  if (priorityLabel) out.priority = priorityLabel;
  const state = signal.refs?.state;
  if (state) out.status = state;
  return out;
}

export interface TriageInput {
  signals: BriefSignal[];
  identity: BriefIdentity;
  /** LLM-written focus profile that steers Jev's notion of importance. */
  focus: string | null;
  now: Date;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface TriageOutput {
  triages: Map<string, BriefTriage>;
  model: string | null;
  failures: number;
}

async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
}

export async function triageSignals(client: JevClient, input: TriageInput): Promise<TriageOutput> {
  const triages = new Map<string, BriefTriage>();
  let model: string | null = null;
  let failures = 0;
  let done = 0;
  const user = {
    email: input.identity.email,
    github: input.identity.githubLogin,
    name: input.identity.linearName,
    focus: input.focus ?? "Not provided; infer from the item.",
  };
  const now = input.now.toISOString();
  await mapLimit(input.signals, input.concurrency ?? 8, async (signal) => {
    try {
      const response = await client.systemOne({
        model: JEV_MODEL,
        state: { now, user, item: signalForModel(signal) },
        questions: TRIAGE_QUESTIONS,
      });
      const triage = parseTriage(response);
      if (triage) triages.set(signal.id, triage);
      else failures += 1;
      const responseModel = (response as { model?: unknown })?.model;
      if (typeof responseModel === "string") model = responseModel;
    } catch (error) {
      failures += 1;
      if (failures <= 3) console.warn("[Brief] Jev triage failed:", error);
    } finally {
      done += 1;
      input.onProgress?.(done, input.signals.length);
    }
  });
  return { triages, model, failures };
}
