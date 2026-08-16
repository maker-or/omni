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

test("streaming state renders single compact active row with live tool title and zero historical step nodes", () => {
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
  // Active row rendered
  expect(html).toContain('data-pipper-id="assistant-trace-deck-active"');
  expect(html).toContain("Searched the codebase");
  // Zero historical step items or heavy accordion structures rendered during streaming
  expect(html).not.toContain('data-pipper-id="assistant-tool-step"');
  expect(html).not.toContain('data-pipper-id="assistant-thinking-step"');
});

test("closed settled state renders default thought process header with zero unexpanded children", () => {
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
      open={false}
    />,
  );
  expect(html).toContain("Thought process");
  expect(html).toContain('data-state="closed"');
  // Child step details are lazily not rendered when closed
  expect(html).not.toContain('data-pipper-id="assistant-tool-step"');
});

test("open settled state renders full step details when open", () => {
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
      open={true}
    />,
  );
  expect(html).toContain("Thought process");
  expect(html).toContain('data-state="open"');
  // Child step details ARE rendered when open
  expect(html).toContain('data-pipper-id="assistant-tool-step"');
  expect(html).toContain("Searched the codebase");
});

test("bounds large settled tool output before rendering it", () => {
  const largeResult = Array.from({ length: 30_000 }, (_, index) => `line-${index}`).join("\n");
  const html = renderToStaticMarkup(
    <AssistantTraceDeck
      traceParts={[{ type: "toolCall", id: "call_1", name: "bash", args: {} }]}
      isStreaming={false}
      activeMessages={[
        {
          role: "toolResult",
          toolCallId: "call_1",
          content: largeResult,
        } as never,
      ]}
      open={true}
    />,
  );

  expect(html).toContain("[Earlier output truncated]");
  expect(html).toContain("line-29999");
  expect(html).not.toContain("line-0");
  expect(html.length).toBeLessThan(125_000);
});
