import { describe, expect, test } from "bun:test";
import type { InstallationMetadata } from "../contracts/updates.ts";
import {
  STALE_INSTALLATION_METADATA_ERROR,
  assertInstallationMetadataMatchesActive,
} from "./update-installation.ts";

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
});
