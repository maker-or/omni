import { describe, expect, test } from "vitest";
import {
  cleanText,
  normalizeCalendar,
  normalizeGithub,
  normalizeGmail,
  normalizeLinearIssues,
  normalizeLinearNotifications,
  normalizeSlack,
  parseAddress,
} from "./normalize.ts";

describe("normalizing Composio payloads into brief signals", () => {
  test("Gmail: one signal per thread, self-sent mail skipped, quoted history stripped", () => {
    const signals = normalizeGmail(
      {
        data: {
          messages: [
            {
              messageId: "a",
              threadId: "t1",
              subject: "Q3 deck",
              sender: '"Priya Raman" <priya@acme.com>',
              messageText: "Can you send it by 2pm?\nOn Mon, Sam wrote:\n> old stuff",
              messageTimestamp: "1790000000000",
              labelIds: ["IMPORTANT"],
            },
            {
              messageId: "b",
              threadId: "t1",
              subject: "Q3 deck (older)",
              sender: "priya@acme.com",
            },
            {
              messageId: "c",
              threadId: "t2",
              subject: "note to self",
              sender: "Sam <sam@acme.com>",
            },
          ],
        },
      },
      "sam@acme.com",
    );
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      id: "gmail:t1",
      title: "Q3 deck",
      snippet: "Can you send it by 2pm?",
      people: ["Priya Raman"],
      container: "Important",
      refs: expect.objectContaining({ senderEmail: "priya@acme.com", threadId: "t1" }),
    });
  });

  test("Calendar: skips cancelled and declined events, keeps attendees and join link", () => {
    const signals = normalizeCalendar({
      items: [
        {
          id: "1",
          summary: "Standup",
          start: { dateTime: "2026-09-22T09:00:00Z" },
          end: { dateTime: "2026-09-22T09:15:00Z" },
          hangoutLink: "https://meet.google.com/x",
          attendees: [
            { email: "me@x", self: true, responseStatus: "accepted" },
            { displayName: "Lee" },
          ],
        },
        {
          id: "2",
          summary: "Gone",
          status: "cancelled",
          start: { dateTime: "2026-09-22T10:00:00Z" },
        },
        {
          id: "3",
          summary: "Nope",
          start: { dateTime: "2026-09-22T11:00:00Z" },
          attendees: [{ self: true, responseStatus: "declined" }],
        },
      ],
    });
    expect(signals.map((s) => s.title)).toEqual(["Standup"]);
    expect(signals[0]!.people).toEqual(["Lee"]);
    expect(signals[0]!.refs?.conference).toBe("https://meet.google.com/x");
  });

  test("GitHub: derives repo and PR-ness from search items", () => {
    const [pr] = normalizeGithub(
      {
        items: [
          {
            number: 7,
            title: "Add retries",
            html_url: "https://github.com/acme/api/pull/7",
            repository_url: "https://api.github.com/repos/acme/api",
            user: { login: "lee" },
            pull_request: {},
          },
        ],
      },
      "pr_review_requested",
    );
    expect(pr).toMatchObject({
      id: "github:acme/api#7",
      container: "acme/api",
      refs: expect.objectContaining({ owner: "acme", repo: "api", number: 7, isPr: 1 }),
    });
  });

  test("Linear: open assigned issues with priority, unread notifications only", () => {
    const issues = normalizeLinearIssues({
      data: {
        viewer: {
          assignedIssues: {
            nodes: [
              {
                id: "i1",
                identifier: "ENG-1",
                title: "Crash on login",
                priority: 1,
                state: { type: "started", name: "In Progress" },
                dueDate: "2026-09-22",
              },
              { id: "i2", identifier: "ENG-2", title: "Done thing", state: { type: "completed" } },
            ],
          },
        },
      },
    });
    expect(issues.map((i) => i.title)).toEqual(["ENG-1 · Crash on login"]);
    expect(issues[0]!.refs?.priorityLabel).toBe("Urgent");
    const notes = normalizeLinearNotifications({
      notifications: {
        nodes: [
          {
            id: "n1",
            type: "issueComment",
            readAt: null,
            issue: { identifier: "ENG-3", title: "X" },
            actor: { name: "Ana" },
          },
          {
            id: "n2",
            type: "issueComment",
            readAt: "2026-09-21",
            issue: { identifier: "ENG-4", title: "Y" },
          },
        ],
      },
    });
    expect(notes.map((n) => n.id)).toEqual(["linear:notification:n1"]);
  });

  test("Slack: readable mentions, DMs detected, own messages skipped", () => {
    const signals = normalizeSlack(
      {
        messages: {
          matches: [
            {
              ts: "1790000000.1",
              text: "<@U_ME> can you review?",
              username: "lee",
              channel: { id: "C1", name: "eng" },
            },
            {
              ts: "1790000001.1",
              text: "ping",
              username: "ana",
              channel: { id: "D1", is_im: true },
            },
            { ts: "1790000002.1", text: "mine", user: "U_ME", channel: { id: "C1", name: "eng" } },
          ],
        },
      },
      "U_ME",
    );
    expect(signals.map((s) => [s.kind, s.snippet])).toEqual([
      ["mention", "@you can you review?"],
      ["message", "ping"],
    ]);
  });

  test("text helpers are defensive", () => {
    expect(cleanText("<p>Hello&nbsp;<b>there</b></p>")).toBe("Hello there");
    expect(cleanText(null)).toBe("");
    expect(cleanText("x".repeat(500), 10)).toHaveLength(10);
    expect(parseAddress("jo@x.com")).toEqual({ name: null, email: "jo@x.com" });
    expect(normalizeGmail("garbage")).toEqual([]);
    expect(normalizeSlack(undefined)).toEqual([]);
  });
});
