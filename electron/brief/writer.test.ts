import { describe, expect, test, vi } from "vitest";
import {
  SUPPORTED_BRIEF_PROVIDERS,
  resolveBriefCandidateProviders,
} from "../../contracts/brief.ts";
import {
  AcpWriter,
  buildCandidateWriters,
  extractJson,
  firstSuccessful,
  type AcpPromptRunner,
  type WriterBackend,
} from "./writer.ts";

describe("ACP agent provider catalog", () => {
  test("every supported provider defines agentId, provider, and displayName", () => {
    const providers = Object.values(SUPPORTED_BRIEF_PROVIDERS);
    expect(providers.length).toBeGreaterThanOrEqual(9);
    for (const provider of providers) {
      expect(typeof provider.agentId).toBe("string");
      expect(typeof provider.provider).toBe("string");
      expect(typeof provider.displayName).toBe("string");
      expect(provider.agentId.length).toBeGreaterThan(0);
      expect(provider.displayName.length).toBeGreaterThan(0);
    }
  });

  test("resolveBriefCandidateProviders resolves user onboarding selections in order", () => {
    const selected = ["claude-agent-acp", "codex-acp"];
    const candidates = resolveBriefCandidateProviders(selected);
    expect(candidates).toEqual([
      {
        agentId: "claude-agent-acp",
        provider: "anthropic",
        displayName: "Claude",
      },
      {
        agentId: "codex-acp",
        provider: "openai",
        displayName: "Codex",
      },
    ]);
  });

  test("resolveBriefCandidateProviders falls back to all supported providers when none selected", () => {
    const candidates = resolveBriefCandidateProviders([]);
    expect(candidates.length).toBe(Object.keys(SUPPORTED_BRIEF_PROVIDERS).length);
  });
});

describe("AcpWriter", () => {
  test("invokes runner with agentId and parses focus output using default model", async () => {
    const calls: Array<{ agentId: string; promptText: string }> = [];
    const runner: AcpPromptRunner = async (opts) => {
      calls.push(opts);
      return JSON.stringify({
        focus: "Sam Rivera is an engineering lead working on omni and release pipelines.",
      });
    };

    const writer = new AcpWriter({
      agentId: "claude-agent-acp",
      displayName: "Claude",
      runner,
    });

    expect(writer.name).toBe("acp:Claude");
    const result = await writer.focus("digest input");
    expect(result.focus).toContain("Sam Rivera");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.agentId).toBe("claude-agent-acp");
  });

  test("extracts JSON even when wrapped in markdown code fences", async () => {
    const runner: AcpPromptRunner = async () => `
Here is the brief:
\`\`\`json
{
  "headline": "Ship v2 release today",
  "summary": "Focus on PR 42 first. Clear the blockers.",
  "items": [
    {
      "id": "gh:1",
      "title": "Merge PR 42",
      "why": "Blocks the entire release team.",
      "reply_draft": null
    }
  ],
  "push": {
    "id": "gh:1",
    "pitch": "Pipper can run tests and review diff.",
    "agent_prompt": "Run vitest on PR 42"
  },
  "agenda_notes": []
}
\`\`\`
Hope this helps!`;

    const writer = new AcpWriter({
      agentId: "gemini-acp",
      displayName: "Gemini",
      runner,
    });

    const written = await writer.write("input items");
    expect(written.headline).toBe("Ship v2 release today");
    expect(written.items).toHaveLength(1);
    expect(written.items[0]!.title).toBe("Merge PR 42");
    expect(written.push?.pitch).toContain("Pipper can run tests");
  });

  test("extractJson extracts raw JSON without fences", () => {
    const raw = 'Leading commentary {"focus":"Engineering lead"} trailing notes';
    expect(extractJson(raw)).toEqual({ focus: "Engineering lead" });
  });
});

describe("Provider cycling with firstSuccessful", () => {
  test("cycles through providers in sequence with default models until one succeeds", async () => {
    const attempts: string[] = [];

    const mockWriters: WriterBackend[] = [
      {
        name: "acp:Claude",
        async focus() {
          attempts.push("claude");
          throw new Error("503 Overloaded");
        },
        async write() {
          throw new Error("not used");
        },
      },
      {
        name: "acp:Codex",
        async focus() {
          attempts.push("codex");
          return { focus: "Codex inferred focus successfully." };
        },
        async write() {
          throw new Error("not used");
        },
      },
      {
        name: "acp:Gemini",
        async focus() {
          attempts.push("gemini");
          return { focus: "Should not be reached." };
        },
        async write() {
          throw new Error("not used");
        },
      },
    ];

    const result = await firstSuccessful(mockWriters, (w) => w.focus("test"));
    expect(result).not.toBeNull();
    expect(result!.backend).toBe("acp:Codex");
    expect(result!.value.focus).toBe("Codex inferred focus successfully.");
    expect(attempts).toEqual(["claude", "codex"]);
  });

  test("buildCandidateWriters wires candidate providers in user onboarding order", () => {
    const runner: AcpPromptRunner = vi.fn();
    const writers = buildCandidateWriters({
      selectedAgentIds: ["cursor-acp", "grok-acp"],
      runAcpPrompt: runner,
      anthropicApiKey: "test-key",
    });

    const names = writers.map((w) => w.name);
    expect(names).toEqual(["acp:Cursor", "acp:Grok", "anthropic"]);
  });
});
