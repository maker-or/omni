import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ChatMessage } from "@/components/ui/chat-message";

describe("chat message rendering contracts", () => {
  test("keeps user text clamped independently from image attachments", () => {
    const html = renderToStaticMarkup(
      <ChatMessage
        from="user"
        images={[
          {
            id: "image-1",
            data: "aW1hZ2U=",
            mimeType: "image/png",
            name: "diagram.png",
          },
        ]}
      >
        A long user prompt
      </ChatMessage>,
    );

    expect(html).toContain("line-clamp-3");
    expect(html).toContain("bg-[#26B25A]");
    expect(html).toContain("text-[#052E16]");
    expect(html).toContain("size-24 object-cover");
    expect(html.indexOf('aria-label="Open diagram.png"')).toBeLessThan(
      html.indexOf("A long user prompt"),
    );
  });

  test("does not clamp assistant responses", () => {
    const html = renderToStaticMarkup(
      <ChatMessage from="assistant">A complete assistant response</ChatMessage>,
    );

    expect(html).not.toContain("line-clamp-3");
    expect(html).toContain("A complete assistant response");
  });

  test("aligns user and assistant messages to the left", () => {
    const userHtml = renderToStaticMarkup(<ChatMessage from="user">A user message</ChatMessage>);
    const assistantHtml = renderToStaticMarkup(
      <ChatMessage from="assistant">An assistant message</ChatMessage>,
    );

    expect(userHtml).toContain("self-start");
    expect(userHtml).not.toContain("self-end");
    expect(assistantHtml).toContain("self-start");
  });

  test("keeps the assistant identity outside the message content column", () => {
    const html = renderToStaticMarkup(
      <ChatMessage from="assistant" identity={<span>Assistant identity</span>}>
        Message body
      </ChatMessage>,
    );

    expect(html).toContain('data-pipper-id="message-identity"');
    expect(html).toContain("flex h-9 shrink-0 items-center");
    expect(html.indexOf("Assistant identity")).toBeLessThan(html.indexOf("Message body"));
  });

  test("does not render an identity beside user message bubbles", () => {
    const html = renderToStaticMarkup(
      <ChatMessage from="user" identity={<span>User identity</span>}>
        Message body
      </ChatMessage>,
    );

    expect(html).not.toContain('data-pipper-id="message-identity"');
    expect(html).not.toContain("User identity");
    expect(html).toContain("line-clamp-3");
  });
});
