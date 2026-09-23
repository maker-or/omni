import { describe, expect, test } from "vitest";
import type { BriefDocument } from "../../contracts/brief.ts";
import { renderBriefPage, safeUrl } from "./render.ts";

function doc(overrides: Partial<BriefDocument> = {}): BriefDocument {
  return {
    version: 1,
    date: "2026-09-22",
    generatedAt: "2026-09-22T08:00:00.000Z",
    trigger: "launch",
    greeting: "Good morning, Sam",
    headline: "Review <script>alert(1)</script> first",
    summary: "One meeting today.",
    todos: [
      {
        id: "gmail:t1",
        signalIds: ["gmail:t1"],
        source: "gmail",
        title: "Reply to Priya",
        why: "She needs sign-off before 3pm.",
        url: "javascript:alert(1)",
        meta: "Inbox · 2h ago",
        priority: 0.9,
        actions: [
          {
            id: "gmail:t1:reply",
            kind: "composio",
            label: "Save reply as Gmail draft",
            tool: "GMAIL_CREATE_EMAIL_DRAFT",
            arguments: { body: "Approved" },
            preview: "Approved </textarea><b>x</b>",
            risk: "mutating",
          },
        ],
      },
    ],
    context: [],
    push: null,
    agenda: [],
    sources: [
      { source: "gmail", connected: true, itemCount: 3, error: null },
      { source: "slack", connected: false, itemCount: 0, error: null },
    ],
    writer: "builtin",
    analysis: { model: "jev-1.13.0", signalsAnalyzed: 3, signalsKept: 1 },
    ...overrides,
  };
}

describe("brief HTML", () => {
  const html = renderBriefPage(doc(), { token: "abc123", theme: "dark" });

  test("escapes model and source text so nothing can inject markup", () => {
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("</textarea><b>x</b>");
  });

  test("never renders non-http links", () => {
    expect(html).not.toContain("javascript:alert");
    expect(safeUrl("file:///etc/passwd")).toBeNull();
    expect(safeUrl("https://github.com/a/b")).toBe("https://github.com/a/b");
  });

  test("write actions show an editable draft that needs a confirming click", () => {
    expect(html).toContain('data-kind="composio"');
    expect(html).toContain('data-confirm="1"');
    expect(html).toContain("Save draft");
  });

  test("respects the app theme and offers to connect missing tools", () => {
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('data-connect="slack"');
    expect(html).toContain("jev-1.13.0");
  });
});
