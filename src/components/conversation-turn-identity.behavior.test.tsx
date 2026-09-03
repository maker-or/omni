import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ConversationTurnIdentity } from "@/components/conversation-turn-identity";

describe("conversation turn identity", () => {
  test("uses the shared user identity as a noninteractive marker", () => {
    const html = renderToStaticMarkup(<ConversationTurnIdentity role="user" />);
    const composerHtml = renderToStaticMarkup(
      <ConversationTurnIdentity role="user" emphasis="composer" />,
    );

    expect(html).toContain('data-pipper-id="user-turn-identity"');
    expect(html).toContain('fill="#26B25A"');
    expect(html).toContain("size-7");
    expect(html).not.toContain("opacity-60");
    expect(html).not.toContain("saturate-50");
    expect(composerHtml).not.toContain("opacity-75");
    expect(composerHtml).not.toContain("saturate-75");
    expect(composerHtml).toContain("size-8");
    expect(html).not.toContain("<button");
  });

  test("keeps a settled assistant identity out of the tab order", () => {
    const html = renderToStaticMarkup(<ConversationTurnIdentity role="assistant" />);

    expect(html).toContain('data-pipper-id="assistant-turn-identity"');
    expect(html).toContain('fill="#FFAA4F"');
    expect(html).toContain('fill="#B1620D"');
    expect(html).not.toContain("<button");
  });

  test("turns only the streaming assistant identity into the stop control", () => {
    const activeHtml = renderToStaticMarkup(
      <ConversationTurnIdentity role="assistant" isStreaming onStop={() => undefined} />,
    );
    const stoppingHtml = renderToStaticMarkup(
      <ConversationTurnIdentity role="assistant" isStreaming isStopping onStop={() => undefined} />,
    );

    expect(activeHtml).toContain('data-pipper-id="assistant-turn-stop"');
    expect(activeHtml).toContain('aria-label="Stop response"');
    expect(activeHtml).not.toContain("opacity-75");
    expect(activeHtml).not.toContain("saturate-75");
    expect(activeHtml).not.toMatch(/<button[^>]*\sdisabled(?:=|>)/);
    expect(stoppingHtml).toContain('aria-label="Stopping response"');
    expect(stoppingHtml).toMatch(/<button[^>]*\sdisabled(?:=|>)/);
  });
});
