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
