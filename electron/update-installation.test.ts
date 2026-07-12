import { describe, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { fsyncSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstallationMetadata } from "../contracts/updates.ts";
import {
  STALE_INSTALLATION_METADATA_ERROR,
  assertInstallationMetadataMatchesActive,
  readAndValidateInstallationAgainstActive,
  readInstallationMetadata,
  writeInstallationMetadata,
} from "./update-installation.ts";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, fsyncSync: vi.fn(actual.fsyncSync) };
});

const installation: InstallationMetadata = {
  installed_version: "0.0.2",
  customized_head_commit: "active-head",
  last_healthy_at: "2026-06-23T00:00:00.000Z",
};

describe("installation metadata invariants", () => {
  test("accepts clean active HEAD matching persisted customization metadata", () => {
    expect(() =>
      assertInstallationMetadataMatchesActive(installation, "active-head"),
    ).not.toThrow();
  });

  test("reports stale metadata separately from mid-run active workspace changes", () => {
    expect(() => assertInstallationMetadataMatchesActive(installation, "different-head")).toThrow(
      STALE_INSTALLATION_METADATA_ERROR,
    );
  });

  test("repairs clean active HEAD without changing installed version", () => {
    const root = mkdtempSync(join(tmpdir(), "pipper-installation-"));
    try {
      const activePath = join(root, "active");
      const installationPath = join(root, "installation.json");
      execFileSync("git", ["init", activePath]);
      writeFileSync(join(activePath, "package.json"), '{"version":"9.9.9"}\n');
      execFileSync("git", ["add", "."], { cwd: activePath });
      execFileSync("git", ["commit", "-m", "init"], {
        cwd: activePath,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Pipper",
          GIT_AUTHOR_EMAIL: "pipper@internal",
          GIT_COMMITTER_NAME: "Pipper",
          GIT_COMMITTER_EMAIL: "pipper@internal",
        },
      });
      const head = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: activePath,
        encoding: "utf8",
      }).trim();
      writeInstallationMetadata(
        {
          installed_version: "0.1.0",
          customized_head_commit: "old",
          last_healthy_at: "2026-06-23T00:00:00.000Z",
        },
        installationPath,
      );

      const repaired = readAndValidateInstallationAgainstActive({
        repair: true,
        activePath,
        installationPath,
      });
      expect(repaired.customized_head_commit).toBe(head);
      expect(repaired.installed_version).toBe("0.1.0");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("writes installation metadata atomically, leaving no temp file behind", () => {
    const root = mkdtempSync(join(tmpdir(), "pipper-installation-atomic-"));
    try {
      const installationPath = join(root, "nested", "installation.json");
      writeInstallationMetadata(installation, installationPath);

      expect(readInstallationMetadata(installationPath)).toEqual(installation);
      const entries = readdirSync(join(root, "nested"));
      expect(entries.some((entry) => entry.endsWith(".tmp"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("leaves prior installation metadata intact when the write is interrupted before rename", () => {
    const root = mkdtempSync(join(tmpdir(), "pipper-installation-crash-"));
    try {
      const installationPath = join(root, "installation.json");
      writeInstallationMetadata(installation, installationPath);

      vi.mocked(fsyncSync).mockImplementationOnce(() => {
        throw new Error("simulated disk failure");
      });
      const next: InstallationMetadata = {
        installed_version: "9.9.9",
        customized_head_commit: "new-head",
        last_healthy_at: "2026-07-01T00:00:00.000Z",
      };
      expect(() => writeInstallationMetadata(next, installationPath)).toThrow(
        "simulated disk failure",
      );

      // The rename never happened, so readers still see the last complete write,
      // never a truncated or partially written file.
      expect(readInstallationMetadata(installationPath)).toEqual(installation);
      const entries = readdirSync(root);
      expect(entries.filter((entry) => entry.endsWith(".tmp"))).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
