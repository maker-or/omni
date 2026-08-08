import { describe, expect, test } from "vitest";
import {
  assertCreatable,
  allowedMentionKinds,
  blankContent,
  buildContent,
  extractAgentId,
  extractModelId,
  extractProjectId,
  extractTextContent,
  findActiveMention,
  isMentionSlotFilled,
  mentionPlaceholderHint,
  normalizeContent,
  queryLooksLikeFilePath,
  removeEntityKind,
  removeMentionFromText,
  resolveDefaultMentionKind,
  serialize,
  setFreeText,
  stripEntityKinds,
  titleFromText,
  unfilledMentionKinds,
  upsertEntity,
} from "./composer-tokens";

describe("composer-tokens", () => {
  test("blank content is a single empty text token", () => {
    expect(blankContent()).toEqual([{ kind: "text", text: "" }]);
  });

  test("normalize merges adjacent text and ensures trailing text", () => {
    const normalized = normalizeContent([
      { kind: "text", text: "a" },
      { kind: "text", text: "b" },
      { kind: "project", id: "p1", label: "Omni" },
    ]);
    expect(normalized).toEqual([
      { kind: "text", text: "ab" },
      { kind: "project", id: "p1", label: "Omni" },
      { kind: "text", text: "" },
    ]);
  });

  test("extractTextContent strips entity chips", () => {
    const content = buildContent(
      [
        { kind: "project", id: "p1", label: "Omni" },
        { kind: "agent", id: "claude", label: "Claude" },
      ],
      " fix the bug ",
    );
    expect(extractTextContent(content)).toBe("fix the bug");
    expect(serialize(content)).toBe("OmniClaude fix the bug");
  });

  test("extract ids use last-wins", () => {
    const content = [
      { kind: "project" as const, id: "p1", label: "A" },
      { kind: "project" as const, id: "p2", label: "B" },
      { kind: "agent" as const, id: "a1", label: "Agent" },
      { kind: "model" as const, id: "m1", label: "Model" },
      { kind: "text" as const, text: "hi" },
    ];
    expect(extractProjectId(content)).toBe("p2");
    expect(extractAgentId(content)).toBe("a1");
    expect(extractModelId(content)).toBe("m1");
  });

  test("findActiveMention detects @query at caret", () => {
    const text = "hello @cla";
    expect(findActiveMention(text, text.length)).toEqual({
      atIndex: 6,
      query: "cla",
      raw: "@cla",
    });
    expect(findActiveMention(text, 5)).toBeNull();
    expect(findActiveMention("hello @cla more", 10)).toEqual({
      atIndex: 6,
      query: "cla",
      raw: "@cla",
    });
  });

  test("removeMentionFromText strips the raw match", () => {
    const text = "hi @omni there";
    const mention = findActiveMention(text, 8);
    expect(mention).not.toBeNull();
    expect(removeMentionFromText(text, mention!)).toBe("hi  there");
  });

  test("upsertEntity replaces same kind", () => {
    let content = buildContent([{ kind: "project", id: "p1", label: "A" }], "x");
    content = upsertEntity(content, { kind: "project", id: "p2", label: "B" });
    expect(extractProjectId(content)).toBe("p2");
    expect(extractTextContent(content)).toBe("x");
  });

  test("removeEntityKind keeps free text", () => {
    const content = removeEntityKind(
      buildContent(
        [
          { kind: "project", id: "p1", label: "A" },
          { kind: "agent", id: "a1", label: "Claude" },
        ],
        "task",
      ),
      "project",
    );
    expect(extractProjectId(content)).toBeNull();
    expect(extractAgentId(content)).toBe("a1");
    expect(getFreeTextSafe(content)).toBe("task");
  });

  test("setFreeText preserves entities", () => {
    const content = setFreeText(
      buildContent([{ kind: "agent", id: "a1", label: "Claude" }], "old"),
      "new",
    );
    expect(extractAgentId(content)).toBe("a1");
    expect(extractTextContent(content)).toBe("new");
  });

  test("stripEntityKinds for mid-thread model send", () => {
    const content = buildContent(
      [{ kind: "model", id: "m1", label: "Sonnet" }],
      " continue please ",
    );
    const stripped = stripEntityKinds(content, ["model"]);
    expect(extractModelId(stripped)).toBeNull();
    expect(extractTextContent(stripped)).toBe("continue please");
  });

  test("assertCreatable enforces project, agent, and text", () => {
    expect(assertCreatable(blankContent()).ok).toBe(false);
    expect(
      assertCreatable(buildContent([{ kind: "project", id: "p1", label: "P" }], "hi")).ok,
    ).toBe(false);
    const ok = assertCreatable(
      buildContent(
        [
          { kind: "project", id: "p1", label: "P" },
          { kind: "agent", id: "a1", label: "Claude" },
        ],
        "hi",
      ),
    );
    expect(ok).toEqual({
      ok: true,
      projectId: "p1",
      agentId: "a1",
      modelId: null,
      text: "hi",
    });
  });

  test("allowedMentionKinds differ by mode", () => {
    expect(allowedMentionKinds("draft")).toEqual(["project", "agent", "model", "file"]);
    expect(allowedMentionKinds("live")).toEqual(["model", "file"]);
    expect(allowedMentionKinds("live", { filesAvailable: false })).toEqual(["model"]);
  });

  test("smart @ cascade for draft: project → agent → model → file", () => {
    const empty = blankContent();
    expect(resolveDefaultMentionKind({ mode: "draft", content: empty })).toBe("project");

    const withProject = buildContent([{ kind: "project", id: "p1", label: "Omni" }], "");
    expect(isMentionSlotFilled("project", withProject, "draft")).toBe(true);
    expect(resolveDefaultMentionKind({ mode: "draft", content: withProject })).toBe("agent");

    const withAgent = upsertEntity(withProject, { kind: "agent", id: "a1", label: "Claude" });
    expect(resolveDefaultMentionKind({ mode: "draft", content: withAgent })).toBe("model");

    const withModel = upsertEntity(withAgent, { kind: "model", id: "m1", label: "Sonnet" });
    expect(unfilledMentionKinds({ mode: "draft", content: withModel })).toEqual(["file"]);
    expect(resolveDefaultMentionKind({ mode: "draft", content: withModel })).toBe("file");
  });

  test("smart @ cascade for live: model then file", () => {
    const empty = blankContent();
    expect(resolveDefaultMentionKind({ mode: "live", content: empty })).toBe("model");
    expect(isMentionSlotFilled("project", empty, "live")).toBe(true);

    const withModel = buildContent([{ kind: "model", id: "m1", label: "Sonnet" }], "hi");
    expect(resolveDefaultMentionKind({ mode: "live", content: withModel })).toBe("file");
  });

  test("skips empty model catalog so draft opens agent after project", () => {
    const withProject = buildContent([{ kind: "project", id: "p1", label: "Omni" }], "");
    expect(
      resolveDefaultMentionKind({
        mode: "draft",
        content: withProject,
        availability: { project: 3, agent: 2, model: 0, file: 10 },
      }),
    ).toBe("agent");

    const withAgent = upsertEntity(withProject, { kind: "agent", id: "a1", label: "Claude" });
    // Agent filled, model empty → fall through to file
    expect(
      resolveDefaultMentionKind({
        mode: "draft",
        content: withAgent,
        availability: { project: 3, agent: 2, model: 0, file: 10 },
      }),
    ).toBe("file");
  });

  test("path-like query forces file kind", () => {
    expect(queryLooksLikeFilePath("src/app")).toBe(true);
    expect(queryLooksLikeFilePath("foo.ts")).toBe(true);
    expect(queryLooksLikeFilePath("claude")).toBe(false);
    const withProject = buildContent([{ kind: "project", id: "p1", label: "P" }], "");
    expect(
      resolveDefaultMentionKind({
        mode: "draft",
        content: withProject,
        query: "src/lib",
      }),
    ).toBe("file");
  });

  test("mentionPlaceholderHint follows next unfilled slot", () => {
    expect(mentionPlaceholderHint("draft", blankContent())).toContain("project");
    expect(
      mentionPlaceholderHint(
        "draft",
        buildContent([{ kind: "project", id: "p1", label: "P" }], ""),
      ),
    ).toContain("agent");
  });

  test("titleFromText truncates", () => {
    expect(titleFromText("short")).toBe("short");
    expect(titleFromText("x".repeat(60)).endsWith("…")).toBe(true);
  });
});

function getFreeTextSafe(content: ReturnType<typeof buildContent>): string {
  return content
    .filter((t) => t.kind === "text")
    .map((t) => t.text)
    .join("");
}
