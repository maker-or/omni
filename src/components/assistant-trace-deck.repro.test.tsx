import { test, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantTraceDeck } from "@/components/ui/assistant-trace-deck";

test("thinking part with markdown separator renders bold text, no literal comment", () => {
  const html = renderToStaticMarkup(
    <AssistantTraceDeck
      traceParts={[
        {
          type: "thinking",
          thinking:
            "**Resolving ref callback collision for labels**\n\n<!-- -->\n\n**Refining style typing with React.CSSProperties**",
        },
      ]}
      isStreaming={false}
      activeMessages={[]}
      open={true}
    />,
  );
  expect(html).toContain("<strong>Resolving ref callback collision for labels</strong>");
  expect(html).toContain("<strong>Refining style typing with React.CSSProperties</strong>");
  expect(html).not.toContain("&lt;!--");
  expect(html).not.toContain("<!-- -->");
});

test("defaults to closed state even when streaming, showing active tool title in header", () => {
  const html = renderToStaticMarkup(
    <AssistantTraceDeck
      traceParts={[
        {
          type: "toolCall",
          id: "call_1",
          name: "bash",
          args: { command: "rg 'test' src/" },
        },
      ]}
      isStreaming={true}
      activeMessages={[]}
    />,
  );
  // Header shows active tool label
  expect(html).toContain("Searched the codebase");
  // Content details are not rendered in open state by default (data-state=closed)
  expect(html).toContain('data-state="closed"');
});

test("closed settled state renders default thought process header", () => {
  const html = renderToStaticMarkup(
    <AssistantTraceDeck
      traceParts={[
        {
          type: "toolCall",
          id: "call_1",
          name: "bash",
          args: { command: "rg 'test' src/" },
        },
      ]}
      isStreaming={false}
      activeMessages={[]}
    />,
  );
  expect(html).toContain("Thought process");
  expect(html).toContain('data-state="closed"');
});
