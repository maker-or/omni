# Blind Spots From The Personalized Update Bug Hunt

This note records the concerns raised about the personalized updater and the broader review blind spots that let them survive several debugging iterations.

## Short answer: why we missed these

We kept debugging the visible failure path instead of auditing the state invariant behind it.

The updater is not just a sequence of UI phases. It is a small state machine spread across:

- `~/Library/pipper/active`
- `~/Library/pipper/candidate`
- `~/Library/pipper/previous`
- `~/Library/pipper/backup`
- `~/Library/pipper/installation.json`
- `~/Library/pipper/updates/state.json`

The missed bugs came from treating `installation.json` as reliable truth without proving that every path keeps it in sync with the active workspace.

## Concerns raised

### 1. The "Active workspace changed" error can be false

The final check in `UpdateManager.run()` reads installation metadata once at the start:

```ts
const installation = this.readInstallation();
```

Then much later it validates:

```ts
await assertCleanWorkspace(getActivePath());
if ((await getGitHead(getActivePath())) !== installation.customized_head_commit) {
  throw new Error("Active workspace changed while the update candidate was being prepared.");
}
```

That does not compare active HEAD at update start with active HEAD at update end.

It compares:

- live active HEAD at validation time
- persisted `installation.json.customized_head_commit` from the beginning of the run

So the error message can be misleading. If `installation.json` was already stale before the update began, the updater can report that active changed during candidate preparation even when nothing changed during that run.

This was the main concern, and it is real.

### 2. `createCandidateFromActive()` already captures the right HEAD, but the updater ignores it

`createCandidateFromActive()` returns a snapshot with:

```ts
active_head;
candidate_head;
```

It also verifies candidate HEAD matches active HEAD at the time the candidate is copied.

But `UpdateManager.run()` discards that return value:

```ts
await createCandidateFromActive();
```

The later safety check uses stale persisted metadata instead of the runtime snapshot. That is exactly the kind of local invariant we failed to follow through.

### 3. `customized_head_commit` has too few writers

Known writers:

- initial workspace metadata creation in `initializeWorkspaces()`
- visual edit accept in `electron/main.ts`
- successful update completion in `UpdateManager.run()`

That means the metadata can go stale when active HEAD changes outside those narrow paths, including:

- git is initialized after an install already has `installation.json`
- a promotion/recovery path changes which directory is now `active`
- manual or tool-driven commits happen in active
- an update is interrupted between filesystem changes and metadata persistence

The design assumes active HEAD changes only through accepted visual edits or successful updates. The code does not enforce that strongly enough.

### 4. `installed_version` is workspace version, not launcher version

The root `package.json.version` is the launcher version.

`package.json.pipper.workspaceVersion` is the workspace version.

`scripts/copy-template.js` writes `app-template/installation.json.installed_version` from `pipper.workspaceVersion`.

So `~/Library/pipper/installation.json.installed_version` tracks the personalized workspace version. It should not be derived from the Electron launcher version.

This concern is true.

### 5. `installed_version: "0.0.0"` is stale/broken metadata

`initializeWorkspaces()` defaults `installedVersion` to `"0.0.0"` and only replaces it if it can read packaged metadata or a package version from the resolved template path.

Because `installation.json` is create-once, a bad initial value can persist indefinitely unless a workspace update completes successfully.

Visual edit accept updates `customized_head_commit` and `last_healthy_at`, but it does not update `installed_version`. So a fresh `last_healthy_at` does not prove the installed version is accurate.

This concern is true.

### 6. Current local state has a separate dirty-worktree problem

The current machine check showed:

```sh
git -C ~/Library/pipper/active rev-parse HEAD
jq -r .customized_head_commit ~/Library/pipper/installation.json
```

Both returned:

```text
352fb29cccc7e3838a46d851141098516e356711
```

But:

```sh
git -C ~/Library/pipper/active status --porcelain
```

reported multiple modified and untracked files.

That means the current local state would normally fail earlier at `assertCleanWorkspace()` with:

```text
Active workspace has uncommitted changes. Accept or reject the current edit first.
```

The stale-HEAD bug is still real, but the current machine state is not currently demonstrating that exact failure.

## Additional blind spots found

### 1. The updater lacks a single metadata invariant function

There is no central function that says:

```text
If active is clean, installation.customized_head_commit must equal active HEAD.
```

The invariant is implied in multiple places but never named. That made it easy to miss.

Recommended fix direction:

- add a `readAndValidateInstallationAgainstActive()` helper
- include explicit handling for stale metadata
- distinguish "metadata stale before update" from "active changed during update"

### 2. Startup repairs only directories, not metadata

`UpdateManager.recover()` handles interrupted directory states:

- `candidate`
- `previous`
- `active`

But it does not repair or validate `installation.json` after recovery.

That leaves a gap where filesystem recovery succeeds but metadata still describes a different logical install.

Recommended fix direction:

- after recovery, validate metadata against the restored active workspace
- if active is clean and metadata is stale, either repair it or report a specific diagnostic state

### 3. Promotion finalization writes metadata after filesystem mutation

Successful update flow:

1. promote candidate to active
2. wait for health
3. finalize previous into backup
4. write `installation.json`

If the process dies after the filesystem changes but before metadata write, active can contain the promoted candidate while metadata still points at the old install.

Some recovery paths roll back, but the metadata consistency risk is not explicitly tested.

Recommended fix direction:

- make promotion metadata updates staged and recoverable
- persist enough pending metadata before promotion to make recovery deterministic
- test crashes at each promotion boundary

### 4. The check's error message overstates causality

The message says:

```text
Active workspace changed while the update candidate was being prepared.
```

The code has not proven that. It has only proven:

```text
active HEAD does not equal installation.customized_head_commit read at update start
```

Recommended fix direction:

- compare against a runtime start snapshot to detect actual mid-run active changes
- use a separate message for stale installation metadata

### 5. Tests cover pieces, not the lifecycle

Current tests cover:

- workspace copy policy
- update manifest parsing
- update state transitions
- update state persistence

They do not cover:

- initialization with existing metadata but missing `.git`
- stale `customized_head_commit`
- stale `installed_version`
- clean active workspace with stale metadata
- dirty active workspace with matching metadata
- interrupted promotion before metadata write
- recovery followed by metadata validation
- quit-scheduled update using the same metadata path

This is the biggest process failure. The bug sits between modules, so unit tests for individual modules did not expose it.

### 6. Dev and packaged template paths behave differently

In dev, `templatePath` is `process.cwd()`.

In packaged builds, `templatePath` is `resources/app-template`.

That changes where initial metadata is read from:

- dev may read root `package.json`
- packaged should read `app-template/installation.json`

This makes version initialization easy to misunderstand and easy to test incorrectly.

Recommended fix direction:

- add explicit tests for both dev and packaged initialization paths
- log resolved source of `installed_version`
- avoid silent fallback to `"0.0.0"` unless it is surfaced as a repairable diagnostic

## What should have caught this earlier

### Manual checks

Before trusting any update failure, run:

```sh
git -C ~/Library/pipper/active status --porcelain
git -C ~/Library/pipper/active rev-parse HEAD
jq . ~/Library/pipper/installation.json
```

Then classify:

- dirty active tree: fail early as user/editor state
- clean active tree, HEAD equals metadata: proceed
- clean active tree, HEAD differs from metadata: metadata stale, not active changed during update
- `installed_version` lower than expected: update availability may be based on stale workspace metadata

### Tests to add

1. Clean active workspace with stale `customized_head_commit`
   - expected: specific stale-metadata diagnostic, not "changed during preparation"

2. Active changes during update after candidate snapshot
   - expected: actual active-changed error using start HEAD vs end HEAD

3. Existing `installation.json`, missing `.git`, then `initializeWorkspaces()`
   - expected: metadata is repaired or a clear diagnostic is emitted

4. Successful visual edit accept
   - expected: `customized_head_commit` updates, `installed_version` remains unchanged intentionally

5. Successful workspace update
   - expected: `installed_version` and `customized_head_commit` both update

6. Interrupted promotion after candidate becomes active but before metadata write
   - expected: recovery restores active and metadata to a consistent pair

7. Dev initialization and packaged initialization
   - expected: workspace version source is explicit and correct in both modes

## Suggested implementation direction

The safest fix is not just changing the error string.

Recommended sequence:

1. Store the return value of `createCandidateFromActive()`.
2. Use `snapshot.active_head` as the runtime baseline for the final active-change check.
3. Before starting update work, validate `installation.customized_head_commit` against active HEAD when the active tree is clean.
4. If metadata is stale before the run, emit a separate repairable error or repair metadata if the conditions are safe.
5. Add startup metadata validation after interrupted promotion recovery.
6. Add lifecycle tests around metadata consistency, not just phase transitions.

The core invariant should become explicit:

```text
For a clean active workspace, installation.customized_head_commit must either match active HEAD or be repaired before update preparation starts.
```

## Process lesson

We failed because we debugged symptoms inside one flow instead of asking what persisted state the flow trusted.

The better review pattern for this class of bug is:

1. list every persisted state file
2. list every writer
3. list every reader
4. identify stale-read risks
5. test every crash/recovery boundary
6. verify error messages only claim what the code proves

That would have surfaced these concerns much earlier.
