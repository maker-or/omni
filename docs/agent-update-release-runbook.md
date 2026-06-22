# Agent update release

The permanent update endpoint is:

```text
https://pipper.dev/api/agent-update.json
```

It is served by `marketing/src/pages/api/agent-update.json.ts`. The endpoint returns `204 No
Content` while `marketing/src/data/agent-update.json` is `null`, so no update is offered.

After merging a feature pull request:

1. Switch to `main` and pull the merge.
2. Run `gh pr diff <number> --name-only` to collect the feature PR's changed files.
3. Replace `marketing/src/data/agent-update.json` with the release manifest:

   ```json
   {
     "schema_version": 1,
     "version": "0.0.1",
     "description": "Adds the new feature.",
     "pr_url": "https://github.com/maker-or/omni/pull/123",
     "files_changes": ["src/App.tsx"]
   }
   ```

4. Ensure `version` is newer than the installed workspace version, not merely the launcher/DMG
   version.
5. Commit and push the manifest change to `main` so Vercel deploys it.
6. Verify the production response:

   ```bash
   curl -i https://pipper.dev/api/agent-update.json
   ```

The endpoint URL and upstream repository have production defaults in Electron. Environment
variables remain available only as development or emergency overrides. Publishing an agent update
does not require changing a Vercel environment variable or uploading a DMG.
