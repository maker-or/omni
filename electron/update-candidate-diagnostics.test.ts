import { describe, expect, test } from "bun:test";
import { dirtyFilesFromStatus } from "./update-candidate-diagnostics.ts";

describe("update candidate diagnostics", () => {
  test("parses git status short into dirty file paths", () => {
    expect(dirtyFilesFromStatus(" M src/App.tsx\n?? notes.md\nRM old.txt -> new.txt\n")).toEqual([
      "src/App.tsx",
      "notes.md",
      "new.txt",
    ]);
  });

  test("returns empty list for clean status", () => {
    expect(dirtyFilesFromStatus("")).toEqual([]);
    expect(dirtyFilesFromStatus("  \n")).toEqual([]);
  });
});
