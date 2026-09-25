import { describe, expect, test } from "vitest";
import { BRIEF_SOURCES, type BriefDocument } from "../../contracts/brief.ts";
import { CONNECTOR_SVGS, connectorSvg, renderBriefPage, safeUrl, sourceBadge } from "./render.ts";

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

  test("provides SVG connector icons with unified 24x24 viewBox for all brief sources", () => {
    for (const source of BRIEF_SOURCES) {
      const svg = CONNECTOR_SVGS[source];
      expect(svg).toBeDefined();
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).toContain('width="24"');
      expect(svg).toContain('height="24"');
      expect(svg).toContain('fill="currentColor"');

      const badge = sourceBadge(source);
      expect(badge).toContain(`class="src ${source}"`);
      expect(badge).toContain("<svg");
    }

    expect(connectorSvg("calendar")).toBe(CONNECTOR_SVGS.googlecalendar);
    expect(connectorSvg("calender")).toBe(CONNECTOR_SVGS.googlecalendar);
    expect(connectorSvg("googlecalendar")).toBe(CONNECTOR_SVGS.googlecalendar);
    expect(connectorSvg("gmail")).toBe(CONNECTOR_SVGS.gmail);
    expect(connectorSvg("github")).toBe(CONNECTOR_SVGS.github);
    expect(connectorSvg("linear")).toBe(CONNECTOR_SVGS.linear);
    expect(connectorSvg("slack")).toBe(CONNECTOR_SVGS.slack);
  });
});
