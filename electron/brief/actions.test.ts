import { describe, expect, test } from "vitest";
import type { BriefRankedSignal } from "../../contracts/brief.ts";
import { buildReplyActions } from "./actions.ts";
import { heuristicTriage } from "./scoring.ts";

function entry(
  source: "gmail" | "slack",
  refs: Record<string, string | number | null>,
): BriefRankedSignal {
  const signal = {
    id: `${source}:1`,
    source,
    kind: source === "gmail" ? ("email" as const) : ("message" as const),
    title: "Q3 deck",
    snippet: "",
    url: null,
    timestamp: null,
    people: ["Priya"],
    refs,
  };
  return { signal, triage: heuristicTriage(signal, new Date()), priority: 0.8 };
}

describe("reply actions", () => {
  test("binds recipient, thread and body from the source item", async () => {
    const actions = await buildReplyActions(
      [entry("gmail", { senderEmail: "priya@acme.com", threadId: "t1", subject: "Q3 deck" })],
      new Map([["gmail:1", "Sending it by noon."]]),
      null,
    );
    const action = actions.get("gmail:1");
    expect(action).toMatchObject({
      kind: "composio",
      tool: "GMAIL_CREATE_EMAIL_DRAFT",
      arguments: {
        recipient_email: "priya@acme.com",
        thread_id: "t1",
        subject: "Re: Q3 deck",
        body: "Sending it by noon.",
      },
    });
  });

  test("uses Jev's tool choice only when it matches the item's source", async () => {
    const wrong = {
      route: async () => ({ tool: "LINEAR_CREATE_LINEAR_COMMENT", risk: "mutating" as const }),
    };
    const actions = await buildReplyActions(
      [entry("slack", { channel: "C1", ts: "1.2", threadTs: "1.0" })],
      new Map([["slack:1", "Deployed."]]),
      wrong,
    );
    expect(actions.get("slack:1")).toMatchObject({
      tool: "SLACK_SEND_MESSAGE",
      arguments: { channel: "C1", thread_ts: "1.0", markdown_text: "Deployed." },
    });
  });

  test("no draft or missing identifiers means no action", async () => {
    const actions = await buildReplyActions(
      [entry("gmail", { threadId: "t1" }), entry("slack", { channel: "C1" })],
      new Map([["gmail:1", "hi"]]),
      null,
    );
    expect(actions.size).toBe(0);
  });
});
