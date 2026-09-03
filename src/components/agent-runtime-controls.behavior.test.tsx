import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AgentRuntimeControls } from "./agent-runtime-controls";

describe("agent runtime controls", () => {
  test("keeps the active model and reasoning level in the composer controls", () => {
    const html = renderToStaticMarkup(
      <AgentRuntimeControls
        reasoningLevels={[
          { value: "low", name: "Low" },
          { value: "high", name: "High" },
        ]}
        currentReasoningIndex={1}
        currentReasoningLabel="high"
        modelName="Luna 5.6"
        onReasoningChange={() => undefined}
      />,
    );

    expect(html).toContain("Luna 5.6");
    expect(html).toContain("High");
    expect(html).toContain('data-pipper-id="reasoning-slider-toggle"');
    expect(html).not.toContain('data-pipper-id="reasoning-slider"');
  });

  test("turns the active model label into a picker when models are available", () => {
    const html = renderToStaticMarkup(
      <AgentRuntimeControls
        reasoningLevels={[]}
        currentReasoningIndex={0}
        modelName="Luna 5.6"
        modelId="luna-5.6"
        modelItems={[{ id: "luna-5.6", label: "Luna 5.6" }]}
        onModelChange={() => undefined}
        onReasoningChange={() => undefined}
      />,
    );

    expect(html).toContain('data-pipper-id="runtime-model-picker"');
    expect(html).toContain('aria-label="Change model, currently Luna 5.6"');
  });

  test("renders the context window ring before the model picker", () => {
    const html = renderToStaticMarkup(
      <AgentRuntimeControls
        reasoningLevels={[]}
        currentReasoningIndex={0}
        modelName="Luna 5.6"
        modelId="luna-5.6"
        contextUsage={{
          tokens: 500,
          contextWindow: 1000,
          percent: 50,
        }}
        modelItems={[{ id: "luna-5.6", label: "Luna 5.6" }]}
        onModelChange={() => undefined}
        onReasoningChange={() => undefined}
      />,
    );

    const ringIndex = html.indexOf('data-pipper-id="context-window-ring"');
    const pickerIndex = html.indexOf('data-pipper-id="runtime-model-picker"');
    expect(ringIndex).toBeGreaterThan(-1);
    expect(pickerIndex).toBeGreaterThan(-1);
    expect(ringIndex).toBeLessThan(pickerIndex);
  });

  test("does not render the stop button in idle mode", () => {
    const html = renderToStaticMarkup(
      <AgentRuntimeControls
        reasoningLevels={[]}
        currentReasoningIndex={0}
        modelName="Luna 5.6"
        isStreaming={false}
        onStop={() => undefined}
        onReasoningChange={() => undefined}
      />,
    );

    expect(html).not.toContain('data-pipper-id="runtime-stop-button"');
    expect(html).not.toContain("Stop response");
  });

  test("renders the stop button only while streaming and handles stopping state", () => {
    const streamingHtml = renderToStaticMarkup(
      <AgentRuntimeControls
        reasoningLevels={[]}
        currentReasoningIndex={0}
        modelName="Luna 5.6"
        isStreaming
        onStop={() => undefined}
        onReasoningChange={() => undefined}
      />,
    );

    const streamingButton =
      streamingHtml.match(/<button[^>]*data-pipper-id="runtime-stop-button"[^>]*>/)?.[0] ?? "";
    expect(streamingButton).not.toContain('disabled=""');
    expect(streamingHtml).toContain('aria-label="Stop response"');
    expect(streamingHtml).not.toContain("<span>Stop</span>");

    const stoppingHtml = renderToStaticMarkup(
      <AgentRuntimeControls
        reasoningLevels={[]}
        currentReasoningIndex={0}
        modelName="Luna 5.6"
        isStreaming
        isStopping
        onStop={() => undefined}
        onReasoningChange={() => undefined}
      />,
    );

    expect(stoppingHtml).toContain('data-pipper-id="runtime-stop-button"');
    expect(stoppingHtml).toContain('aria-label="Stopping response"');
    expect(stoppingHtml).not.toContain("<span>Stopping…</span>");
    const stoppingButton =
      stoppingHtml.match(/<button[^>]*data-pipper-id="runtime-stop-button"[^>]*>/)?.[0] ?? "";
    expect(stoppingButton).toContain('disabled=""');
  });
});
