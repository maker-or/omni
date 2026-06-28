# Launcher release runbook

1. Set `PIPPER_RELEASE_REPOSITORY` to the public GitHub release repository, for example `maker-or/pipper-code-releases`. Configure launcher builds and the marketing site with `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`.
2. Bump root `package.json.version`. Leave `pipper.workspaceVersion` unchanged for a launcher-only release. Never rebuild or republish an already published version.
3. Run `bun install`, `bun run fmt:check`, `bun run lint`, `bun run test`, and `bun run build`.
4. Remove stale local artifacts with `rm -rf release`, then run `bun run dist`. Require exactly `release/pipper-<version>-arm64.dmg`.
5. Open and smoke-test the DMG from a temporary install location. Confirm the launcher version, workspace version, projects, and `~/Library/pipper` data.
6. Run `bun run release:launcher:publish`. This creates GitHub release `v<version>`, uploads the versioned DMG and `latest.json`, marks the release latest, fetches the published manifest, downloads the public DMG, and verifies the SHA-256.
7. With the previous launcher version, check manually, download, verify diagnostics, select **Install and quit**, replace the app from the DMG, and reopen it. Confirm the new version clears pending state without changing personalized workspace state.
8. Confirm the marketing download page resolves to the same GitHub DMG.
9. If existing installed apps still read the old Vercel Blob manifest URL, set `BLOB_READ_WRITE_TOKEN` and run `bun run release:launcher:bridge` after the GitHub release succeeds. This uploads only `desktop/launcher/latest.json`; it does not upload the DMG to Blob.

If publication creates a partial GitHub release, inspect the assets and rerun `bun run release:launcher:publish -- --resume` only to upload missing assets. Never overwrite existing release assets. If a completed release is bad, fix forward with a higher patch version.
