import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AcpAgentDescriptor, SubagentRunSnapshot } from "../../contracts/acp.ts";
import { SubagentComposer } from "@/components/subagent-composer";
import { SubagentActivity } from "@/components/subagent-activity";

function agent(id: string, displayName: string, available = true): AcpAgentDescriptor {
  return { id, name: id, displayName, command: id, args: [], available };
}

const AGENTS = [
  agent("claude-agent-acp", "Claude"),
  agent("codex-acp", "Codex"),
  agent("gemini-acp", "Gemini", false),
];

/** The opening tag of the button whose label is "Start orchestration". */
function submitButtonTag(html: string): string {
  const labelIndex = html.indexOf("Start orchestration");
  expect(labelIndex).toBeGreaterThan(-1);
  const buttonIndex = html.lastIndexOf("<button", labelIndex);
  return html.slice(buttonIndex, html.indexOf(">", buttonIndex) + 1);
}

function runSnapshot(
  runId: string,
  status: SubagentRunSnapshot["status"],
  finishedAt: number | null = null,
): SubagentRunSnapshot {
  return {
    runId,
    parentSessionId: "parent",
    sessionId: `sub-${runId}`,
    agentId: "codex-acp",
    task: `task for ${runId}`,
    status,
    depth: 1,
    startedAt: 1,
    finishedAt,
    resultPreview: null,
  };
}

describe("SubagentComposer", () => {
  test("offers only installed agents as orchestrators and blocks submit until a goal exists", () => {
    const html = renderToStaticMarkup(
      <SubagentComposer
        agents={AGENTS}
        defaultOrchestratorId="codex-acp"
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain("Claude");
    expect(html).toContain("Codex");
    // Not installed → not offered.
    expect(html).not.toContain("Gemini");
    // Auto mode is the default, and an empty goal blocks submission.
    expect(html).toContain("The orchestrator decides how many subagents to spawn.");
    expect(html).toMatch(/What should the orchestrator achieve/);
    expect(submitButtonTag(html)).toContain('disabled=""');
  });

  test("a seeded goal (from “/subagent <text>”) makes the draft immediately submittable", () => {
    const html = renderToStaticMarkup(
      <SubagentComposer
        agents={AGENTS}
        defaultOrchestratorId={null}
        initialGoal="fix the login flow"
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain("fix the login flow");
    expect(html).not.toMatch(/Describe the goal/);
    expect(submitButtonTag(html)).not.toContain('disabled=""');
  });
});

describe("SubagentActivity", () => {
  test("renders nothing when there are no runs", () => {
    expect(
      renderToStaticMarkup(<SubagentActivity runs={[]} agents={AGENTS} activeSessionId="parent" />),
    ).toBe("");
  });

  test("shows every active run but only the most recent settled ones", () => {
    const runs = [
      runSnapshot("a1", "running"),
      runSnapshot("a2", "queued"),
      runSnapshot("s1", "finished", 10),
      runSnapshot("s2", "failed", 20),
      runSnapshot("s3", "cancelled", 30),
      runSnapshot("s4", "finished", 40),
    ];
    const html = renderToStaticMarkup(
      <SubagentActivity runs={runs} agents={AGENTS} activeSessionId="parent" />,
    );
    // Both active runs are visible…
    expect(html).toContain("task for a1");
    expect(html).toContain("task for a2");
    // …but only the 3 most recently settled, so the panel stays bounded.
    expect(html).toContain("task for s4");
    expect(html).toContain("task for s3");
    expect(html).toContain("task for s2");
    expect(html).not.toContain("task for s1");
    // Items show the agent's display name and expose status for styling/tests.
    expect(html).toContain("Codex");
    expect(html).toContain('data-status="running"');
  });

  test("scopes runs to the active thread's orchestrator session", () => {
    const mine = { ...runSnapshot("mine", "running"), parentSessionId: "thread-1" };
    const other = { ...runSnapshot("other", "running"), parentSessionId: "thread-2" };
    const html = renderToStaticMarkup(
      <SubagentActivity runs={[mine, other]} agents={AGENTS} activeSessionId="thread-1" />,
    );
    // Only the run spawned by the viewed thread shows; the other thread's
    // run does not leak in after switching threads.
    expect(html).toContain("task for mine");
    expect(html).not.toContain("task for other");
  });

  test("renders nothing when no thread session is active", () => {
    const runs = [runSnapshot("a1", "running")];
    expect(
      renderToStaticMarkup(<SubagentActivity runs={runs} agents={AGENTS} activeSessionId={null} />),
    ).toBe("");
  });
});
