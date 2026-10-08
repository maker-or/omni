import {
  BRIEF_SOURCE_LABELS,
  type BriefAction,
  type BriefAgendaEntry,
  type BriefDocument,
  type BriefItem,
  type BriefRankedSignal,
  type BriefSignal,
  type BriefSourceReport,
  type BriefTrigger,
} from "../../contracts/brief.ts";
import type { BriefIdentity } from "./collectors.ts";
import { signalForModel } from "./jev.ts";
import type { BriefSelection } from "./scoring.ts";
import type { WrittenBrief } from "./writer.ts";

/**
 * Pure assembly of the final `BriefDocument`: merges ranked signals, the
 * (optional) LLM prose, and deterministic fallbacks for every field, and
 * attaches the actions Pipper can take on each item.
 */

const HOUR = 60 * 60 * 1000;

export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function relativeAge(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const hours = (now.getTime() - Date.parse(iso)) / HOUR;
  if (Number.isNaN(hours) || hours < 0) return null;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function dueLabel(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const hours = (Date.parse(iso) - now.getTime()) / HOUR;
  if (Number.isNaN(hours)) return null;
  if (hours < 0) return "overdue";
  if (hours <= 24) return "due today";
  if (hours <= 48) return "due tomorrow";
  return `due ${new Date(iso).toLocaleDateString(undefined, { weekday: "short" })}`;
}

export function firstName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  if (trimmed.includes("@")) {
    const local = trimmed.split("@")[0]!.split(/[._-]/)[0]!;
    return local ? local[0]!.toUpperCase() + local.slice(1) : null;
  }
  return trimmed.split(/\s+/)[0] ?? null;
}

export function greetingFor(now: Date, name: string | null): string {
  const hour = now.getHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}` : part;
}

// ── Deterministic prose ─────────────────────────────────────────────────────

export function builtinWhy(entry: BriefRankedSignal, now: Date): string {
  const { signal, triage } = entry;
  const who = signal.people[0];
  const age = relativeAge(signal.timestamp, now);
  const due = dueLabel(signal.dueAt, now);
  switch (signal.kind) {
    case "pr_review_requested":
      return `${who ?? "A teammate"} is waiting on your review in ${signal.container ?? "GitHub"}${
        age ? ` (updated ${age})` : ""
      }.`;
    case "pr_authored":
      return `Your PR in ${signal.container ?? "GitHub"} has new activity${age ? ` ${age}` : ""}.`;
    case "issue_assigned":
      return `Assigned to you in ${signal.container ?? "GitHub"}${due ? `, ${due}` : ""}.`;
    case "ticket": {
      const priority = signal.refs?.priorityLabel;
      const bits = [priority ? `${priority} priority` : null, due, signal.refs?.state]
        .filter(Boolean)
        .join(" · ");
      return `Assigned to you${bits ? ` — ${bits}` : ""}.`;
    }
    case "mention":
      return `${who ?? "Someone"} mentioned you in ${signal.container ?? "a thread"}${
        age ? ` ${age}` : ""
      }.`;
    case "message":
      return `${who ?? "Someone"} messaged you directly${age ? ` ${age}` : ""} and may be waiting.`;
    case "email":
      return triage.needsAction >= 0.6
        ? `${who ?? "The sender"} likely needs a reply from you${age ? ` (sent ${age})` : ""}.`
        : `From ${who ?? "your inbox"}${age ? `, ${age}` : ""}.`;
    case "event":
      return `Starts at ${formatTime(signal.startsAt)}${
        signal.people.length ? ` with ${signal.people.slice(0, 3).join(", ")}` : ""
      }.`;
    case "notification":
      return signal.snippet || "New activity on something you follow.";
  }
}

export function builtinHeadline(selection: BriefSelection, now: Date): string {
  const top = selection.todos[0];
  const nextMeeting = selection.events.find(
    (e) => Date.parse(e.signal.startsAt ?? "") > now.getTime(),
  );
  if (top) return `Start with: ${top.signal.title}`;
  if (nextMeeting) {
    return `Clear runway until ${nextMeeting.signal.title} at ${formatTime(nextMeeting.signal.startsAt)}`;
  }
  return "Nothing urgent is waiting on you — a good day for deep work";
}

export function builtinSummary(selection: BriefSelection, now: Date): string {
  const parts: string[] = [];
  const upcoming = selection.events.filter(
    (e) => Date.parse(e.signal.endsAt ?? e.signal.startsAt ?? "") > now.getTime(),
  );
  const today = upcoming.filter((e) => new Date(e.signal.startsAt!).getDate() === now.getDate());
  if (today.length > 0) {
    parts.push(
      `${today.length} meeting${today.length === 1 ? "" : "s"} today, first at ${formatTime(
        today[0]!.signal.startsAt,
      )}.`,
    );
  } else {
    parts.push("No meetings left today.");
  }
  const reviews = selection.todos.filter((t) => t.signal.kind === "pr_review_requested").length;
  const replies = selection.todos.filter((t) =>
    ["email", "message", "mention"].includes(t.signal.kind),
  ).length;
  const tickets = selection.todos.filter((t) =>
    ["ticket", "issue_assigned"].includes(t.signal.kind),
  ).length;
  const counts = [
    reviews ? `${reviews} review${reviews === 1 ? "" : "s"}` : null,
    replies ? `${replies} repl${replies === 1 ? "y" : "ies"}` : null,
    tickets ? `${tickets} ticket${tickets === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  parts.push(
    counts.length > 0
      ? `Waiting on you: ${counts.join(", ")}.`
      : "Nothing is blocked on you right now.",
  );
  return parts.join(" ");
}

// ── Model inputs ────────────────────────────────────────────────────────────

/** Compact digest for the focus-profile call (titles only, bounded). */
export function buildFocusDigest(signals: BriefSignal[], identity: BriefIdentity): string {
  const lines = signals
    .slice(0, 80)
    .map(
      (s) =>
        `- [${BRIEF_SOURCE_LABELS[s.source]}${s.container ? ` · ${s.container}` : ""}] ${s.title}${
          s.people.length ? ` (${s.people.slice(0, 3).join(", ")})` : ""
        }`,
    );
  return [
    `User: ${
      [
        identity.linearName,
        identity.email,
        identity.githubLogin && `GitHub @${identity.githubLogin}`,
      ]
        .filter(Boolean)
        .join(" · ") || "unknown"
    }`,
    "Recent items:",
    ...lines,
  ].join("\n");
}

/** Deterministic focus profile when no LLM is available. */
export function builtinFocus(signals: BriefSignal[]): string {
  const tally = (values: Array<string | null | undefined>) => {
    const counts = new Map<string, number>();
    for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([v]) => v);
  };
  const repos = tally(signals.filter((s) => s.source === "github").map((s) => s.container));
  const projects = tally(signals.filter((s) => s.source === "linear").map((s) => s.container));
  const people = tally(signals.flatMap((s) => s.people));
  const parts = ["Software engineer."];
  if (repos.length) parts.push(`Active repositories: ${repos.join(", ")}.`);
  if (projects.length) parts.push(`Active projects: ${projects.join(", ")}.`);
  if (people.length) parts.push(`Frequent collaborators: ${people.join(", ")}.`);
  parts.push("Newsletters, marketing, and automated notifications are noise.");
  return parts.join(" ");
}

export function buildWriterInput(input: {
  selection: BriefSelection;
  identity: BriefIdentity;
  userName: string | null;
  focus: string | null;
  now: Date;
}): string {
  const { selection, now } = input;
  const item = (entry: BriefRankedSignal) => ({
    id: entry.signal.id,
    ...signalForModel(entry.signal),
    url: entry.signal.url,
    judgment: {
      needs_action: Number(entry.triage.needsAction.toFixed(2)),
      importance_0_to_4: Number(entry.triage.importance.toFixed(1)),
      urgency_0_to_3: Number(entry.triage.urgency.toFixed(1)),
      suggested_help: entry.triage.help,
    },
  });
  return JSON.stringify(
    {
      now: now.toString(),
      user: {
        name: input.userName,
        email: input.identity.email,
        github: input.identity.githubLogin,
        focus: input.focus,
      },
      todos: selection.todos.map(item),
      context: selection.context.map(item),
      push_candidate: selection.push?.signal.id ?? null,
      meetings: selection.events.map((e) => ({
        id: e.signal.id,
        title: e.signal.title,
        starts_at: e.signal.startsAt,
        ends_at: e.signal.endsAt,
        attendees: e.signal.people,
        description: e.signal.snippet || undefined,
      })),
    },
    null,
    1,
  );
}

// ── Actions ─────────────────────────────────────────────────────────────────

function sourceLinkLabel(signal: BriefSignal): string {
  return `Open in ${BRIEF_SOURCE_LABELS[signal.source]}`;
}

export function agentPromptFor(signal: BriefSignal): string | null {
  const refs = signal.refs ?? {};
  if (signal.source === "github" && refs.isPr === 1 && signal.kind === "pr_review_requested") {
    return [
      `Review pull request ${refs.owner}/${refs.repo}#${refs.number}: "${signal.title}"`,
      signal.url ?? "",
      "",
      "Summarize what changed and why, check out the branch if this repository is open in Pipper, run the relevant tests, and list concrete issues or risks ordered by severity. Finish with review comments I can post.",
    ].join("\n");
  }
  if (signal.source === "github" && refs.isPr === 1) {
    return [
      `Help me land my pull request ${refs.owner}/${refs.repo}#${refs.number}: "${signal.title}"`,
      signal.url ?? "",
      "",
      "Check the latest review comments and CI status, address what's actionable, and tell me what still needs a human decision.",
    ].join("\n");
  }
  if (signal.source === "github" || signal.source === "linear") {
    const label =
      signal.source === "linear"
        ? String(refs.identifier ?? "")
        : `${refs.owner}/${refs.repo}#${refs.number}`;
    return [
      `Pick up ${label}: ${signal.title.replace(/^[A-Z]+-\d+ · /, "")}`,
      signal.url ?? "",
      signal.snippet ? `\nContext: ${signal.snippet}` : "",
      "",
      "Investigate the relevant code, explain the root cause or the approach, and propose a step-by-step plan before changing anything.",
    ].join("\n");
  }
  return null;
}

export interface ComposeInput {
  now: Date;
  trigger: BriefTrigger;
  userName: string | null;
  selection: BriefSelection;
  written: WrittenBrief | null;
  writerName: string;
  analysisModel: string | null;
  signalsAnalyzed: number;
  sources: BriefSourceReport[];
  /** Jev-routed write actions keyed by signal id (built in actions.ts). */
  replyActions: Map<string, BriefAction>;
}

export function composeDocument(input: ComposeInput): BriefDocument {
  const { now, selection, written } = input;
  const writtenItems = new Map((written?.items ?? []).map((i) => [i.id, i]));
  const pushId = written?.push?.id ?? selection.push?.signal.id ?? null;

  const toItem = (entry: BriefRankedSignal, isPush = false): BriefItem => {
    const { signal } = entry;
    const w = writtenItems.get(signal.id);
    const actions: BriefAction[] = [];
    const reply = input.replyActions.get(signal.id);
    const prompt =
      (isPush && written?.push?.id === signal.id ? written.push.agent_prompt : null) ??
      (entry.triage.help === "review_code" || entry.triage.help === "work_ticket"
        ? agentPromptFor(signal)
        : null);
    if (prompt) {
      actions.push({
        id: `${signal.id}:agent`,
        kind: "agent",
        label: signal.kind === "pr_review_requested" ? "Review with Pipper" : "Start in Pipper",
        prompt,
      });
    }
    if (reply) actions.push(reply);
    if (signal.url) {
      actions.push({
        id: `${signal.id}:link`,
        kind: "link",
        label: sourceLinkLabel(signal),
        url: signal.url,
      });
    }
    const metaParts = [
      signal.container,
      dueLabel(signal.dueAt, now),
      signal.kind === "event" ? formatTime(signal.startsAt) : relativeAge(signal.timestamp, now),
    ].filter(Boolean);
    return {
      id: signal.id,
      signalIds: [signal.id],
      source: signal.source,
      title: w?.title?.trim() || signal.title,
      why:
        (isPush && written?.push?.id === signal.id ? written.push.pitch : null) ??
        (w?.why?.trim() || builtinWhy(entry, now)),
      url: signal.url,
      meta: metaParts.length ? metaParts.join(" · ") : null,
      priority: Number(entry.priority.toFixed(3)),
      actions,
    };
  };

  const pushEntry =
    [...selection.todos, ...selection.context].find((e) => e.signal.id === pushId) ??
    selection.push;
  const push = pushEntry ? toItem(pushEntry, true) : null;
  // Only promote the push card when there is something Pipper can actually do.
  const pushUseful = push && push.actions.some((a) => a.kind !== "link");

  const notes = new Map((written?.agenda_notes ?? []).map((n) => [n.id, n.note]));
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const agenda: BriefAgendaEntry[] = selection.events
    .filter((e) => {
      const start = Date.parse(e.signal.startsAt ?? "");
      const end = Date.parse(e.signal.endsAt ?? e.signal.startsAt ?? "");
      return end > now.getTime() - HOUR && start < dayEnd.getTime();
    })
    .map((e) => ({
      id: e.signal.id,
      title: e.signal.title,
      startsAt: e.signal.startsAt!,
      endsAt: e.signal.endsAt ?? null,
      allDay: e.signal.refs?.allDay === 1,
      location: e.signal.container ?? null,
      url: (e.signal.refs?.conference as string | null) ?? e.signal.url,
      attendees: e.signal.people,
      note: notes.get(e.signal.id) ?? null,
    }));

  const todos = selection.todos.map((e) => toItem(e));
  const context = selection.context.map((e) => toItem(e));

  return {
    version: 1,
    date: localDateKey(now),
    generatedAt: now.toISOString(),
    trigger: input.trigger,
    greeting: greetingFor(now, firstName(input.userName)),
    headline: written?.headline?.trim() || builtinHeadline(selection, now),
    summary: written?.summary?.trim() || builtinSummary(selection, now),
    todos,
    context,
    push: pushUseful ? push : null,
    agenda,
    sources: input.sources,
    writer: input.writerName,
    analysis: {
      model: input.analysisModel,
      signalsAnalyzed: input.signalsAnalyzed,
      signalsKept: todos.length + context.length + agenda.length,
    },
  };
}
