import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ThreadCompletionDockView } from "./thread-completion-dock";

const noop = () => undefined;

describe("thread completion dock", () => {
  test("names the finished thread, its project, and how many more wait", () => {
    const html = renderToStaticMarkup(
      <ThreadCompletionDockView
        title="Fix login redirect"
        projectName="Omni"
        remaining={2}
        onDismiss={noop}
        onOpen={noop}
      />,
    );
    expect(html).toContain('data-pipper-id="thread-completion-dock"');
    expect(html).toContain("Fix login redirect");
    expect(html).toContain("Omni");
    expect(html).toContain("2 more threads waiting");
    expect(html).toContain('aria-label="Open Fix login redirect"');
    expect(html).toContain('aria-label="Dismiss Fix login redirect"');
  });

  test("omits the project and the waiting count when there is nothing to add", () => {
    const html = renderToStaticMarkup(
      <ThreadCompletionDockView
        title="Untitled thread"
        projectName={null}
        remaining={0}
        onDismiss={noop}
        onOpen={noop}
      />,
    );
    expect(html).toContain("Untitled thread");
    expect(html).not.toContain(" · ");
    expect(html).not.toContain("waiting");
  });

  test("uses the singular for a single waiting thread", () => {
    const html = renderToStaticMarkup(
      <ThreadCompletionDockView
        title="T"
        projectName={null}
        remaining={1}
        onDismiss={noop}
        onOpen={noop}
      />,
    );
    expect(html).toContain("1 more thread waiting");
  });
});
