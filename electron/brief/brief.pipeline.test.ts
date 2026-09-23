import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BRIEF_LATEST_URL } from "../../contracts/brief.ts";

/**
 * End-to-end behavior of the Morning Brief pipeline with Composio and Jev
 * replaced by in-memory fakes: connected tools in, a ranked, rendered,
 * actionable brief out — and nothing written on the user's behalf until an
 * explicit action request carrying the page token.
 */

const NOW = new Date(2026, 8, 22, 8, 30, 0);
const iso = (hoursFromNow: number) =>
  new Date(NOW.getTime() + hoursFromNow * 3600_000).toISOString();

const executed: Array<{ tool: string; args: Record<string, unknown> }> = [];
let connected: Record<string, boolean> = {};

const TOOL_DATA: Record<string, (args: Record<string, unknown>) => unknown> = {
  GMAIL_GET_PROFILE: () => ({ emailAddress: "sam@acme.dev" }),
  GITHUB_GET_THE_AUTHENTICATED_USER: () => ({ login: "sam" }),
  SLACK_TEST_AUTH: () => ({ user_id: "U_SAM" }),
  GMAIL_FETCH_EMAILS: (args) =>
    String(args.query).includes("is:unread")
      ? {
          messages: [
            {
              messageId: "m1",
              threadId: "t1",
              subject: "Contract redlines — need your sign-off today",
              sender: "Priya Raman <priya@customer.com>",
              messageText: "Hi Sam, legal needs your approval on the redlines before 3pm.",
              messageTimestamp: iso(-2),
              labelIds: ["INBOX", "IMPORTANT", "UNREAD"],
            },
            {
              messageId: "m2",
              threadId: "t2",
              subject: "This week's top stories",
              sender: "Medium Daily Digest <noreply@medium.com>",
              messageText: "Stories picked for you",
              messageTimestamp: iso(-5),
              labelIds: ["INBOX", "UNREAD"],
            },
          ],
        }
      : { messages: [] },
  GOOGLECALENDAR_EVENTS_LIST: () => ({
    items: [
      {
        id: "e1",
        summary: "Release sync",
        start: { dateTime: iso(1.5) },
        end: { dateTime: iso(2) },
        hangoutLink: "https://meet.google.com/abc-defg-hij",
        attendees: [
          { email: "sam@acme.dev", self: true, responseStatus: "accepted" },
          { email: "lee@acme.dev", displayName: "Lee" },
        ],
      },
      {
        id: "e2",
        summary: "Declined offsite planning",
        start: { dateTime: iso(3) },
        end: { dateTime: iso(4) },
        attendees: [{ email: "sam@acme.dev", self: true, responseStatus: "declined" }],
      },
    ],
  }),
  GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS: (args) =>
    String(args.q).includes("review-requested")
      ? {
          items: [
            {
              number: 42,
              title: "Fix token refresh race",
              html_url: "https://github.com/acme/api/pull/42",
              repository_url: "https://api.github.com/repos/acme/api",
              user: { login: "lee" },
              updated_at: iso(-1),
              pull_request: {},
              body: "Blocks the 2.4 release.",
            },
          ],
        }
      : { items: [] },
  LINEAR_RUN_QUERY_OR_MUTATION: () => ({ data: { viewer: { assignedIssues: { nodes: [] } } } }),
  SLACK_SEARCH_MESSAGES: () => ({ messages: { matches: [] } }),
};

vi.mock("./composio.ts", () => {
  class FakeGateway {
    readonly userId = "pipper-test";
    readonly provider = {
      decide: vi.fn(async () => ({
        kind: "call",
        tool: "GMAIL_CREATE_EMAIL_DRAFT",
        risk: "mutating",
      })),
    };
    readonly client = { tools: { get: vi.fn(async () => ({ tools: [] })) } };
    async connections() {
      return {
        gmail: false,
        googlecalendar: false,
        github: false,
        linear: false,
        slack: false,
        ...connected,
      };
    }
    async authorize() {
      return "https://connect.composio.dev/link/test";
    }
    async execute(tool: string, args: Record<string, unknown>) {
      executed.push({ tool, args });
      const handler = TOOL_DATA[tool];
      if (!handler) throw new Error(`unexpected tool ${tool}`);
      return handler(args);
    }
  }
  return { ComposioGateway: FakeGateway };
});

vi.mock("@typesafe-ai/sdk", () => {
  class TypeSafeClient {
    async systemOne(request: { state: { item: { kind: string; title: string } } }) {
      const { kind, title } = request.state.item;
      const noise = /digest|stories/i.test(title);
      const answers = {
        needs_action: { type: "noul", noul: noise ? 0.02 : kind === "event" ? 0.3 : 0.92 },
        importance: {
          type: "score",
          score: noise ? 0 : kind === "pr_review_requested" ? 3.9 : 3.2,
          confidence: 0.9,
        },
        urgency: { type: "score", score: noise ? 0 : 2.5, confidence: 0.9 },
        section: {
          type: "choice",
          choice: noise ? "noise" : kind === "event" ? "context" : "todo",
          confidence: 0.95,
        },
        help: {
          type: "choice",
          choice:
            kind === "pr_review_requested"
              ? "review_code"
              : kind === "email"
                ? "draft_reply"
                : "none",
          confidence: 0.9,
        },
      };
      return { model: "jev-test", answers };
    }
  }
  return { TypeSafeClient };
});

const { BriefService } = await import("./service.ts");
const { BriefStore } = await import("./store.ts");

let dir: string;
let service: InstanceType<typeof BriefService>;
const opened: Array<{ url: string; activate: boolean }> = [];
const drafts: string[] = [];

function makeService(keys = { composio: "ak_test", typesafe: "ts_test", anthropic: null }) {
  return new BriefService({
    store: new BriefStore(dir),
    envKeys: keys,
    getTheme: () => "light",
    getUser: () => ({ id: "user-1", name: "Sam Rivera" }),
    resolveClaudeBinary: () => null,
    openExternal: () => {},
    openInApp: (url, activate) => {
      opened.push({ url, activate });
      return true;
    },
    startAgentDraft: (prompt) => {
      drafts.push(prompt);
      return true;
    },
    notify: () => {},
    broadcastStatus: () => {},
    now: () => NOW,
  });
}

async function page(path: string, init?: RequestInit): Promise<Response> {
  return service.handleRequest(new Request(`pipper-brief://brief${path}`, init));
}

function tokenOf(html: string): string {
  return /const TOKEN = "([a-f0-9]+)"/.exec(html)![1]!;
}

beforeEach(async () => {
  dir = await mkdtemp(join(os.tmpdir(), "pipper-brief-"));
  executed.length = 0;
  opened.length = 0;
  drafts.length = 0;
  connected = { gmail: true, googlecalendar: true, github: true, slack: true, linear: true };
  service = makeService();
});

afterEach(async () => {
  service.dispose();
  await rm(dir, { recursive: true, force: true });
});

describe("Morning Brief pipeline", () => {
  test("turns connected tools into a ranked brief that leads with what's waiting on the user", async () => {
    const doc = await service.generate("launch");
    expect(doc).not.toBeNull();
    const titles = doc!.todos.map((t) => t.title);
    expect(titles[0]).toBe("Fix token refresh race");
    expect(titles).toContain("Contract redlines — need your sign-off today");
    // Jev called the newsletter noise: it never earns a place.
    const everything = [...doc!.todos, ...doc!.context].map((i) => i.title).join(" ");
    expect(everything).not.toMatch(/top stories/i);
    // Meetings go to the agenda (declined ones are dropped).
    expect(doc!.agenda.map((a) => a.title)).toEqual(["Release sync"]);
    expect(doc!.agenda[0]!.url).toContain("meet.google.com");
    expect(doc!.analysis.model).toBe("jev-test");
    expect(doc!.greeting).toBe("Good morning, Sam");
    // Reading only: no write tool ran while building the brief.
    expect(executed.some((e) => /CREATE|SEND|COMMENT/.test(e.tool))).toBe(false);
  });

  test("offers a concrete Pipper hand-off for the most important work", async () => {
    const doc = await service.generate("launch");
    const push = doc!.push!;
    expect(push.title).toBe("Fix token refresh race");
    const agent = push.actions.find((a) => a.kind === "agent");
    expect(agent && agent.kind === "agent" && agent.prompt).toContain("acme/api#42");
  });

  test("serves the rendered brief in the embedded browser and runs actions only with the page token", async () => {
    await service.generate("launch");
    const res = await page("/today");
    const html = await res.text();
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("Fix token refresh race");
    expect(html).toContain("Needs you");

    const doc = (await new BriefStore(dir).loadLatest())!;
    const agentAction = doc.push!.actions.find((a) => a.kind === "agent")!;

    const forbidden = await page("/api/action", {
      method: "POST",
      body: JSON.stringify({ id: agentAction.id }),
    });
    expect(forbidden.status).toBe(403);
    expect(drafts).toHaveLength(0);

    const ok = await page("/api/action", {
      method: "POST",
      headers: { "x-brief-token": tokenOf(html) },
      body: JSON.stringify({ id: agentAction.id }),
    });
    expect(ok.status).toBe(200);
    expect(drafts[0]).toContain("acme/api#42");
  });

  test("first launch of the day opens the brief; later launches that day stay quiet", async () => {
    await service.onLaunch();
    expect(opened).toEqual([{ url: BRIEF_LATEST_URL, activate: true }]);
    // Let the launch-triggered generation finish.
    await service.generate("launch");

    const second = makeService();
    opened.length = 0;
    await second.onLaunch();
    expect(opened).toEqual([]);
    second.dispose();
  });

  test("with nothing connected the brief page asks the user to connect their tools", async () => {
    connected = {};
    const doc = await service.generate("launch");
    expect(doc).toBeNull();
    expect(service.getStatus().phase).toBe("needs-setup");
    const html = await (await page("/today")).text();
    expect(html).toContain("Connect your tools");
    expect(html).toContain('data-connect="gmail"');
  });

  test("without a Composio key nothing is fetched and setup explains what's missing", async () => {
    service.dispose();
    service = makeService({
      composio: null as unknown as string,
      typesafe: "ts_test",
      anthropic: null,
    });
    await service.generate("launch");
    expect(executed).toHaveLength(0);
    const html = await (await page("/today")).text();
    expect(html).toContain("a Composio API key");
  });
});
