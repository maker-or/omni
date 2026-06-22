# Pipper Self-Update MVP Implementation Plan

## 1. Objective

Build an agent-assisted update system that:

- Detects an available upstream Pipper update.
- Presents it to the user.
- Lets the user choose “Update when I quit” or “Later.”
- Applies the upstream PR to a temporary candidate workspace.
- Preserves all user customizations.
- Validates the candidate.
- Promotes it atomically to `active/`.
- Retains the previous working installation for rollback.
- Never allows the agent to modify launcher/updater code.

The core rule is:

> Official updates are retrieved from an upstream PR. The update agent ports that change onto the user’s customized application in an isolated candidate directory.

---

# 2. Existing architecture

The managed workspace currently lives under:

```text
~/Library/pipper/
├── active/
├── backup/
└── shared/
    └── node_modules/
```

Current behavior:

- `active/` contains the customized application.
- `backup/` is used by Edit Mode for accepting/rejecting changes.
- `shared/node_modules/` is symlinked into both workspaces.
- The editor agent operates on `active/`.
- Accepted edits are committed and copied to `backup/`.
- Rejected edits run `git reset --hard HEAD && git clean -fd`.
- The launcher and Electron main-process code are excluded from managed application copies.

Relevant code:

- [workspace-manager.ts](/Users/harshithpasupuleti/code/omni/electron/workspace-manager.ts)
- [main.ts](/Users/harshithpasupuleti/code/omni/electron/main.ts)
- [agent.ts](/Users/harshithpasupuleti/code/omni/electron/agent.ts)
- [preload.ts](/Users/harshithpasupuleti/code/omni/electron/preload.ts)
- [companion-view.tsx](/Users/harshithpasupuleti/code/omni/src/components/companion-view.tsx)
- [launch app.tsx](/Users/harshithpasupuleti/code/omni/src/launch/app.tsx)

---

# 3. Required workspace model

Extend the layout:

```text
~/Library/pipper/
├── active/                 # Current accepted application
├── backup/                 # Last known-good application
├── candidate/              # Update working directory
├── previous/               # Temporary promotion/rollback directory
├── shared/
│   ├── active-deps/
│   └── candidate-deps/
├── updates/
│   ├── manifest.json
│   ├── state.json
│   └── logs/
└── untracked_backup/
```

Directory responsibilities:

| Directory                | Purpose                              |    Agent writable |
| ------------------------ | ------------------------------------ | ----------------: |
| `active/`                | Currently running customized app     | Editor agent only |
| `backup/`                | Last known-good recovery copy        |                No |
| `candidate/`             | Proposed updated customized app      | Update agent only |
| `previous/`              | Temporary directory during promotion |                No |
| `shared/active-deps/`    | Dependencies used by active          |  No during update |
| `shared/candidate-deps/` | Candidate dependencies               |    Installer only |
| `updates/`               | Update state, diagnostics and logs   |      Updater only |

The update agent must never work in `active/` or `backup/`.

---

# 4. Update manifest

For the MVP, host a JSON document on the website:

```json
{
  "schema_version": 1,
  "version": "0.2.0",
  "description": "Adds thread search and fixes terminal reconnection.",
  "pr_url": "https://github.com/company/pipper/pull/123",
  "files_changes": ["src/App.tsx", "package.json"]
}
```

Required validation:

- Reject unsupported `schema_version`.
- Validate version format.
- Require HTTPS URLs.
- Reject a manifest older than or equal to the installed version.
- Require `pr_url` to identify a pull request in that repository.
- Require `files_changes` to contain safe, unique repository-relative paths.
- Resolve the pull request head when the update begins and verify that it descends from the
  previously applied upstream history.

For the MVP, signature verification can be deferred, but manifest parsing must still be strict.

---

# 5. Installed-version metadata

Create:

```text
~/Library/pipper/installation.json
```

Example:

```json
{
  "installed_version": "0.1.0",
  "customized_head_commit": "def456...",
  "last_healthy_at": "2026-06-19T10:00:00Z"
}
```

This file is launcher-controlled.

The updater uses local Git history only to understand accepted edit-mode changes. It downloads the
upstream pull-request diff directly, so the two repositories do not need shared ancestry.

Do not derive the installed version from `package.json`; users may edit it.

---

# 6. Git model

The active managed workspace must maintain meaningful Git history.

Recommended commit categories:

```text
Initial official baseline
User customization
User customization
User customization
```

For an update, the agent receives:

```text
current candidate workspace and local Git history
pull-request diff
declared changed-file list and full upstream file contents
patch.md
PR URL
```

After a successful update, the candidate history should contain:

```text
Previous customized history
Agent-assisted update to upstream version 0.2.0
```

Then update `installation.json`:

```json
{
  "installed_version": "0.2.0",
  "customized_head_commit": "<candidate HEAD>",
  "last_healthy_at": "<timestamp>"
}
```

The resolved pull-request head is stored only in the private Git ref after successful validation.

---

# 7. Correct `patch.md` behavior

`patch.md` is agent context, not the source of truth.

Use:

- Git for exact changes.
- `patch.md` for the intention behind customizations.

The current workspace copy logic excludes every Markdown file. That means `patch.md` is currently excluded from backup and workspace copying. This must be fixed.

In [workspace-manager.ts](/Users/harshithpasupuleti/code/omni/electron/workspace-manager.ts), remove blanket exclusions such as:

```ts
if (src.toLowerCase().endsWith(".md")) return;
```

Replace them with an explicit exclusion list. `patch.md` must be preserved.

Also fix the accepted-edit transaction. The current companion prompt:

1. Commits changes.
2. Updates `patch.md` afterward.

That leaves the new `patch.md` entry outside the commit it describes. Change it to:

1. Determine changed files.
2. Add the `patch.md` entry.
3. Stage source changes and `patch.md`.
4. Create one commit.
5. Record the resulting commit hash through a follow-up metadata mechanism if required.

Because a commit cannot contain its own hash, the JSON entry should use one of these designs:

```json
{
  "change_id": "uuid",
  "files_changed": [],
  "intent": ""
}
```

Or accept that `patch.md` is updated in a separate metadata commit. Do not ask the agent to place a commit’s hash inside that same commit.

For the MVP, use `change_id`, not `commit_hash`.

---

# 8. Update state machine

Create [update-manager.ts](/Users/harshithpasupuleti/code/omni/electron/update-manager.ts).

Use explicit states:

```ts
type UpdatePhase =
  | "idle"
  | "available"
  | "scheduled"
  | "preparing"
  | "fetching-upstream"
  | "agent-running"
  | "installing-dependencies"
  | "validating"
  | "ready-to-promote"
  | "promoting"
  | "awaiting-health-check"
  | "completed"
  | "failed"
  | "rolling-back";
```

Persist state to:

```text
~/Library/pipper/updates/state.json
```

Example:

```json
{
  "phase": "agent-running",
  "from_version": "0.1.0",
  "to_version": "0.2.0",
  "manifest": {},
  "started_at": "2026-06-19T10:00:00Z",
  "scheduled_for_quit": true,
  "candidate_path": ".../candidate",
  "previous_path": ".../previous",
  "error": null
}
```

Every phase transition must be written atomically:

1. Write `state.json.tmp`.
2. Flush/close.
3. Rename to `state.json`.

This enables crash recovery.

---

# 9. Update discovery

Add a periodic update checker to the launcher/main process.

Configuration:

```ts
const UPDATE_MANIFEST_URL =
  process.env.PIPPER_UPDATE_MANIFEST_URL ?? import.meta.env.VITE_PIPPER_UPDATE_MANIFEST_URL;
```

Check:

- At startup after workspace initialization.
- Every 4–6 hours while running.
- When the user manually requests “Check for updates.”
- Before quit if the last check is stale.

Do not block normal application startup on network failure.

Expose IPC:

```ts
update.check();
update.getState();
update.scheduleForQuit();
update.startNow();
update.dismiss();
update.cancel();
update.onStateChanged();
update.onProgress();
```

Add corresponding contracts in:

```text
contracts/updates.ts
```

Expose them through [preload.ts](/Users/harshithpasupuleti/code/omni/electron/preload.ts) and [electron.d.ts](/Users/harshithpasupuleti/code/omni/src/electron.d.ts).

---

# 10. User experience

Show an update indicator during normal use.

When selected, display:

```text
Pipper 0.2.0 is available

Adds thread search and fixes terminal reconnection.

[Later] [Update when I quit]
```

Recommended behavior:

- `Later`: dismiss for this session.
- `Update when I quit`: persist scheduling state.
- On Command-Q, tell the user to leave Pipper open and not close the laptop while updating.
- Explain that Pipper will quit automatically after the update finishes.

During update, show a dedicated non-editable progress screen:

```text
Preparing your personalized update…

✓ Preserved your current version
✓ Downloaded upstream changes
● Adapting update to your customizations
○ Installing dependencies
○ Validating application
```

Required controls:

- “Cancel update and keep current version”
- “Show details”
- “Quit without updating” when invoked during quit

Do not expose raw chain-of-thought. Show tool/status summaries and logs.

---

# 11. Command-Q integration

Add a guarded quit coordinator in [main.ts](/Users/harshithpasupuleti/code/omni/electron/main.ts).

Pseudo-logic:

```ts
let quitAuthorized = false;
let updateQuitInProgress = false;

app.on("before-quit", async (event) => {
  if (quitAuthorized) return;

  const update = updateManager.getState();

  if (!update.scheduledForQuit) return;

  event.preventDefault();

  if (updateQuitInProgress) return;
  updateQuitInProgress = true;

  showUpdateWindow();

  const result = await updateManager.run();

  if (result.success) {
    quitAuthorized = true;
    app.quit();
  } else {
    updateQuitInProgress = false;
    showUpdateFailure();
  }
});
```

The user must retain a way to cancel the update and complete the quit.

Before starting:

- Abort or wait for active agent streams.
- Close the companion edit session safely.
- Ensure no accepted changes remain uncommitted.
- Stop terminal sessions that write into the managed application.
- Stop the dev server/file watcher if it targets `active/`.

---

# 12. Candidate creation

Add these functions to the workspace layer:

```ts
getCandidatePath();
getPreviousPath();
getUpdateStatePath();
createCandidateFromActive();
removeCandidate();
prepareCandidateDependencies();
promoteCandidate();
rollbackPromotion();
recoverInterruptedPromotion();
```

`createCandidateFromActive()` must:

1. Delete any stale candidate after checking update state.
2. Copy `active/` to `candidate/`.
3. Preserve `.git`.
4. Preserve Markdown files, especially `patch.md`.
5. Exclude:
   - `node_modules`
   - `out`
   - `dist`
   - runtime logs
   - caches
6. Verify candidate Git HEAD equals active Git HEAD.
7. Record file counts and checksums for critical files.

Do not reuse the current `copyTemplateFiles()` unchanged because it excludes `.git` and Markdown files.

Create separate copy policies:

```ts
copyPackagedTemplate();
copyManagedWorkspace();
copyRecoverySnapshot();
```

Each must have an explicit purpose and exclusions.

---

# 13. Retrieving the PR

For a public GitHub PR, retrieve the unified PR diff directly. Fetch the PR head only to read the
full upstream content of the files declared by the manifest.

Preferred MVP mechanism:

```bash
git fetch <configured_upstream_repository> refs/pull/<number>/head
curl <pr_url>.diff
```

Validation:

- Reject if the PR diff or PR head cannot be fetched.
- Do not execute code from the fetched commit before candidate isolation is ready.

Store update context in:

```text
~/Library/pipper/updates/context/
├── manifest.json
├── upstream.diff
├── upstream-files/
└── changed-files.json
```

---

# 14. Update-agent runtime

Do not reuse the active editor session. Add a dedicated ephemeral update runtime in [agent.ts](/Users/harshithpasupuleti/code/omni/electron/agent.ts), comparable to the current editor runtime but with:

```ts
cwd: getCandidatePath();
```

Suggested methods:

```ts
activateUpdater(context: UpdateContext)
sendUpdaterPrompt(prompt: string)
getUpdaterState()
abortUpdater()
disposeUpdater()
```

Send updater events on a separate channel:

```text
updater:event
```

Do not mix updater snapshots with normal project or editor snapshots.

The updater must be restricted to `candidate/`. Its prompt must explicitly prohibit changes to:

- Launcher code
- Electron updater code
- Paths outside candidate
- `active/`
- `backup/`
- `previous/`
- `shared/active-deps/`
- Update state files

Filesystem enforcement is preferable, but for the MVP enforce cwd and verify resulting changed paths before promotion.

---

# 15. Update-agent prompt

Use a generated prompt containing all required context:

```text
You are updating a customized Pipper application.

Working directory:
<CANDIDATE_PATH>

You may modify files only inside this directory.

Current installed version:
<FROM_VERSION>

Target version:
<TO_VERSION>

Official base commit:
<BASE_COMMIT>

Pinned upstream target:
<TARGET_COMMIT>

PR:
<PR_URL>

Goal:
Port the upstream change represented by the supplied upstream diff onto this
customized instance while preserving user customizations.

Sources of truth:
1. Git diff from official base to current customized instance.
2. Git diff from official base to upstream target.
3. patch.md, which describes the intent of local customizations.
4. Full contents of upstream-changed files.

Rules:
- Preserve user-facing customizations unless they directly prevent the update.
- Apply all behavior introduced by the upstream change.
- Do not modify launcher or updater code.
- Do not modify files outside the candidate directory.
- Merge package.json semantically.
- Do not manually edit bun.lock.
- If dependencies change, update package.json and leave lockfile regeneration
  to the update coordinator.
- Do not commit.
- Do not push.
- When complete, provide a concise summary of applied changes and unresolved risks.
```

After the agent finishes, the coordinator—not the agent—runs validation and creates the update commit.

---

# 16. Dependency isolation

The current shared `node_modules` design is unsafe for candidate updates because `bun install` could alter dependencies used by active.

For the MVP:

```text
shared/
├── active-deps/
│   ├── package.json
│   ├── bun.lock
│   └── node_modules/
└── candidate-deps/
    ├── package.json
    ├── bun.lock
    └── node_modules/
```

Candidate dependency preparation:

1. Copy candidate `package.json` and `bun.lock` into `candidate-deps/`.
2. Run `bun install --frozen-lockfile` if the lockfile remains valid.
3. If the agent changed `package.json`, run `bun install` to regenerate the lockfile.
4. Copy the regenerated lockfile back into candidate.
5. Symlink candidate `node_modules` to `candidate-deps/node_modules`.
6. Never mutate `active-deps/` during update preparation.

After successful promotion, candidate dependencies become active dependencies.

For the first demo, giving candidate its own ordinary `node_modules` is simpler and safer than implementing dependency-directory rotation.

---

# 17. Validation pipeline

Minimum validation:

```bash
git status --short
bun install
bun run lint
bun run build
```

Also run:

- `bun run doctor` if runtime permits.
- Verify `package.json` parses.
- Verify `bun.lock` exists.
- Verify no changed files escape candidate.
- Verify candidate still contains required entry points.
- Verify no launcher/updater files were introduced.
- Verify Git diff is non-empty.
- Verify the candidate’s declared target version.

Create an update commit only after validation:

```text
Apply Pipper 0.2.0 while preserving local customizations
```

Then record:

- Candidate commit SHA.
- Changed files.
- Validation results.
- Agent summary.
- Duration.

For the investor demo, build success is the required acceptance gate. Lint warnings may be displayed, but lint errors should block promotion.

---

# 18. Promotion transaction

Promotion must occur only after candidate validation.

Before promotion:

```text
active     = working installation
backup     = previous recovery installation
candidate  = validated update
previous   = absent
```

Promotion sequence:

1. Ensure `previous/` does not exist.
2. Rename `active/` → `previous/`.
3. Rename `candidate/` → `active/`.
4. Set update phase to `awaiting-health-check`.
5. Start the new active application.
6. Wait for health signal.
7. On success:
   - Delete old `backup/`.
   - Rename `previous/` → `backup/`.
   - Mark update completed.
8. On failure:
   - Rename failed `active/` → `candidate-failed-<timestamp>/`.
   - Rename `previous/` → `active/`.
   - Mark update failed and rolled back.

All directories must be on the same filesystem so renames are atomic.

Never delete `backup/` before the promoted application proves healthy.

---

# 19. Health check

The new active application should report readiness after:

- Renderer loads.
- Required files exist.
- SQLite opens.
- Agent manager initializes.
- Workspace dependencies resolve.

Add an IPC/internal signal such as:

```ts
updateManager.markActiveHealthy(version);
```

The launcher waits for a bounded timeout, for example 30 seconds.

If Pipper exits, crashes, or fails to report readiness before timeout, roll back.

For the initial demo, the launcher can require the user to click:

```text
The updated application opened successfully
[Keep update] [Roll back]
```

Automate this later.

---

# 20. Crash recovery

At launcher startup, inspect `updates/state.json`.

Recovery rules:

| State                                         | Recovery                                                 |
| --------------------------------------------- | -------------------------------------------------------- |
| `preparing`–`validating`                      | Delete candidate or offer retry; keep active             |
| `ready-to-promote`                            | Resume promotion or keep active                          |
| `promoting` with `previous/` and no `active/` | Promote candidate if present; otherwise restore previous |
| `awaiting-health-check`                       | Attempt new active once; otherwise restore previous      |
| `rolling-back`                                | Complete rollback                                        |
| `completed`                                   | Clean stale temporary files                              |

Recovery decisions must be deterministic and not require the agent.

---

# 21. Interaction with Edit Mode

Disable system updates while:

- Edit Mode is active.
- The companion agent is streaming.
- There are unaccepted visual changes.
- Active has uncommitted changes that are not part of an accepted customization.

Before candidate creation:

```bash
git status --porcelain
```

If dirty:

- Ask the user to accept/reject the current edit.
- Do not silently commit unknown changes.
- Do not discard anything.

Once the update begins, disable:

- New editor prompts.
- New terminal sessions targeting active.
- Project switching that could restart managed services.
- Additional update attempts.

---

# 22. UI implementation files

Suggested additions:

```text
contracts/updates.ts
electron/update-manager.ts
electron/update-manifest.ts
electron/update-state.ts
electron/update-git.ts
electron/update-validation.ts
src/store/update-store.ts
src/components/update-banner.tsx
src/components/update-dialog.tsx
src/components/update-progress.tsx
src/launch/update-stage.tsx
```

Suggested modifications:

- [main.ts](/Users/harshithpasupuleti/code/omni/electron/main.ts)
- [preload.ts](/Users/harshithpasupuleti/code/omni/electron/preload.ts)
- [electron.d.ts](/Users/harshithpasupuleti/code/omni/src/electron.d.ts)
- [workspace-manager.ts](/Users/harshithpasupuleti/code/omni/electron/workspace-manager.ts)
- [agent.ts](/Users/harshithpasupuleti/code/omni/electron/agent.ts)
- [App.tsx](/Users/harshithpasupuleti/code/omni/src/App.tsx)
- [launch app.tsx](/Users/harshithpasupuleti/code/omni/src/launch/app.tsx)

Keep the update coordinator separate from `workspace-manager.ts`; that file should provide filesystem primitives, not own the update state machine.

---

# 23. Implementation phases

## Phase 1: Workspace safety

- Add candidate and previous paths.
- Split copy behavior into explicit copy policies.
- Preserve `.git` and `patch.md` in managed copies.
- Add candidate creation and deletion.
- Add atomic promotion and rollback.
- Add persisted update state.
- Add crash recovery tests.

## Phase 2: Update discovery

- Add manifest contract and parser.
- Add version comparison.
- Fetch manifest at startup.
- Add update store and banner.
- Add “Later” and “Update when I quit.”

## Phase 3: PR acquisition

- Resolve and fetch the pull request head.
- Download the upstream PR diff directly.
- Save update context.
- Validate the PR URL and changed-file paths.
- Expose progress events.

## Phase 4: Update agent

- Add dedicated updater runtime using candidate cwd.
- Add updater event channel.
- Generate the full update prompt.
- Implement cancellation and disposal.
- Verify the agent changed only candidate files.

## Phase 5: Dependencies and validation

- Isolate candidate dependencies.
- Regenerate lockfile when necessary.
- Run lint and build.
- Persist command output.
- Create update commit after validation.

## Phase 6: Quit and promotion

- Intercept scheduled Command-Q.
- Show update progress window.
- Promote candidate.
- Restart into new active.
- Add health confirmation.
- Roll back on failure.

## Phase 7: Demo polish

- Human-readable progress steps.
- View-PR action.
- Failure diagnostics.
- Retry update.
- Rollback button.
- Demo manifest and controlled conflicting PR.

---

# 24. Required tests

## Unit tests

- Manifest validation.
- Version comparison.
- State transition validation.
- Atomic state-file writes.
- Directory-path generation.
- Copy exclusions.
- Update prompt construction.
- PR base/head validation.

## Integration tests

1. Upstream changes unrelated file; customization survives.
2. Upstream and customization modify the same component.
3. User-added dependency survives upstream dependency change.
4. Candidate build failure leaves active untouched.
5. Agent abort leaves active untouched.
6. Power interruption during candidate preparation.
7. Power interruption between directory renames.
8. Promoted app fails health check and rolls back.
9. Dirty active workspace blocks update.
10. `patch.md` remains available to candidate agent.
11. Candidate dependency install does not mutate active dependencies.
12. Command-Q cancellation quits without updating.
13. Repeated update request does not start concurrent jobs.
14. Already-installed version is ignored.
15. An installed workspace with unrelated local Git history can still acquire the PR diff.

---

# 25. Investor demo scenario

Prepare a controlled scenario with a real semantic conflict.

Version A:

```tsx
<Button className="rounded-full bg-blue-500">Create thread</Button>
```

User customization:

```tsx
<Button className="rounded-md bg-purple-500">Start conversation</Button>
```

Version B changes the component behavior:

```tsx
<Button className="rounded-full bg-blue-500" disabled={isCreating} onClick={createThread}>
  {isCreating ? "Creating…" : "Create thread"}
</Button>
```

Expected agent-produced result:

```tsx
<Button className="rounded-md bg-purple-500" disabled={isCreating} onClick={createThread}>
  {isCreating ? "Creating…" : "Start conversation"}
</Button>
```

The demonstration proves:

- Upstream behavior was added.
- User visual and copy customizations survived.
- The same lines were modified on both branches.
- The candidate built successfully.
- The previous version remained recoverable.
- The update produced an auditable commit.

---

# 26. MVP acceptance criteria

The feature is complete when all these statements are true:

- The application detects a newer manifest.
- The user can schedule an update for quit.
- The updater creates a candidate from active.
- Active and backup remain unchanged during agent work.
- The exact pinned PR change is supplied to the update agent.
- Git and `patch.md` supply customization context.
- User-added packages are preserved where compatible.
- Candidate dependencies are isolated.
- Candidate must build before promotion.
- Promotion uses same-filesystem renames.
- Startup failure restores the previous active version.
- Cancellation never damages active.
- Interrupted updates recover deterministically.
- Launcher and updater code are outside the agent’s writable workspace.
- The demo resolves an overlapping upstream/customization conflict successfully.

The implementation should prioritize the candidate isolation, state machine, and rollback path first. The agent prompt and UI are secondary; without filesystem safety, the demonstration remains vulnerable to a single partial failure.
