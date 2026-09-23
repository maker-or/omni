import { describe, expect, test } from "vitest";
import { composeSkillPrompt, contextBlock, stripFrontmatter } from "./git-skills";

describe("stripFrontmatter", () => {
  test("removes a leading YAML block and trims", () => {
    expect(stripFrontmatter("---\nname: x\ndescription: y\n---\n\nBody here.\n")).toBe(
      "Body here.",
    );
  });

  test("leaves text without frontmatter alone", () => {
    expect(stripFrontmatter("Just prose.\n")).toBe("Just prose.");
  });

  test("does not treat a horizontal rule mid-document as frontmatter", () => {
    const text = "Intro\n\n---\n\nMore";
    expect(stripFrontmatter(text)).toBe(text);
  });
});

describe("contextBlock", () => {
  test("renders scalars and lists, skipping empty values", () => {
    const block = contextBlock({
      branch: "main",
      push: false,
      count: 3,
      missing: null,
      skipped: undefined,
      empty: [],
      files: ["a", "b"],
    });
    expect(block).toBe(
      [
        "```workspace-context",
        "branch: main",
        "push: false",
        "count: 3",
        "files:",
        "- a",
        "- b",
        "```",
      ].join("\n"),
    );
  });
});

describe("composeSkillPrompt", () => {
  test("orders task, common rules, scenario, then context, with no frontmatter", () => {
    const prompt = composeSkillPrompt({
      skill: "commit",
      task: "Do the thing.",
      context: contextBlock({ branch: "b" }),
    });
    const task = prompt.indexOf("Do the thing.");
    const common = prompt.indexOf("Never rewrite published history");
    const scenario = prompt.indexOf("Commit the current changes in this workspace");
    const context = prompt.indexOf("```workspace-context");
    expect(task).toBe(0);
    expect(common).toBeGreaterThan(task);
    expect(scenario).toBeGreaterThan(common);
    expect(context).toBeGreaterThan(scenario);
    expect(prompt).not.toContain("name: commit");
    expect(prompt).not.toContain("description:");
  });

  test("every scenario gets the shared rules", () => {
    for (const skill of ["commit", "address-review", "get-latest"] as const) {
      const prompt = composeSkillPrompt({ skill, task: "t", context: "" });
      expect(prompt, skill).toContain("--no-verify");
      expect(prompt, skill).toContain("plain-English report");
    }
  });
});
