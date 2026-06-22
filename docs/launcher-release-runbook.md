# Launcher release runbook

1. Set `BLOB_READ_WRITE_TOKEN`, `VITE_PIPPER_LAUNCHER_UPDATE_MANIFEST_URL`, and the marketing site's `PUBLIC_PIPPER_LAUNCHER_UPDATE_MANIFEST_URL`. Never commit the token.
2. Bump root `package.json.version`. Leave `pipper.workspaceVersion` unchanged for a launcher-only release. Rebuilding an already published version is forbidden.
3. Run `bun install`, `bun run fmt:check`, `bun run lint`, `bun test`, and `bun run build`.
4. Remove stale local artifacts with `rm -rf release`, then run `bun run dist`. Require exactly `release/pipper-<version>-arm64.dmg`.
5. Open and smoke-test the DMG from a temporary install location. Confirm the launcher version, workspace version, projects, and `~/Library/pipper` data.
6. Run `bun run release:launcher:publish`. Independently fetch the printed manifest and artifact URLs and verify the version, URL, SHA-256, HTTP response, and size.
7. With the previous launcher version, check manually, download, verify diagnostics, select **Install and quit**, replace the app from the DMG, and reopen it. Confirm the new version clears pending state without changing personalized workspace state.
8. Confirm the marketing download page resolves to the same DMG.
9. Only after the full smoke test succeeds, run `bun run release:launcher:prune`. Confirm `desktop/launcher/` retains only `latest.json` and the current DMG.

If publication fails after the DMG upload but before the manifest update, inspect the blob and repair with a higher patch version. Never overwrite or downgrade a published launcher version.
