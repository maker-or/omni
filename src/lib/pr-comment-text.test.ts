import { describe, expect, test } from "vitest";
import {
  commentPreview,
  commentTitle,
  commentToMarkdown,
  groupCommentsByAuthor,
  sortComments,
} from "./pr-comment-text";

const comment = (over: Partial<Parameters<typeof sortComments>[0][number]>) => ({
  id: "x",
  author: "a",
  avatarUrl: null,
  body: "",
  url: null,
  createdAt: "",
  path: null,
  line: null,
  ...over,
});

describe("commentToMarkdown", () => {
  test("folds bot html into markdown", () => {
    expect(
      commentToMarkdown(
        "<!-- auto --><h3>PR Summary</h3><details><summary>More</summary><code>x</code> and <b>y</b><br>z</details>",
      ),
    ).toBe("### PR Summary\n\n**More**\n`x` and **y**\nz");
  });

  test("leaves plain markdown alone", () => {
    expect(commentToMarkdown("## Head\n\n- item")).toBe("## Head\n\n- item");
  });
});

describe("commentPreview", () => {
  test("is a single stripped line, capped", () => {
    expect(commentPreview("<h3>PR Summary</h3>\n\n**Bold** `code` > quote")).toBe(
      "PR Summary Bold code quote",
    );
    expect(commentPreview("x".repeat(500))).toHaveLength(140);
  });
});

describe("commentTitle", () => {
  test("inline comments use path:line", () => {
    expect(commentTitle({ body: "fix", path: "src/a.ts", line: 7 })).toBe("src/a.ts:7");
  });

  test("uses the opening heading when present, else the first sentence", () => {
    expect(
      commentTitle({ body: "<h3>Intent Is Not Packaged</h3>The build…", path: null, line: null }),
    ).toBe("Intent Is Not Packaged");
    expect(
      commentTitle({ body: "The build compiles it. But never links it.", path: null, line: null }),
    ).toBe("The build compiles it.");
  });
});

describe("groupCommentsByAuthor / sortComments", () => {
  test("groups in first-seen order and sorts by time", () => {
    const list = [
      comment({ id: "1", author: "rabbit", createdAt: "2026-01-01T00:00:00Z" }),
      comment({ id: "2", author: "qodo", createdAt: "2026-01-02T00:00:00Z" }),
      comment({ id: "3", author: "rabbit", createdAt: "2026-01-03T00:00:00Z", avatarUrl: "u" }),
    ];
    const groups = groupCommentsByAuthor(list);
    expect(groups.map((g) => [g.author, g.comments.length, g.avatarUrl])).toEqual([
      ["rabbit", 2, "u"],
      ["qodo", 1, null],
    ]);
    expect(sortComments(groups[0]!.comments, "latest").map((c) => c.id)).toEqual(["3", "1"]);
    expect(sortComments(groups[0]!.comments, "oldest").map((c) => c.id)).toEqual(["1", "3"]);
  });
});
