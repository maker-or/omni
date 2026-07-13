import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  capturePipperEditBaseline,
  listPipperEditChangedFiles,
  revertPipperEditChanges,
} from "./pipper-edit-session";

const execFileAsync = promisify(execFile);

let repo: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repo });
  return String(stdout);
}

function write(file: string, contents: string): void {
  const path = join(repo, file);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "pipper-edit-session-"));
  await git("init", "-q");
  await git("config", "user.email", "test@pipper.dev");
  await git("config", "user.name", "Pipper Test");
  await git("config", "core.autocrlf", "false");
  write("app.tsx", "committed app\n");
  write("styles.css", "committed styles\n");
  await git("add", "-A");
  await git("commit", "-q", "-m", "base");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("edit-session change attribution (accept path)", () => {
  test("attributes only files the session changed, not pre-existing dirt or patch.md", async () => {
    // The workspace is already dirty before edit mode starts.
    write("styles.css", "user's own uncommitted tweak\n");
    write("scratch.txt", "user's untracked note\n");
    const baseline = await capturePipperEditBaseline(repo);

    // The edit-session agent changes one file, creates another, and the
    // accept flow itself writes patch.md.
    write("app.tsx", "agent edit\n");
    write("new-component.tsx", "agent created\n");
    write("patch.md", "{}\n");

    const changed = await listPipperEditChangedFiles(repo, baseline);
    expect(changed.sort()).toEqual(["app.tsx", "new-component.tsx"]);
  });

  test("reports nothing to accept once the session's files are committed", async () => {
    const baseline = await capturePipperEditBaseline(repo);
    write("app.tsx", "agent edit\n");
    expect(await listPipperEditChangedFiles(repo, baseline)).toEqual(["app.tsx"]);

    // Simulates the accept commit: afterwards a second accept finds nothing,
    // so accepting is effectively exactly-once.
    await git("add", "--", "app.tsx");
    await git("commit", "-q", "-m", "Pipper Visual Edit Accept");
    expect(await listPipperEditChangedFiles(repo, baseline)).toEqual([]);
  });

  test("detects a session change to a file that was already dirty at baseline", async () => {
    write("styles.css", "pre-session dirt\n");
    const baseline = await capturePipperEditBaseline(repo);
    write("styles.css", "agent changed it further\n");
    expect(await listPipperEditChangedFiles(repo, baseline)).toEqual(["styles.css"]);
  });
});

describe("edit-session revert (reject path)", () => {
  test("reject restores exactly the pre-edit state for session changes", async () => {
    // Pre-existing dirt the agent never touches.
    write("styles.css", "user's own uncommitted tweak\n");
    write("scratch.txt", "user's untracked note\n");
    const baseline = await capturePipperEditBaseline(repo);

    // The session modifies a tracked file, creates a file, deletes a tracked
    // file... then the user rejects.
    write("app.tsx", "agent edit\n");
    write("new-component.tsx", "agent created\n");

    const result = await revertPipperEditChanges(repo, baseline);

    // Session changes are fully reverted.
    expect(readFileSync(join(repo, "app.tsx"), "utf8")).toBe("committed app\n");
    expect(existsSync(join(repo, "new-component.tsx"))).toBe(false);
    // Pre-existing dirt survives untouched.
    expect(readFileSync(join(repo, "styles.css"), "utf8")).toBe("user's own uncommitted tweak\n");
    expect(readFileSync(join(repo, "scratch.txt"), "utf8")).toBe("user's untracked note\n");
    expect(result.reverted.sort()).toEqual(["app.tsx", "new-component.tsx"]);
    expect(result.kept).toEqual([]);

    // Nothing attributable to the session remains pending afterwards —
    // the state cannot stay stuck in "changes to review".
    expect(await listPipperEditChangedFiles(repo, baseline)).toEqual([]);
  });

  test("reject restores a tracked file the session deleted", async () => {
    const baseline = await capturePipperEditBaseline(repo);
    rmSync(join(repo, "app.tsx"));
    await revertPipperEditChanges(repo, baseline);
    expect(readFileSync(join(repo, "app.tsx"), "utf8")).toBe("committed app\n");
  });

  test("reject removes session-created files even if the session staged them", async () => {
    const baseline = await capturePipperEditBaseline(repo);
    write("new-component.tsx", "agent created and staged\n");
    await git("add", "--", "new-component.tsx");
    await revertPipperEditChanges(repo, baseline);
    expect(existsSync(join(repo, "new-component.tsx"))).toBe(false);
    expect((await git("status", "--porcelain")).trim()).toBe("");
  });

  test("reject keeps (not destroys) a pre-session untracked file the agent also modified", async () => {
    write("scratch.txt", "pre-session note\n");
    const baseline = await capturePipperEditBaseline(repo);
    write("scratch.txt", "agent appended\n");
    const result = await revertPipperEditChanges(repo, baseline);
    // Its pre-session content is unknown (only fingerprinted), so the safe
    // outcome is to keep the file rather than delete user data.
    expect(existsSync(join(repo, "scratch.txt"))).toBe(true);
    expect(result.kept).toEqual(["scratch.txt"]);
  });

  test("reject is a no-op when the session changed nothing", async () => {
    write("styles.css", "pre-session dirt\n");
    const baseline = await capturePipperEditBaseline(repo);
    const result = await revertPipperEditChanges(repo, baseline);
    expect(result.reverted).toEqual([]);
    expect(readFileSync(join(repo, "styles.css"), "utf8")).toBe("pre-session dirt\n");
  });
});
