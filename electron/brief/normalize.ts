import type { BriefSignal, BriefSignalKind } from "../../contracts/brief.ts";

/**
 * Pure converters from Composio tool payloads to `BriefSignal`s.
 *
 * Composio wraps provider responses with slightly different envelopes per
 * toolkit and version (`data.items`, `data.data.items`, `data.response_data`,
 * minimal vs. full detail). Every reader here is defensive: unknown shapes
 * produce fewer signals, never an exception, so one odd payload cannot take
 * the whole brief down.
 */

type Json = Record<string, unknown>;

export const SNIPPET_LIMIT = 420;

export function asRecord(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

export function str(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/** Collapse whitespace, strip quoted replies/HTML remnants, and truncate. */
export function cleanText(value: unknown, limit = SNIPPET_LIMIT): string {
  const raw = str(value);
  if (!raw) return "";
  const withoutHtml = raw
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
  // Drop quoted history in replies ("On Mon, X wrote:" and "> " lines).
  const lines = withoutHtml.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*On .{4,120} wrote:\s*$/i.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  const collapsed = kept.join(" ").replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * Breadth-first search for the first array stored under one of `keys`.
 * Bounded depth so pathological payloads stay cheap.
 */
export function findArray(value: unknown, keys: string[], maxDepth = 5): unknown[] {
  const queue: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 0 }];
  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    const record = asRecord(node);
    if (!record) continue;
    for (const key of keys) {
      const candidate = record[key];
      if (Array.isArray(candidate)) return candidate;
    }
    if (depth >= maxDepth) continue;
    for (const child of Object.values(record)) {
      if (asRecord(child)) queue.push({ node: child, depth: depth + 1 });
    }
  }
  return [];
}

/** Breadth-first search for the first object stored under `key`. */
export function findObject(value: unknown, key: string, maxDepth = 5): Json | null {
  const queue: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 0 }];
  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    const record = asRecord(node);
    if (!record) continue;
    const candidate = asRecord(record[key]);
    if (candidate) return candidate;
    if (depth >= maxDepth) continue;
    for (const child of Object.values(record)) {
      if (asRecord(child)) queue.push({ node: child, depth: depth + 1 });
    }
  }
  return null;
}

function toIso(value: unknown): string | null {
  const text = str(value);
  if (text) {
    // Pure digits → epoch millis (Gmail internalDate) or seconds.
    if (/^\d{9,13}$/.test(text)) {
      const n = Number(text);
      return new Date(text.length >= 12 ? n : n * 1000).toISOString();
    }
    const parsed = Date.parse(text);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  const n = num(value);
  if (n != null) return new Date(n > 1e12 ? n : n * 1000).toISOString();
  return null;
}

/** "Priya Raman <priya@acme.com>" → { name: "Priya Raman", email: "priya@acme.com" } */
export function parseAddress(value: unknown): { name: string | null; email: string | null } {
  const text = str(value);
  if (!text) return { name: null, email: null };
  const angle = text.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (angle) {
    const name = angle[1]?.trim() || null;
    return { name, email: angle[2]?.trim() ?? null };
  }
  if (text.includes("@")) return { name: null, email: text };
  return { name: text, email: null };
}

function displayPerson(value: unknown): string | null {
  const { name, email } = parseAddress(value);
  return name ?? email;
}

// ── Gmail ──────────────────────────────────────────────────────────────────

export function normalizeGmail(data: unknown, selfEmail: string | null = null): BriefSignal[] {
  const messages = findArray(data, ["messages"]);
  const seenThreads = new Set<string>();
  const signals: BriefSignal[] = [];
  for (const entry of messages) {
    const m = asRecord(entry);
    if (!m) continue;
    const messageId = str(m.messageId) ?? str(m.id);
    if (!messageId) continue;
    const threadId = str(m.threadId) ?? messageId;
    // One signal per thread: the newest message comes first from Gmail.
    if (seenThreads.has(threadId)) continue;
    seenThreads.add(threadId);
    const preview = asRecord(m.preview);
    const subject = str(m.subject) ?? str(preview?.subject) ?? "(no subject)";
    const sender = str(m.sender) ?? str(m.from);
    const senderParsed = parseAddress(sender);
    if (selfEmail && senderParsed.email?.toLowerCase() === selfEmail.toLowerCase()) continue;
    const labels = Array.isArray(m.labelIds)
      ? m.labelIds.filter((l): l is string => typeof l === "string")
      : [];
    const body = cleanText(m.messageText ?? preview?.body ?? m.snippet);
    signals.push({
      id: `gmail:${threadId}`,
      source: "gmail",
      kind: "email",
      title: subject,
      snippet: body,
      url:
        str(m.display_url) ??
        `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(threadId)}`,
      timestamp: toIso(m.messageTimestamp ?? m.internalDate ?? m.date),
      people: [displayPerson(sender)].filter((p): p is string => Boolean(p)),
      container: labels.includes("IMPORTANT") ? "Important" : "Inbox",
      refs: {
        threadId,
        messageId,
        senderEmail: senderParsed.email,
        senderName: senderParsed.name,
        subject,
        labels: labels.join(","),
      },
    });
  }
  return signals;
}

export function extractGmailProfileEmail(data: unknown): string | null {
  const direct = str(asRecord(data)?.emailAddress);
  if (direct) return direct;
  return str(findObject(data, "data")?.emailAddress) ?? findStringDeep(data, "emailAddress");
}

function findStringDeep(value: unknown, key: string, depth = 0): string | null {
  const record = asRecord(value);
  if (!record || depth > 4) return null;
  const direct = str(record[key]);
  if (direct) return direct;
  for (const child of Object.values(record)) {
    const found = findStringDeep(child, key, depth + 1);
    if (found) return found;
  }
  return null;
}

export { findStringDeep };

// ── Google Calendar ────────────────────────────────────────────────────────

function eventTime(value: unknown): { iso: string | null; allDay: boolean } {
  const record = asRecord(value);
  if (!record) return { iso: toIso(value), allDay: false };
  const dateTime = str(record.dateTime);
  if (dateTime) return { iso: toIso(dateTime), allDay: false };
  const date = str(record.date);
  if (date) {
    // All-day dates are local calendar days; anchor at local midnight.
    const [y, mo, d] = date.split("-").map(Number);
    if (y && mo && d) return { iso: new Date(y, mo - 1, d).toISOString(), allDay: true };
  }
  return { iso: null, allDay: false };
}

export function normalizeCalendar(data: unknown): BriefSignal[] {
  const items = findArray(data, ["items", "events", "event_data"]);
  const signals: BriefSignal[] = [];
  for (const entry of items) {
    const e = asRecord(entry);
    if (!e) continue;
    const id = str(e.id);
    if (!id) continue;
    if (str(e.status) === "cancelled") continue;
    const attendees = Array.isArray(e.attendees) ? e.attendees.map(asRecord).filter(Boolean) : [];
    const self = attendees.find((a) => a?.self === true);
    if (self && str(self.responseStatus) === "declined") continue;
    const start = eventTime(e.start);
    const end = eventTime(e.end);
    if (!start.iso) continue;
    const people = attendees
      .filter((a) => a && a.self !== true && a.resource !== true)
      .map((a) => str(a!.displayName) ?? str(a!.email))
      .filter((p): p is string => Boolean(p))
      .slice(0, 8);
    const conference =
      str(e.hangoutLink) ??
      str(
        asRecord(
          (Array.isArray(asRecord(e.conferenceData)?.entryPoints)
            ? (asRecord(e.conferenceData)!.entryPoints as unknown[])
            : [])[0],
        )?.uri,
      );
    signals.push({
      id: `googlecalendar:${id}`,
      source: "googlecalendar",
      kind: "event",
      title: str(e.summary) ?? "(untitled event)",
      snippet: cleanText(e.description, 280),
      url: str(e.htmlLink),
      timestamp: toIso(e.updated),
      startsAt: start.iso,
      endsAt: end.iso,
      people,
      container: str(e.location),
      refs: {
        eventId: id,
        allDay: start.allDay ? 1 : 0,
        conference,
        responseStatus: self ? str(self.responseStatus) : null,
        organizerSelf: asRecord(e.organizer)?.self === true ? 1 : 0,
        attendeeCount: attendees.length,
      },
    });
  }
  return signals;
}

// ── GitHub ────────────────────────────────────────────────────────────────

function repoFromUrl(url: string | null): string | null {
  if (!url) return null;
  const api = url.match(/\/repos\/([^/]+\/[^/]+)/);
  if (api) return api[1] ?? null;
  const html = url.match(/github\.com\/([^/]+\/[^/]+)/);
  return html?.[1] ?? null;
}

export function normalizeGithub(data: unknown, kind: BriefSignalKind): BriefSignal[] {
  const items = findArray(data, ["items", "issues", "results"]);
  const signals: BriefSignal[] = [];
  for (const entry of items) {
    const it = asRecord(entry);
    if (!it) continue;
    const htmlUrl = str(it.html_url) ?? str(it.url);
    const number = num(it.number);
    const repo = repoFromUrl(str(it.repository_url)) ?? repoFromUrl(htmlUrl);
    if (!htmlUrl || number == null || !repo) continue;
    const isPr = Boolean(it.pull_request) || /\/pull\//.test(htmlUrl);
    const author = str(asRecord(it.user)?.login) ?? str(it.author);
    const labels = Array.isArray(it.labels)
      ? it.labels.map((l) => str(asRecord(l)?.name) ?? str(l)).filter(Boolean)
      : [];
    const [owner, name] = repo.split("/");
    signals.push({
      id: `github:${repo}#${number}`,
      source: "github",
      kind: kind === "issue_assigned" && isPr ? "pr_authored" : kind,
      title: `${str(it.title) ?? "(untitled)"}`,
      snippet: cleanText(it.body, 320),
      url: htmlUrl,
      timestamp: toIso(it.updated_at ?? it.updatedAt),
      people: author ? [author] : [],
      container: repo,
      refs: {
        owner: owner ?? null,
        repo: name ?? null,
        number,
        isPr: isPr ? 1 : 0,
        draft: it.draft === true ? 1 : 0,
        comments: num(it.comments),
        labels: labels.join(","),
        createdAt: toIso(it.created_at),
      },
    });
  }
  return signals;
}

export function extractGithubLogin(data: unknown): string | null {
  return findStringDeep(data, "login");
}

// ── Linear ────────────────────────────────────────────────────────────────

const LINEAR_PRIORITY_LABELS: Record<number, string> = {
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

export function normalizeLinearIssues(data: unknown): BriefSignal[] {
  const assigned = findObject(data, "assignedIssues");
  const nodes = assigned ? findArray(assigned, ["nodes"]) : findArray(data, ["nodes", "issues"]);
  const signals: BriefSignal[] = [];
  for (const entry of nodes) {
    const issue = asRecord(entry);
    if (!issue) continue;
    const identifier = str(issue.identifier) ?? str(issue.id);
    if (!identifier) continue;
    const state = asRecord(issue.state);
    const stateType = str(state?.type);
    if (stateType === "completed" || stateType === "canceled") continue;
    const priority = num(issue.priority) ?? 0;
    const cycle = asRecord(issue.cycle);
    const comments = findArray(asRecord(issue.comments), ["nodes"]).map(asRecord).filter(Boolean);
    const lastComment = comments.at(-1);
    const lastCommentText = lastComment
      ? `${str(asRecord(lastComment.user)?.name) ?? "Someone"}: ${cleanText(lastComment.body, 160)}`
      : "";
    signals.push({
      id: `linear:${identifier}`,
      source: "linear",
      kind: "ticket",
      title: `${identifier} · ${str(issue.title) ?? "(untitled)"}`,
      snippet: cleanText(
        [cleanText(issue.description, 220), lastCommentText].filter(Boolean).join(" — "),
        320,
      ),
      url: str(issue.url),
      timestamp: toIso(issue.updatedAt),
      dueAt: toIso(issue.dueDate) ?? toIso(cycle?.endsAt),
      people: [],
      container: str(asRecord(issue.project)?.name) ?? str(asRecord(issue.team)?.name),
      refs: {
        issueId: str(issue.id),
        identifier,
        priority,
        priorityLabel: str(issue.priorityLabel) ?? LINEAR_PRIORITY_LABELS[priority] ?? null,
        state: str(state?.name),
        stateType,
      },
    });
  }
  return signals;
}

export function normalizeLinearNotifications(data: unknown): BriefSignal[] {
  const notifications = findObject(data, "notifications");
  const nodes = notifications ? findArray(notifications, ["nodes"]) : [];
  const signals: BriefSignal[] = [];
  for (const entry of nodes) {
    const n = asRecord(entry);
    if (!n) continue;
    if (str(n.readAt)) continue;
    const issue = asRecord(n.issue);
    const identifier = str(issue?.identifier);
    const id = str(n.id);
    if (!id || !identifier) continue;
    const actor = str(asRecord(n.actor)?.name);
    const type = str(n.type) ?? "update";
    signals.push({
      id: `linear:notification:${id}`,
      source: "linear",
      kind: "notification",
      title: `${identifier} · ${str(issue?.title) ?? "(untitled)"}`,
      snippet: cleanText(
        `${actor ?? "Someone"} ${type.replace(/([A-Z])/g, " $1").toLowerCase()}${
          str(asRecord(n.comment)?.body) ? `: ${cleanText(asRecord(n.comment)!.body, 200)}` : ""
        }`,
      ),
      url: str(issue?.url),
      timestamp: toIso(n.createdAt),
      people: actor ? [actor] : [],
      container: null,
      refs: { issueId: str(issue?.id), identifier, notificationType: type },
    });
  }
  return signals;
}

// ── Slack ─────────────────────────────────────────────────────────────────

/** Replace `<@U123>` and `<#C1|name>` tokens with readable text. */
export function cleanSlackText(text: unknown, names: Record<string, string> = {}): string {
  const raw = str(text) ?? "";
  const readable = raw
    .replace(/<@([A-Za-z0-9_]+)(?:\|([^>]+))?>/g, (_m, id: string, label?: string) =>
      label ? `@${label}` : `@${names[id] ?? "someone"}`,
    )
    .replace(/<#[A-Za-z0-9_]+\|([^>]+)>/g, "#$1")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<(https?:[^>]+)>/g, "$1");
  return cleanText(readable, 360);
}

export function normalizeSlack(data: unknown, selfUserId: string | null = null): BriefSignal[] {
  const messagesObj = findObject(data, "messages");
  const matches = messagesObj
    ? findArray(messagesObj, ["matches"])
    : findArray(data, ["matches", "messages"]);
  const signals: BriefSignal[] = [];
  const seen = new Set<string>();
  for (const entry of matches) {
    const m = asRecord(entry);
    if (!m) continue;
    const ts = str(m.ts);
    const channel = asRecord(m.channel);
    const channelId = str(channel?.id) ?? str(m.channel);
    if (!ts || !channelId) continue;
    const key = `${channelId}:${ts}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (selfUserId && str(m.user) === selfUserId) continue;
    const isDm = channel?.is_im === true || channelId.startsWith("D");
    const channelName = str(channel?.name);
    const author = str(m.username) ?? str(m.user_name) ?? str(m.user);
    const text = cleanSlackText(m.text, selfUserId ? { [selfUserId]: "you" } : {});
    if (!text) continue;
    signals.push({
      id: `slack:${key}`,
      source: "slack",
      kind: isDm ? "message" : "mention",
      title: isDm
        ? `DM from ${author ?? "someone"}`
        : `${author ?? "Someone"} in #${channelName ?? "channel"}`,
      snippet: text,
      url: str(m.permalink),
      timestamp: toIso(ts),
      people: author ? [author] : [],
      container: isDm ? "Direct message" : channelName ? `#${channelName}` : null,
      refs: {
        channel: channelId,
        ts,
        threadTs: str(m.thread_ts) ?? ts,
      },
    });
  }
  return signals;
}

export function extractSlackUserId(data: unknown): string | null {
  return findStringDeep(data, "user_id");
}
