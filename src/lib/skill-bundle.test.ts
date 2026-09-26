import { describe, expect, test } from "vitest";
import { getSkill, listSkills, parseSkill } from "./skill-bundle";

const skill = (name: string, body = "Do it.") =>
  `---\nname: ${name}\ndescription: A thing.\n---\n\n${body}\n`;

describe("parseSkill", () => {
  test("reads group, name, description and body", () => {
    expect(parseSkill("../../skills/git/commit.md", skill("commit"))).toEqual({
      id: "git/commit",
      group: "git",
      name: "commit",
      description: "A thing.",
      body: "Do it.",
      shared: false,
    });
  });

  test("an underscore file is its group's shared preamble", () => {
    expect(parseSkill("../../skills/git/_common.md", skill("common"))).toMatchObject({
      id: "git/common",
      shared: true,
    });
  });

  test("rejects a frontmatter name that disagrees with the file name", () => {
    // A copied file with a stale name would otherwise ship under the wrong id.
    expect(() => parseSkill("../../skills/git/rebase.md", skill("commit"))).toThrow(/rebase/);
  });

  test("rejects a missing description or empty body", () => {
    expect(() => parseSkill("../../skills/git/x.md", "---\nname: x\n---\nBody")).toThrow(
      /description/,
    );
    expect(() => parseSkill("../../skills/git/x.md", skill("x", ""))).toThrow(/empty/);
  });

  test("rejects files outside a group folder", () => {
    expect(() => parseSkill("../../skills/loose.md", skill("loose"))).toThrow(/<group>/);
  });
});

describe("bundle", () => {
  test("every shipped skill file parses", () => {
    // Loading the module already parsed them; this pins that the glob found files.
    expect(listSkills().length).toBeGreaterThan(0);
    for (const s of listSkills()) expect(s.body.length, s.id).toBeGreaterThan(0);
  });

  test("an unknown or shared id is not a standalone skill", () => {
    expect(() => getSkill("git/nope")).toThrow(/not bundled/);
    expect(() => getSkill("git/_common")).toThrow(/not bundled/);
  });
});
