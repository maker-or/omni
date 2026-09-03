import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ThreadComposer } from "./thread-composer";
import { buildContent } from "@/lib/composer-tokens";

describe("thread composer presentation", () => {
  test("supports a transparent inline editor without main-composer controls", () => {
    const html = renderToStaticMarkup(
      <ThreadComposer
        mode="live"
        content={buildContent([], "Continue the task")}
        onContentChange={() => undefined}
        onSend={() => undefined}
        files={[]}
        onFilesChange={() => undefined}
        appearance="plain"
        hideSendButton
        turnMarker={<span>Identity</span>}
      />,
    );

    expect(html).toContain('data-appearance="plain"');
    expect(html).not.toContain('aria-label="Attach images"');
    expect(html).not.toContain('aria-label="Send"');
    expect(html).toContain('data-pipper-id="composer-turn-marker"');
    expect(html).toContain("flex items-center gap-3");
    expect(html).toContain("caret-color:#26B25A");
    expect(html).toContain("min-h-11");
    expect(html).toContain("max-h-[76px]");
    expect(html).toContain("Identity");
  });
});
