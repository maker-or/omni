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
});
