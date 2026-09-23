import type { BriefSignal, BriefSource } from "../../contracts/brief.ts";
import {
  extractGithubLogin,
  extractGmailProfileEmail,
  extractSlackUserId,
  findStringDeep,
  normalizeCalendar,
  normalizeGithub,
  normalizeGmail,
  normalizeLinearIssues,
  normalizeLinearNotifications,
  normalizeSlack,
} from "./normalize.ts";

/** The only capability collectors need; `ComposioGateway` satisfies it. */
export interface ToolRunner {
  execute(tool: string, args: Record<string, unknown>): Promise<unknown>;
}

/** Who the user is on each tool, used to filter self-authored noise and to ground the writer. */
export interface BriefIdentity {
  email: string | null;
  githubLogin: string | null;
  slackUserId: string | null;
  linearName: string | null;
}

export interface CollectorResult {
  source: BriefSource;
  signals: BriefSignal[];
  /** Set when the source failed entirely; partial failures only log. */
  error: string | null;
}

export interface CollectContext {
  now: Date;
  runner: ToolRunner;
  identity: BriefIdentity;
}

function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run several independent reads for one source; the source only fails when
 * every read fails, so e.g. a broken notifications query doesn't hide the
 * assigned-issue list.
 */
async function settleAll(
  source: BriefSource,
  reads: Array<() => Promise<BriefSignal[]>>,
): Promise<CollectorResult> {
  const results = await Promise.allSettled(reads.map((read) => read()));
  const signals: BriefSignal[] = [];
  const errors: string[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") signals.push(...result.value);
    else errors.push(message(result.reason));
  }
  if (errors.length > 0) console.warn(`[Brief] ${source} partial failure:`, errors);
  const deduped = new Map<string, BriefSignal>();
  for (const signal of signals) if (!deduped.has(signal.id)) deduped.set(signal.id, signal);
  return {
    source,
    signals: [...deduped.values()],
    error: errors.length === results.length && results.length > 0 ? errors[0]! : null,
  };
}

// ── Identity ──────────────────────────────────────────────────────────────

export async function resolveIdentity(
  runner: ToolRunner,
  connected: Record<BriefSource, boolean>,
): Promise<BriefIdentity> {
  const identity: BriefIdentity = {
    email: null,
    githubLogin: null,
    slackUserId: null,
    linearName: null,
  };
  const tasks: Promise<void>[] = [];
  if (connected.gmail) {
    tasks.push(
      runner
        .execute("GMAIL_GET_PROFILE", { user_id: "me" })
        .then((data) => {
          identity.email = extractGmailProfileEmail(data);
        })
        .catch(() => {}),
    );
  }
  if (connected.github) {
    tasks.push(
      runner
        .execute("GITHUB_GET_THE_AUTHENTICATED_USER", {})
        .then((data) => {
          identity.githubLogin = extractGithubLogin(data);
        })
        .catch(() => {}),
    );
  }
  if (connected.slack) {
    tasks.push(
      runner
        .execute("SLACK_TEST_AUTH", {})
        .then((data) => {
          identity.slackUserId = extractSlackUserId(data);
        })
        .catch(() => {}),
    );
  }
  if (connected.linear) {
    tasks.push(
      runner
        .execute("LINEAR_RUN_QUERY_OR_MUTATION", {
          query_or_mutation: "query { viewer { name email } }",
        })
        .then((data) => {
          identity.linearName = findStringDeep(data, "name");
          identity.email ??= findStringDeep(data, "email");
        })
        .catch(() => {}),
    );
  }
  await Promise.all(tasks);
  return identity;
}

// ── Sources ───────────────────────────────────────────────────────────────

export async function collectGmail(ctx: CollectContext): Promise<CollectorResult> {
  const base = "-category:promotions -category:social -category:forums -in:chats";
  return settleAll("gmail", [
    async () =>
      normalizeGmail(
        await ctx.runner.execute("GMAIL_FETCH_EMAILS", {
          user_id: "me",
          query: `in:inbox is:unread newer_than:3d ${base}`,
          max_results: 25,
          include_payload: false,
          verbose: false,
        }),
        ctx.identity.email,
      ),
    async () =>
      normalizeGmail(
        await ctx.runner.execute("GMAIL_FETCH_EMAILS", {
          user_id: "me",
          query: `in:inbox (is:starred OR is:important) newer_than:7d ${base}`,
          max_results: 15,
          include_payload: false,
          verbose: false,
        }),
        ctx.identity.email,
      ),
  ]);
}

export async function collectCalendar(ctx: CollectContext): Promise<CollectorResult> {
  const dayStart = startOfDay(ctx.now);
  // Today plus tomorrow morning, so an early meeting tomorrow can be prepped.
  const until = new Date(dayStart.getTime() + 36 * 60 * 60 * 1000);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return settleAll("googlecalendar", [
    async () =>
      normalizeCalendar(
        await ctx.runner.execute("GOOGLECALENDAR_EVENTS_LIST", {
          calendarId: "primary",
          timeMin: dayStart.toISOString(),
          timeMax: until.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 40,
          timeZone,
        }),
      ),
  ]);
}

export async function collectGithub(ctx: CollectContext): Promise<CollectorResult> {
  const since = isoDay(new Date(ctx.now.getTime() - 7 * 24 * 60 * 60 * 1000));
  const search = (q: string, perPage = 20) =>
    ctx.runner.execute("GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS", {
      q,
      per_page: perPage,
      sort: "updated",
      order: "desc",
    });
  return settleAll("github", [
    async () =>
      normalizeGithub(
        await search("is:open is:pr review-requested:@me archived:false"),
        "pr_review_requested",
      ),
    async () =>
      normalizeGithub(await search("is:open is:pr author:@me archived:false", 15), "pr_authored"),
    async () =>
      normalizeGithub(
        await search("is:open is:issue assignee:@me archived:false", 15),
        "issue_assigned",
      ),
    async () =>
      normalizeGithub(
        await search(`is:open mentions:@me updated:>=${since} archived:false`, 15),
        "mention",
      ),
  ]);
}

const LINEAR_ISSUES_QUERY = `query BriefAssigned {
  viewer {
    assignedIssues(
      first: 30
      orderBy: updatedAt
      filter: { state: { type: { nin: ["completed", "canceled"] } } }
    ) {
      nodes {
        id identifier title url priority priorityLabel dueDate updatedAt description
        state { name type }
        project { name }
        team { name }
        cycle { endsAt }
        comments(last: 2) { nodes { body createdAt user { name } } }
      }
    }
  }
}`;

/** Fallback when a workspace rejects one of the richer fields above. */
const LINEAR_ISSUES_QUERY_MINIMAL = `query BriefAssignedMinimal {
  viewer {
    assignedIssues(first: 30, orderBy: updatedAt) {
      nodes { id identifier title url priority dueDate updatedAt state { name type } }
    }
  }
}`;

const LINEAR_NOTIFICATIONS_QUERY = `query BriefNotifications {
  notifications(first: 25) {
    nodes {
      id type createdAt readAt
      actor { name }
      ... on IssueNotification {
        issue { id identifier title url }
        comment { body }
      }
    }
  }
}`;

function graphqlErrors(data: unknown): string | null {
  const errors = (data as { errors?: unknown })?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0] as { message?: unknown };
    return typeof first?.message === "string" ? first.message : "GraphQL error";
  }
  return null;
}

export async function collectLinear(ctx: CollectContext): Promise<CollectorResult> {
  const run = (query: string) =>
    ctx.runner.execute("LINEAR_RUN_QUERY_OR_MUTATION", { query_or_mutation: query });
  return settleAll("linear", [
    async () => {
      const data = await run(LINEAR_ISSUES_QUERY);
      const issues = normalizeLinearIssues(data);
      if (issues.length === 0 && graphqlErrors(data)) {
        return normalizeLinearIssues(await run(LINEAR_ISSUES_QUERY_MINIMAL));
      }
      return issues;
    },
    async () => normalizeLinearNotifications(await run(LINEAR_NOTIFICATIONS_QUERY)),
  ]);
}

export async function collectSlack(ctx: CollectContext): Promise<CollectorResult> {
  const after = isoDay(new Date(ctx.now.getTime() - 2 * 24 * 60 * 60 * 1000));
  const search = (query: string) =>
    ctx.runner.execute("SLACK_SEARCH_MESSAGES", {
      query,
      count: 25,
      sort: "timestamp",
      sort_dir: "desc",
    });
  const self = ctx.identity.slackUserId;
  const reads: Array<() => Promise<BriefSignal[]>> = [
    async () => normalizeSlack(await search(`to:me after:${after}`), self),
  ];
  if (self) {
    reads.push(async () => normalizeSlack(await search(`<@${self}> after:${after}`), self));
  }
  return settleAll("slack", reads);
}

export const COLLECTORS: Record<BriefSource, (ctx: CollectContext) => Promise<CollectorResult>> = {
  gmail: collectGmail,
  googlecalendar: collectCalendar,
  github: collectGithub,
  linear: collectLinear,
  slack: collectSlack,
};

/** Run every connected collector concurrently; never throws. */
export async function collectAll(
  ctx: CollectContext,
  connected: Record<BriefSource, boolean>,
): Promise<CollectorResult[]> {
  const sources = (Object.keys(COLLECTORS) as BriefSource[]).filter((s) => connected[s]);
  const settled = await Promise.allSettled(sources.map((source) => COLLECTORS[source](ctx)));
  return settled.map((result, index) =>
    result.status === "fulfilled"
      ? result.value
      : { source: sources[index]!, signals: [], error: message(result.reason) },
  );
}
