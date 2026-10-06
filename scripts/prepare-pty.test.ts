import { afterEach, describe, expect, test } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { preparePtyHelpers } from "./prepare-pty.mjs";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pipper-pty-"));
  directories.push(root);
  const helper = join(root, "prebuilds/darwin-arm64/spawn-helper");
  mkdirSync(dirname(helper), { recursive: true });
  writeFileSync(helper, "#!/bin/sh\nexit 0\n");
  chmodSync(helper, 0o644);
  return { root, helper };
}

describe.skipIf(process.platform === "win32")("PTY launch helper permissions", () => {
  test("repairs cached macOS helpers that have lost executable permission", () => {
    const { root, helper } = fixture();
    preparePtyHelpers(root, "darwin");
    expect(statSync(helper).mode & 0o777).toBe(0o755);
    preparePtyHelpers(root, "darwin");
    expect(statSync(helper).mode & 0o777).toBe(0o755);
  });

  test("does not change helpers on other platforms", () => {
    const { root, helper } = fixture();
    preparePtyHelpers(root, "linux");
    expect(statSync(helper).mode & 0o777).toBe(0o644);
  });
});
