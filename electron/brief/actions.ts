import type { BriefAction, BriefRankedSignal, BriefSource } from "../../contracts/brief.ts";

/**
 * Turns LLM-written reply drafts into concrete, confirmable Composio calls.
 *
 * Jev (via `@composio/typesafe`'s `TypesafeProvider.decide`) routes the reply
 * request to one of the write tools; code then binds every open-ended
 * argument (recipient, thread, channel, body) from the source item, because
 * Jev never writes free text or ids. If Jev abstains or picks a tool that
 * doesn't belong to the item's source, the deterministic mapping wins.
 *
 * Nothing here executes a tool — execution happens only when the user clicks
 * the action in the brief page.
 */

export const REPLY_TOOLS: Partial<Record<BriefSource, string>> = {
  gmail: "GMAIL_CREATE_EMAIL_DRAFT",
  slack: "SLACK_SEND_MESSAGE",
  github: "GITHUB_CREATE_AN_ISSUE_COMMENT",
  linear: "LINEAR_CREATE_LINEAR_COMMENT",
};

const TOOL_SOURCE: Record<string, BriefSource> = Object.fromEntries(
  Object.entries(REPLY_TOOLS).map(([source, tool]) => [tool, source as BriefSource]),
);

export interface ReplyRouter {
  /** Returns the tool slug Jev chose, or null when it abstained. */
  route(request: string): Promise<{ tool: string; risk: BriefActionRisk } | null>;
}

type BriefActionRisk = "read_only" | "mutating" | "destructive";

export function replyArguments(
  entry: BriefRankedSignal,
  body: string,
): Record<string, unknown> | null {
  const { signal } = entry;
  const refs = signal.refs ?? {};
  switch (signal.source) {
    case "gmail": {
      if (!refs.senderEmail) return null;
      const subject = String(refs.subject ?? signal.title);
      return {
        user_id: "me",
        recipient_email: refs.senderEmail,
        subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
        body,
        thread_id: refs.threadId,
        is_html: false,
      };
    }
    case "slack":
      if (!refs.channel) return null;
      return { channel: refs.channel, thread_ts: refs.threadTs ?? refs.ts, markdown_text: body };
    case "github":
      if (!refs.owner || !refs.repo || refs.number == null) return null;
      return { owner: refs.owner, repo: refs.repo, issue_number: Number(refs.number), body };
    case "linear":
      if (!refs.issueId) return null;
      return { issueId: refs.issueId, body };
    default:
      return null;
  }
}

function actionLabel(source: BriefSource): string {
  switch (source) {
    case "gmail":
      return "Save reply as Gmail draft";
    case "slack":
      return "Reply in Slack thread";
    case "github":
      return "Post comment on GitHub";
    case "linear":
      return "Post comment on Linear";
    default:
      return "Send reply";
  }
}

export async function buildReplyActions(
  entries: BriefRankedSignal[],
  drafts: Map<string, string>,
  router: ReplyRouter | null,
): Promise<Map<string, BriefAction>> {
  const actions = new Map<string, BriefAction>();
  await Promise.all(
    entries.map(async (entry) => {
      const draft = drafts.get(entry.signal.id)?.trim();
      const expected = REPLY_TOOLS[entry.signal.source];
      if (!draft || !expected) return;
      const args = replyArguments(entry, draft);
      if (!args) return;
      let tool = expected;
      let risk: BriefActionRisk = "mutating";
      if (router) {
        try {
          const request = `Reply to "${entry.signal.title}"${
            entry.signal.people[0] ? ` from ${entry.signal.people[0]}` : ""
          } on ${entry.signal.source} with: ${draft}`;
          const routed = await router.route(request);
          if (routed && TOOL_SOURCE[routed.tool] === entry.signal.source) {
            tool = routed.tool;
            risk = routed.risk;
          }
        } catch (error) {
          console.warn("[Brief] Jev reply routing failed; using source default:", error);
        }
      }
      actions.set(entry.signal.id, {
        id: `${entry.signal.id}:reply`,
        kind: "composio",
        label: actionLabel(entry.signal.source),
        tool,
        arguments: args,
        preview: draft,
        risk,
      });
    }),
  );
  return actions;
}
