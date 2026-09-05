import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, test } from "vitest";
import { Dropdown } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { splitFileMentionPath } from "./mention-popover";

describe("file mention presentation", () => {
  test("separates the filename from its full parent directory", () => {
    expect(splitFileMentionPath("src/store/agent-store.ts")).toEqual({
      fileName: "agent-store.ts",
      directory: "src/store",
    });
  });

  test("normalizes Windows separators", () => {
    expect(splitFileMentionPath("src\\store\\agent-store.ts")).toEqual({
      fileName: "agent-store.ts",
      directory: "src/store",
    });
  });

  test("labels root files with project root context", () => {
    expect(splitFileMentionPath("agent.ts")).toEqual({
      fileName: "agent.ts",
      directory: "project root",
    });
  });

  test("preserves a full path when trailing separators are present", () => {
    expect(splitFileMentionPath("src/store/agent-store.ts///")).toEqual({
      fileName: "agent-store.ts",
      directory: "src/store",
    });
  });

  test("renders filename and directory context separately while retaining the full label", () => {
    const html = renderToStaticMarkup(
      createElement(
        Dropdown,
        null,
        createElement(MenuItem, {
          label: "agent-store.ts",
          secondaryLabel: "src/store",
          index: 0,
          title: "src/store/agent-store.ts",
          "aria-label": "src/store/agent-store.ts",
        }),
      ),
    );

    expect(html).toContain("agent-store.ts");
    expect(html).toContain("src/store");
    expect(html).toContain('aria-label="src/store/agent-store.ts"');
    expect(html).toContain('title="src/store/agent-store.ts"');
  });
});
