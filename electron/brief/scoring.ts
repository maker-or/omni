import type {
  BriefHelpKind,
  BriefRankedSignal,
  BriefSection,
  BriefSignal,
  BriefTriage,
} from "../../contracts/brief.ts";

/**
 * Pure ranking logic. Jev supplies calibrated judgments (importance, urgency,
 * needs-action, section); code owns the weights and the hard facts (a meeting
 * in 40 minutes, a ticket due today) so the ordering stays explainable and
 * stable across runs.
 */

const HOUR = 60 * 60 * 1000;

export const BRIEF_LIMITS = { todos: 5, context: 4 } as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hoursUntil(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : (t - now.getTime()) / HOUR;
}

function isSameLocalDay(iso: string | null | undefined, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function ref(signal: BriefSignal, key: string): string | number | null {
  return signal.refs?.[key] ?? null;
}

/** Facts that deserve a bump no matter what the model thought. */
export function deterministicBoost(signal: BriefSignal, now: Date): number {
  let boost = 0;
  const startsIn = hoursUntil(signal.startsAt, now);
  if (signal.kind === "event" && startsIn != null) {
    if (startsIn >= -0.25 && startsIn <= 3) boost += 0.1;
    else if (startsIn > 3 && isSameLocalDay(signal.startsAt, now)) boost += 0.04;
  }
  const dueIn = hoursUntil(signal.dueAt, now);
  if (dueIn != null) {
    if (dueIn < 0) boost += 0.14;
    else if (dueIn <= 24) boost += 0.12;
    else if (dueIn <= 72) boost += 0.05;
  }
  if (signal.kind === "pr_review_requested") boost += 0.08;
  if (signal.kind === "message") boost += 0.03;
  const priority = ref(signal, "priority");
  if (signal.source === "linear" && typeof priority === "number") {
    if (priority === 1) boost += 0.08;
    else if (priority === 2) boost += 0.04;
  }
  const labels = String(ref(signal, "labels") ?? "");
  if (signal.source === "gmail" && /STARRED|IMPORTANT/.test(labels)) boost += 0.04;
  if (ref(signal, "draft") === 1) boost -= 0.05;
  // Stale items without a deadline slide down: they will still be there tomorrow.
  const age = signal.timestamp ? (now.getTime() - Date.parse(signal.timestamp)) / HOUR : null;
  if (age != null && age > 5 * 24 && dueIn == null && signal.kind !== "event") boost -= 0.05;
  return boost;
}

export function computePriority(signal: BriefSignal, triage: BriefTriage, now: Date): number {
  const base =
    (triage.importance / 4) * 0.45 + (triage.urgency / 3) * 0.25 + triage.needsAction * 0.2;
  const sectionAdj = triage.section === "noise" ? -0.25 : triage.section === "todo" ? 0.05 : 0;
  return clamp01(base + sectionAdj + deterministicBoost(signal, now));
}

/**
 * Deterministic stand-in used when Jev is unavailable (no key, outage) so the
 * brief degrades to "less smart" rather than "missing".
 */
export function heuristicTriage(signal: BriefSignal, now: Date): BriefTriage {
  const dueIn = hoursUntil(signal.dueAt, now);
  const startsIn = hoursUntil(signal.startsAt, now);
  let importance = 2;
  let urgency = 1;
  let needsAction = 0.4;
  let section: BriefSection = "context";
  let help: BriefHelpKind = "none";
  switch (signal.kind) {
    case "pr_review_requested":
      importance = 3;
      urgency = 2;
      needsAction = 0.9;
      section = "todo";
      help = "review_code";
      break;
    case "pr_authored":
      importance = 2;
      needsAction = 0.4;
      section = "context";
      help = "review_code";
      break;
    case "issue_assigned":
    case "ticket": {
      const p = ref(signal, "priority");
      importance = p === 1 ? 4 : p === 2 ? 3 : 2;
      needsAction = 0.7;
      section = "todo";
      help = "work_ticket";
      break;
    }
    case "message":
    case "mention":
      importance = 2;
      urgency = 2;
      needsAction = 0.7;
      section = "todo";
      help = "draft_reply";
      break;
    case "email": {
      const labels = String(ref(signal, "labels") ?? "");
      importance = /IMPORTANT|STARRED/.test(labels) ? 3 : 1;
      needsAction = /IMPORTANT|STARRED/.test(labels) ? 0.6 : 0.3;
      section = importance >= 3 ? "todo" : "fyi";
      help = importance >= 3 ? "draft_reply" : "none";
      break;
    }
    case "event":
      importance = 2;
      urgency = startsIn != null && startsIn <= 3 ? 3 : 2;
      needsAction = 0.3;
      section = "context";
      help = "prep_meeting";
      break;
    case "notification":
      importance = 1;
      section = "fyi";
      break;
  }
  if (dueIn != null && dueIn <= 24) {
    urgency = 3;
    importance = Math.max(importance, 3);
    section = "todo";
  }
  return { needsAction, importance, urgency, section, confidence: 0, help };
}

export function rankSignals(
  signals: BriefSignal[],
  triages: Map<string, BriefTriage>,
  now: Date,
): BriefRankedSignal[] {
  return signals
    .map((signal) => {
      const triage = triages.get(signal.id) ?? heuristicTriage(signal, now);
      return { signal, triage, priority: computePriority(signal, triage, now) };
    })
    .sort((a, b) => b.priority - a.priority);
}

export interface BriefSelection {
  todos: BriefRankedSignal[];
  context: BriefRankedSignal[];
  push: BriefRankedSignal | null;
  events: BriefRankedSignal[];
}

/**
 * Pick what earns a place. Calendar events always feed the agenda; they only
 * compete for a to-do slot when Jev says the user must do something first
 * (prep, a decision) — attending alone isn't a to-do.
 */
export function selectForBrief(ranked: BriefRankedSignal[]): BriefSelection {
  const events = ranked
    .filter((r) => r.signal.kind === "event")
    .sort((a, b) => Date.parse(a.signal.startsAt ?? "") - Date.parse(b.signal.startsAt ?? ""));
  const todos: BriefRankedSignal[] = [];
  const context: BriefRankedSignal[] = [];
  for (const entry of ranked) {
    const { triage, signal, priority } = entry;
    if (triage.section === "noise" || priority < 0.28) continue;
    const isTodo =
      triage.section === "todo" ||
      (triage.needsAction >= 0.65 && triage.importance >= 2 && signal.kind !== "event");
    if (signal.kind === "event") {
      if (triage.needsAction >= 0.75 && triage.help === "prep_meeting") {
        if (todos.length < BRIEF_LIMITS.todos) todos.push(entry);
      }
      continue;
    }
    if (isTodo) {
      if (todos.length < BRIEF_LIMITS.todos) todos.push(entry);
      else if (context.length < BRIEF_LIMITS.context && triage.importance >= 3) {
        context.push(entry);
      }
    } else if (context.length < BRIEF_LIMITS.context && triage.importance >= 1.5) {
      context.push(entry);
    }
  }
  const push = todos.find((t) => t.triage.help !== "none") ?? todos[0] ?? null;
  return { todos, context, push, events };
}
