# Launcher DMG distribution strategy: local builds + GitHub Releases

## Goal

Move launcher DMG distribution away from Vercel Blob because storage is exhausted, while keeping the current release process simple and low-risk:

- Build the macOS DMG locally on an Apple Silicon Mac.
- Upload the final DMG to GitHub Releases.
- Publish a small `latest.json` launcher manifest through GitHub Releases.
- Keep the app's existing launcher updater model: fetch manifest, download DMG, verify SHA-256, open DMG.
- Avoid changing application code for now.

## Short answer

This strategy is achievable and fits the current updater design well.

The application does not fundamentally depend on Vercel Blob. The current launcher updater only needs a public HTTPS manifest with this shape:

```json
{
  "schema_version": 1,
  "version": "0.0.16",
  "url": "https://github.com/<owner>/<repo>/releases/download/v0.0.16/pipper-0.0.16-arm64.dmg",
  "sha256": "<64-char-sha256>"
}
```

GitHub Releases can provide both:

1. the versioned `.dmg` asset
2. the `latest.json` manifest asset

So we can use GitHub Releases similarly to how Vercel Blob was used, but with local builds instead of CI builds.

## Proposed release model

```text
Local Apple Silicon Mac
  -> bun install
  -> bun run build
  -> bun run dist
  -> release/pipper-<version>-arm64.dmg
  -> compute sha256
  -> create latest.json
  -> create GitHub Release v<version>
  -> upload DMG + latest.json
  -> app downloads from GitHub Release
```

## Recommended GitHub release layout

For each launcher version, create a GitHub release tag:

```text
v0.0.16
```

Attach these assets:

```text
pipper-0.0.16-arm64.dmg
latest.json
```

The manifest should point to the versioned DMG URL, not a mutable URL:

```json
{
  "schema_version": 1,
  "version": "0.0.16",
  "url": "https://github.com/<owner>/<repo>/releases/download/v0.0.16/pipper-0.0.16-arm64.dmg",
  "sha256": "<sha256>"
}
```

The app's configured manifest URL for future builds should be:

```text
https://github.com/<owner>/<repo>/releases/latest/download/latest.json
```

That lets the app always fetch the manifest from the latest release.

## Local release steps

1. Bump root `package.json.version`.
2. Run validation locally:

```bash
bun install
bun run fmt:check
bun run lint
bun test
bun run build
```

3. Build the DMG:

```bash
rm -rf release
bun run dist
```

4. Confirm the artifact name:

```text
release/pipper-<version>-arm64.dmg
```

5. Compute SHA-256:

```bash
shasum -a 256 release/pipper-<version>-arm64.dmg
```

6. Create `latest.json` using the computed hash and GitHub release DMG URL.
7. Create GitHub release `v<version>`.
8. Upload:
   - `release/pipper-<version>-arm64.dmg`
   - `latest.json`
9. Download both assets from GitHub and verify:
   - manifest JSON is valid
   - DMG URL is public
   - SHA-256 matches
   - app can download and open the DMG

## GitHub CLI version of the publish step

After building locally:

```bash
VERSION=$(node -p "require('./package.json').version")
DMG="release/pipper-${VERSION}-arm64.dmg"
SHA=$(shasum -a 256 "$DMG" | awk '{print $1}')
URL="https://github.com/<owner>/<repo>/releases/download/v${VERSION}/pipper-${VERSION}-arm64.dmg"

cat > latest.json <<EOF
{
  "schema_version": 1,
  "version": "${VERSION}",
  "url": "${URL}",
  "sha256": "${SHA}"
}
EOF

gh release create "v${VERSION}" \
  "$DMG" \
  latest.json \
  --title "Pipper Code ${VERSION}" \
  --notes "Launcher release ${VERSION}" \
  --latest
```

## Important migration issue

Existing installed apps probably still have the old Vercel Blob manifest URL baked into them:

```text
https://<vercel-blob>/desktop/launcher/latest.json
```

Those apps will not automatically know about the GitHub manifest URL.

### Best bridge strategy

For the first GitHub-hosted release:

1. Build and upload the DMG to GitHub Releases.
2. Create a manifest where `url` points to the GitHub DMG.
3. Publish that same manifest to the old Vercel Blob `latest.json` path if possible.

That old Vercel manifest would be tiny, so it avoids DMG storage pressure while still redirecting existing apps to GitHub-hosted downloads.

Bridge manifest example:

```json
{
  "schema_version": 1,
  "version": "0.0.16",
  "url": "https://github.com/<owner>/<repo>/releases/download/v0.0.16/pipper-0.0.16-arm64.dmg",
  "sha256": "<sha256>"
}
```

After users install this bridge version, future launcher builds can point directly to:

```text
https://github.com/<owner>/<repo>/releases/latest/download/latest.json
```

### If Vercel Blob cannot be written at all

Then existing installed apps cannot be redirected automatically through the old update channel. In that case, users must manually download and install the GitHub-hosted DMG once. After that, future updates can use GitHub Releases.

## Public vs private GitHub releases

The release assets must be publicly downloadable by the app.

If the main repository is private, GitHub release assets may require authentication and will not work for installed apps.

Recommended options:

1. Use a public repository for release artifacts, e.g.:

```text
<owner>/pipper-code-releases
```

2. Keep source private, but manually upload public DMGs/manifests to the release repo.
3. Configure future app builds to use the public release repo manifest URL.

## Compatibility with the current app

The current launcher updater already supports this model because it:

- fetches a configured manifest URL
- validates exact manifest fields
- requires HTTPS
- requires `.dmg` URL path
- downloads with redirects enabled
- verifies SHA-256 before marking the installer as downloaded

GitHub release asset URLs should satisfy the current validation:

```text
https://github.com/<owner>/<repo>/releases/download/v0.0.16/pipper-0.0.16-arm64.dmg
```

GitHub may redirect the actual download to `release-assets.githubusercontent.com`, but the updater follows redirects and verifies the final file by SHA-256.

## Operational rules

- Never overwrite a published version.
- Never reuse a version after a failed release.
- If a release is bad, publish a higher patch version.
- Keep release assets immutable.
- Do not mark launcher releases as GitHub prereleases if relying on `/releases/latest/download/latest.json`.
- Always verify the downloaded DMG hash from GitHub before announcing the release.
- Keep local build machine consistent: Apple Silicon macOS, same Bun lockfile, clean working tree.

## Pros

- Removes large DMG storage from Vercel Blob.
- No CI complexity required immediately.
- Keeps current local smoke-test workflow.
- GitHub Releases provide versioned artifacts and a stable latest pointer.
- Current app updater model remains valid.
- SHA-256 verification protects against corrupted downloads.

## Cons / risks

| Risk | Mitigation |
| --- | --- |
| Existing apps still point at Vercel manifest | Publish one tiny bridge manifest to old Vercel path if possible |
| Private GitHub release assets require auth | Use a public release-only repo |
| `/latest` ignores prereleases | Use normal releases, not prereleases |
| Manual local publishing can make mistakes | Use a small publish script or checklist |
| Reusing a version can break update semantics | Enforce one version per release |
| GitHub outage affects downloads | Acceptable for alpha; add mirror later if needed |

## Recommended final plan

1. Continue building DMGs locally.
2. Use GitHub Releases as the artifact host.
3. Store both `pipper-<version>-arm64.dmg` and `latest.json` on each release.
4. Point future builds to:

```text
https://github.com/<owner>/<repo>/releases/latest/download/latest.json
```

5. For migration, publish a tiny Vercel Blob bridge `latest.json` pointing to the GitHub DMG, if Blob writes are still possible.
6. If the old manifest cannot be updated, manually ask existing users to install the first GitHub-hosted build.

## Verdict

This is a good strategy. It is simpler than a full CI build pipeline, avoids Vercel Blob storage pressure, and works with the current launcher updater architecture. The only major migration concern is redirecting existing installed apps away from the old Vercel manifest URL.
