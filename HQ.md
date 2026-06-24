# Personalized Workspace Update — Implementation Brief

**Goal:** Fix silent failures, split state correctly, make agent + promotion observable, remove redundant `updates/context/`. Treat this doc as source of truth until PRs land.

---

## 0. How to use this document

1. Read §2 (file map) — know which files you will touch.
2. Read §4 (silent failures) — these are the bugs to fix, not just missing error strings.
3. Read §6 (target contracts) — implement types first in `contracts/updates.ts`.
4. Follow §11 (implementation order) — dependencies are ordered; do not skip phases.
5. Run `bun run doctor`, `bun run lint`, `bun run build`, `bun run fmt` before done.

**Do not:** expand scope to launcher updates, rewrite unrelated agent code, or re-read `update.md` unless releasing manifests.

---

## 1. Problem summary

The updater copies `active/` → `candidate/`, fetches upstream PR changes, runs an update agent, validates, atomically swaps directories, health-checks, finalizes. **Three problem classes:**

| #   | Class              | Symptom                                                                                                                                         |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Redundant disk     | `updates/context/` duplicates GitHub + `candidate/.git`; never cleaned                                                                          |
| 2   | Broken state model | `state.json` mixes phase, offer, logs, versions; half-dead fields after transitions                                                             |
| 3   | Silent failures    | Failures erased, evidence deleted, promotion/health crashes roll back working updates; agent success inferred from `agent_end` not file changes |

**Observed real-world failure pattern:** `check()` succeeds (`manifest.json` correct). Run passes `fetching-upstream` (context created). Run dies before `candidate_commit` is persisted. `removeCandidate()` destroys evidence. `check()` moves `failed` → `available` and clears `error`. User never knows why.

---

## 2. Complete file map

### 2.1 Core backend (primary implementation surface)

| File                              | Role today                                                                                                                                                                  | You change                                                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contracts/updates.ts`            | `UpdateState`, `UpdateManifest`, phases                                                                                                                                     | Add lean `UpdateState`, `UpdateRunRecord`, agent/promotion substates, `UpdateFailure`, `PromotionReceipt`. Remove bloated fields from `UpdateState`. |
| `electron/update-manager.ts`      | Coordinator: `check()`, `run()`, `recover()`, `persist()`                                                                                                                   | Lean `persist()`; create/update run records; fix `check()` not erasing failures; wire observability; use run record for health gate                  |
| `electron/update-state.ts`        | Phase transitions, `writeUpdateStateAtomic()`                                                                                                                               | Keep; add `writeUpdateRunRecordAtomic()` alongside (same tmp+rename pattern)                                                                         |
| `electron/update-installation.ts` | Read/write `installation.json`                                                                                                                                              | Add `readAndValidateInstallationAgainstActive()` — single invariant helper                                                                           |
| `electron/update-git.ts`          | `assertCleanWorkspace`, `acquireUpdateContext`, `buildUpdaterPrompt`                                                                                                        | Remove disk writes in `acquireUpdateContext`; git-fetch-only; rewrite prompt for git ref                                                             |
| `electron/update-validation.ts`   | `validateCandidate()`                                                                                                                                                       | Keep logic; return results to run log not `state.json`; throw with `UpdateFailure` codes                                                             |
| `electron/update-manifest.ts`     | `parseUpdateManifest()`                                                                                                                                                     | Keep strict parsing                                                                                                                                  |
| `electron/workspace-manager.ts`   | `createCandidateFromActive`, `promoteCandidate`, `finalizePromotion`, `rollbackPromotion`, `recoverInterruptedPromotion`, `removeCandidate`, `prepareCandidateDependencies` | Md allowlist on copy; `normalizeActiveBeforeUpdate()`; `promoteCandidate()` returns `PromotionReceipt`; post-swap invariant check                    |
| `electron/agent.ts`               | `activateUpdater`, `sendUpdaterPrompt`, `abortUpdater`, `disposeUpdater`, `getUpdaterState`                                                                                 | Emit agent substate callbacks to coordinator; capture real summary on `agent_end`; optional tool events                                              |
| `electron/main.ts`                | IPC handlers, quit flow (`before-quit` → `startNow`), `initializeUpdateSubsystem`, `prepareForUpdate`, `restartAfterPromotion`, `markActiveHealthy`                         | New IPC: `getRun`, `getUpdaterSnapshot`, `onUpdaterEvent`; fix cold-start failure visibility via store or main broadcast                             |
| `electron/preload.ts`             | Exposes `window.omni.update.*`                                                                                                                                              | Add `getRun`, `getUpdaterSnapshot`, `onUpdaterEvent`                                                                                                 |

### 2.2 Renderer (secondary)

| File                                 | Role today                                            | You change                                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/store/update-store.ts`          | Subscribes `update:stateChanged`; `detailsOpen` logic | Open dialog on cold start if `failed`; subscribe `onUpdaterEvent`; poll `getRun`; handle `startNow` result; `dismissed_for_session` in memory only |
| `src/components/update-dialog.tsx`   | Progress + validation output                          | Read run record for substates; show `failure.code`; “View log”                                                                                     |
| `src/components/update-progress.tsx` | Phase steps                                           | Agent + promotion substeps from run record                                                                                                         |
| `src/components/update-banner.tsx`   | Offer banner                                          | Compose versions from `installation.json` + `manifest.json` (IPC or bundled read)                                                                  |
| `src/App.tsx`                        | `markActiveHealthy(to_version)` effect                | Use run record `target_version` via `getRun(state.run_id)`                                                                                         |
| `src/launch/app.tsx`                 | Same health effect + `UpdateStage`                    | Same as App.tsx                                                                                                                                    |
| `src/electron.d.ts`                  | Types for preload                                     | Match new IPC                                                                                                                                      |

### 2.3 Tests to add/update

| File                                      | Cover                               |
| ----------------------------------------- | ----------------------------------- |
| `electron/update-state.test.ts`           | Lean state transitions              |
| `electron/update-installation.test.ts`    | Invariant helper                    |
| `electron/update-git.test.ts`             | New prompt shape (no context paths) |
| `electron/workspace-manager.test.ts`      | Md allowlist, `PromotionReceipt`    |
| New: `electron/update-run-record.test.ts` | Atomic write, recovery branches     |

### 2.4 Do not touch (unless compile breaks)

`electron/launcher-update-*.ts`, `src/store/launcher-update-store.ts`, `src/components/launcher-update*.tsx`, `scripts/copy-template.js` (except if installation seed docs needed).

---

## 3. State economy — all stores and invariants

The system is **9+ parallel stores**. No single function enforces consistency today.

### 3.1 Store registry

| ID  | Store          | Path / location          | Writers                                                              | Readers                                            |
| --- | -------------- | ------------------------ | -------------------------------------------------------------------- | -------------------------------------------------- |
| A   | Coordinator    | `updates/state.json`     | `UpdateManager.persist()`                                            | Constructor, UI, `recover()`                       |
| B   | Offer file     | `updates/manifest.json`  | `check()` only                                                       | UI version display, run start                      |
| C   | Offer embed    | `state.manifest` (today) | `check()`                                                            | `run()` uses in-memory copy — **remove in target** |
| D   | Installed      | `installation.json`      | create-once init, accept edit, successful update, silent HEAD repair | `check()`, run preflight, health                   |
| E   | Active app     | `~/active/` + `.git`     | editor, dev watcher, promotion, recovery                             | preflight, validation drift check                  |
| F   | Candidate      | `~/candidate/`           | copy, agent, coordinator commit                                      | agent cwd; **deleted on most failures today**      |
| G   | Promotion slot | `~/previous/`            | `promoteCandidate()`                                                 | rollback, recover                                  |
| H   | Context cache  | `updates/context/`       | `acquireUpdateContext()`                                             | agent prompt paths — **remove in target**          |
| I   | In-memory      | `UpdateManager` instance | constructor, `running`, `healthResolve`, `cancelled`                 | gates                                              |
| J   | Active deps    | `shared/active-deps/`    | workspace init                                                       | active `node_modules` symlink                      |
| K   | Candidate deps | `shared/candidate-deps/` | `prepareCandidateDependencies()`                                     | candidate `node_modules` symlink                   |
| L   | Renderer       | `update-store`           | IPC events                                                           | UI; **desyncs from A on cold start**               |

### 3.2 Required invariants (enforce explicitly)

```text
INV-1: When active git clean → installation.customized_head_commit === active HEAD
INV-2: installed_version changes only after promotion finalized + installation write
INV-3: state.phase must agree with filesystem layout (see §3.3)
INV-4: check() must NOT clear a failed run's error without explicit user dismiss
INV-5: Promotion receipt persisted before awaiting-health-check
INV-6: Agent "success" requires candidate git diff non-empty before validation passes
INV-7: Run evidence (run record + log) survives candidate deletion
```

### 3.3 Phase ↔ filesystem truth table

| `phase`                            | `active/`          | `candidate/` | `previous/` | `installation.json` trustworthy?  |
| ---------------------------------- | ------------------ | ------------ | ----------- | --------------------------------- |
| `idle` / `available` / `scheduled` | user app           | absent       | absent      | yes if E clean                    |
| `preparing` … `validating`         | frozen             | working      | absent      | yes                               |
| `ready-to-promote`                 | frozen             | validated    | absent      | yes — **today recover deletes F** |
| `promoting`                        | mid-rename         | mid-rename   | maybe       | **no**                            |
| `awaiting-health-check`            | **new code**       | gone         | old         | **no** — D still old              |
| `completed`                        | new                | gone         | gone        | yes after write                   |
| `failed`                           | old or rolled back | usually gone | maybe       | maybe stale                       |

---

## 4. Silent failures catalog (must fix)

These do **not** reliably surface in UI. This is the root cause of “update failed but I don't know why.”

### 4.1 Forensic destruction

| ID  | What happens                                                                         | Why silent                                                      |
| --- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| S1  | `check()` after `failed` sets `error: null`, `phase: available`                      | Failure reason erased from disk                                 |
| S2  | `removeCandidate()` on catch/recover                                                 | Agent work gone; can't inspect                                  |
| S3  | `validation_results` / `candidate_commit` not cleared by `check()` but error cleared | Half-dead state                                                 |
| S4  | `catch` only persists `validation_results` if `error.results` array exists           | Agent/deps failures leave empty results — matches observed disk |

### 4.2 Gate failures without `phase: failed`

| ID  | What happens                                               | Why silent                             |
| --- | ---------------------------------------------------------- | -------------------------------------- |
| S5  | Editor busy: `persist({ error })` **without phase change** | Stays `available`; banner shows offer  |
| S6  | No manifest: `return { success: false }` — no persist      | IPC only                               |
| S7  | `markActiveHealthy` returns `false` — no log               | 30s timeout → generic rollback message |

### 4.3 Agent phase lies

| ID  | What happens                                                                       | Why silent                                                    |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| S8  | `agent_end` → hardcoded summary string                                             | Coordinator thinks success; agent may have changed zero files |
| S9  | `updater:event` → `sendToMainWindow` only; not in preload                          | No UI visibility; launch-only quit update worse               |
| S10 | No timeout on `sendUpdaterPrompt`                                                  | Hang forever in `agent-running`                               |
| S11 | Candidate `node_modules` symlinks to `active-deps` during agent (before deps step) | Agent `bun` in candidate can touch active deps — no record    |

### 4.4 Upstream / context

| ID  | What happens                                             | Why silent                              |
| --- | -------------------------------------------------------- | --------------------------------------- |
| S12 | `upstream-files` skip on `git show` fail if file missing | Partial context, no error               |
| S13 | `updates/context/` never deleted on failure              | Cross-run contamination                 |
| S14 | `updates/manifest.json` vs `context/manifest.json`       | Two manifests; confusing which is truth |

### 4.5 Promotion / health / recovery

| ID  | What happens                                                                                   | Why silent                                |
| --- | ---------------------------------------------------------------------------------------------- | ----------------------------------------- |
| S15 | Crash after health OK, before `finalizePromotion` → recover rolls back                         | **Working update lost**; D never advanced |
| S16 | Promoted E, D still old during `awaiting-health-check`                                         | External readers of D lie                 |
| S17 | `ready-to-promote` recover → `removeCandidate()`                                               | Validated candidate destroyed             |
| S18 | `recoverInterruptedPromotion`: active missing + previous missing + candidate exists → `"none"` | Orphan state                              |
| S19 | `promoteCandidate()` returns void                                                              | No proof swap succeeded before health     |
| S20 | Health depends on renderer effect + 30s race                                                   | Reload slow → false rollback              |

### 4.6 UI / renderer desync

| ID  | What happens                                                                                       | Why silent                            |
| --- | -------------------------------------------------------------------------------------------------- | ------------------------------------- |
| S21 | `initialize()` sets `detailsOpen` only for scheduled-quit message — **not `failed` on cold start** | User never sees failure after restart |
| S22 | `startNow()` result ignored in `update-store`                                                      | No UI branch on error                 |
| S23 | `dismissed_for_session` reset in constructor memory, persisted field cleared by `check()`          | Banner behavior inconsistent          |

### 4.7 Metadata drift

| ID  | What happens                                                                             | Why silent                                |
| --- | ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| S24 | `installation.json` create-once; `installed_version: "0.0.0"` can persist forever        | Offers still work; version display wrong  |
| S25 | `repairInstallationHeadIfActiveClean` patches HEAD only, not `installed_version`         | Looks healthy, version wrong              |
| S26 | Dev file watcher (repo→active) dirties E; failed update leaves watcher off until restart | Next preflight fails for unrelated reason |

### 4.8 Mapping to fix (traceability)

| Silent ID    | Fix in target design                                                         |
| ------------ | ---------------------------------------------------------------------------- |
| S1, S3, S4   | §7.4 `check()` rules; run record + log survive                               |
| S5, S6       | Structured `UpdateFailure` + `phase: failed` for all aborts                  |
| S7, S19, S20 | Promotion receipt + run record + log `markActiveHealthy` false               |
| S8, S9, S10  | Agent substate in run record; IPC; git diff check before leaving agent phase |
| S11          | Isolate candidate deps before agent OR document + symlink fix at copy        |
| S12–S14      | Remove `context/`; git-native prompt                                         |
| S15–S18      | Recovery reads `promotion.status` from run record (§9)                       |
| S21–S23      | `update-store` cold-start rules; session-only dismiss                        |
| S24–S26      | `readAndValidateInstallationAgainstActive`; hard reset before copy           |

---

## 5. Current implementation flow (function-level)

Use this to know what exists today before changing it.

### 5.1 Discovery — `UpdateManager.check()`

```
fetch(PIPPER_UPDATE_MANIFEST_URL)
parseUpdateManifest(json, installation.installed_version, repositoryUrl)
write updates/manifest.json
persist(embedded manifest, from_version, to_version, phase: available|scheduled)
```

Skips silently if `this.running`. On success after prior `failed`, clears `error` (S1).

**Config defaults** (`electron/main.ts`):

- Manifest: `https://pipper.dev/api/agent-update.json`
- Repo: `https://github.com/maker-or/omni`

### 5.2 Run — `UpdateManager.run()`

```
manifest = state.manifest (in-memory)
GATE: editor active/busy → persist error only, return (S5)
GATE: assertCleanWorkspace(active)
GATE: installation HEAD === active HEAD
prepareForUpdate() → quiesce agent, close companion, kill PTYs, stopDevFileWatcher
progress preparing → createCandidateFromActive()
progress fetching-upstream → acquireUpdateContext() [writes context/]
progress agent-running → activateUpdater + sendUpdaterPrompt
persist agent_summary (hardcoded on agent_end)
pin candidate package.json version
progress installing-dependencies → prepareCandidateDependencies()
progress validating → validateCandidate()
GATE: active HEAD === candidateSnapshot.active_head
git commit in candidate
persist validation_results + candidate_commit
progress ready-to-promote → promoting → promoteCandidate()
progress awaiting-health-check → restartPromotedApp() → 30s health race
finalizePromotion()
writeInstallationMetadata()
persist completed
CATCH: rollback if previous exists else removeCandidate; persist failed
```

### 5.3 Recovery — `UpdateManager.recover()` (once at `initializeUpdateSubsystem`)

```
recoverInterruptedPromotion() — if !active && previous: restore or promote candidate
mid-phase preparing…validating → removeCandidate, failed
ready-to-promote → removeCandidate, failed (S17)
promoting|awaiting-health-check + previous → rollback, failed (S15)
completed → rm previous
validateRecoveredInstallationMetadata()
```

### 5.4 Quit-triggered run — `app.on("before-quit")`

Only if `scheduled_for_quit`. Prevents quit, opens launch window if needed, `startNow()`. On failure (not cancelled), app stays open but S1 can erase reason.

### 5.5 Health — `markActiveHealthy(version)`

Requires `phase === awaiting-health-check"` AND `version === state.to_version`. Called from `App.tsx` and `launch/app.tsx` effects. Silent false otherwise (S7).

---

## 6. Target architecture

### 6.1 Disk layout

```text
~/Library/pipper/
├── active/
├── backup/
├── candidate/              # ephemeral during run
├── previous/               # during promotion only
├── shared/active-deps/
├── shared/candidate-deps/
├── installation.json
└── updates/
    ├── manifest.json       # offer only
    ├── state.json          # lean FSM
    ├── runs/<run_id>.json  # per-run truth
    └── logs/<run_id>.log   # append-only timeline
```

**No `updates/context/` directory.**

### 6.2 Lean `state.json`

```json
{
  "phase": "idle",
  "updated_at": "2026-06-24T12:00:00.000Z",
  "scheduled_for_quit": false,
  "error": null,
  "run_id": null
}
```

### 6.3 TypeScript contracts (`contracts/updates.ts`)

```ts
export interface UpdateState {
  phase: UpdatePhase;
  updated_at: string;
  scheduled_for_quit: boolean;
  error: string | null;
  run_id: string | null;
}

export type AgentRunStatus =
  | "pending"
  | "activating"
  | "prompt_sent"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled";

export type PromotionStatus =
  | "pending"
  | "swapped"
  | "health_ok"
  | "finalized"
  | "rolled_back"
  | "failed";

export type UpdateFailureCode =
  | "AGENT_ACTIVATION"
  | "AGENT_PROMPT"
  | "AGENT_RUNTIME"
  | "AGENT_CANCELLED"
  | "VALIDATION"
  | "PROMOTION_SWAP"
  | "PROMOTION_HEALTH"
  | "PROMOTION_FINALIZE"
  | "ACTIVE_DRIFT"
  | "INSTALLATION_STALE";

export interface UpdateFailure {
  code: UpdateFailureCode;
  message: string;
  step: "preflight" | "agent" | "validation" | "promotion";
  at: string;
}

export interface UpdateRunAgentState {
  status: AgentRunStatus;
  activated_at?: string;
  prompt_sent_at?: string;
  ended_at?: string;
  error?: string;
  session_id?: string;
  last_event?: "tool_start" | "tool_end" | "message" | "agent_end";
  tool_count?: number;
  summary?: string;
  candidate_dirty_files?: string[]; // git status before leaving agent phase
}

export interface UpdateRunPromotionState {
  status: PromotionStatus;
  candidate_commit?: string;
  active_head_before?: string;
  active_head_after_swap?: string;
  swapped_at?: string;
  health_at?: string;
  finalized_at?: string;
  error?: string;
  rollback_reason?: string;
}

export interface UpdateRunRecord {
  run_id: string;
  started_at: string;
  installed_version_at_start: string;
  target_version: string;
  pr_url: string;
  pr_number: number;
  git_ref: string;
  files_changes: string[];
  active_head_at_start: string;
  candidate_commit?: string;
  agent: UpdateRunAgentState;
  promotion: UpdateRunPromotionState;
  failure?: UpdateFailure;
  finished_at?: string;
  outcome?: "completed" | "failed" | "cancelled";
}

export interface PromotionReceipt {
  previous_path: string;
  active_head_before: string;
  active_head_after: string;
  candidate_head: string;
  swapped_at: string;
}
```

### 6.4 Version display rule

**No `from_version` / `to_version` in `state.json`.** UI composes `installation.installed_version → manifest.version` from `installation.json` + `updates/manifest.json`. During run, freeze versions in `UpdateRunRecord`.

---

## 7. Target run flow (write points)

### 7.1 Run start (`preparing`)

1. Generate `run_id` (uuid).
2. Write `UpdateRunRecord` with manifest fields + `active_head_at_start`.
3. `persist({ run_id }, phase: preparing)`.
4. **`normalizeActiveBeforeUpdate(active)`** — `git reset --hard HEAD && git clean -fd` (no backup).
5. `readAndValidateInstallationAgainstActive()` — repair or fail with `INSTALLATION_STALE`.
6. `createCandidateFromActive()` with **md allowlist**: only `AGENT.md`, `DESIGN.md`, `patch.md`; exclude other `*.md`.
7. **Symlink fix:** after copy, candidate `node_modules` should not point at `active-deps` until candidate-deps ready — either defer agent until deps copied, or use isolated symlink from copy policy.
8. Append log: `phase=preparing`.

### 7.2 `fetching-upstream`

1. Git fetch only inside `candidate/`:
   ```bash
   git fetch <repo> +refs/pull/<n>/head:refs/pipper-update/pr-<n>
   ```
2. No disk writes under `updates/`.
3. Append log: `phase=fetching-upstream git_ref=...`.

### 7.3 `agent-running`

| Event                    | Run record                      | Log                 |
| ------------------------ | ------------------------------- | ------------------- |
| Before `activateUpdater` | `agent.status=activating`       | `agent=activating`  |
| After bind OK            | `prompt_sent`, timestamps       | `agent=prompt_sent` |
| First streaming          | `streaming`                     | `agent=streaming`   |
| Tool events              | `last_event`, `tool_count++`    | optional            |
| `agent_end`              | `completed`, real `summary`     | `agent=completed`   |
| Error / cancel           | `failed`/`cancelled`, `failure` | `agent=failed`      |

**Before leaving agent phase:** capture `candidate_dirty_files` from `git status --short`. If empty → fail with `VALIDATION` / message "agent produced no changes" **here**, not late in validation.

Coordinator hooks: pass callback from `UpdateManager` into `AgentManager` updater subscription.

### 7.4 `installing-dependencies` + `validating`

- Pin `package.json` version to `target_version`.
- `prepareCandidateDependencies()`.
- `validateCandidate()` — on fail, append full output to log; set `failure` on run record.
- Commit candidate; set `candidate_commit`.
- Append log lines for each validation command.

### 7.5 Promotion substeps

| Step     | Function                                  | Run record                 | Invariant check                                                                  |
| -------- | ----------------------------------------- | -------------------------- | -------------------------------------------------------------------------------- |
| Swap     | `promoteCandidate()` → `PromotionReceipt` | `promotion.status=swapped` | active exists, previous exists, candidate gone, active HEAD === candidate_commit |
| Health   | `markActiveHealthy(target_version)`       | `health_ok`                | log if false                                                                     |
| Finalize | `finalizePromotion()`                     | `finalized`                | previous gone, backup updated                                                    |

**Before `awaiting-health-check`:** persist promotion receipt to run record.

**Pending installation:** write `installation.json` only after finalize (keep current order) BUT add `updates/runs/<id>.json` promotion state so recover knows swap succeeded (fix S15).

### 7.6 `check()` rules (fix S1)

- If `phase === failed``: do **not** clear `error`or move to`available`unless user called`dismiss()` OR new run started.
- Periodic check may refresh `manifest.json` but must not destroy run record/log from last failure.
- Clearing stale fields (`validation_results` etc.) happens only on migration from old schema or explicit idle reset.

### 7.7 Agent prompt (replace `buildUpdaterPrompt`)

```
Working directory: <candidate_path>
PR: <pr_url> (#<n>)
Git ref: refs/pipper-update/pr-<n>
Files changed: <files_changes from run record>
patch.md: customization intent (use git log -S <change_id>)
Rules: preserve customizations; no launcher/updater edits; no commit; no manual bun.lock
Upstream: git show refs/pipper-update/pr-<n>:<path> and git diff against that ref
```

---

## 8. Recovery rules (replace current `recover()`)

Load run record via `state.run_id` or newest `runs/*.json` if phase implies interrupted run.

| `promotion.status` at crash | Action                                                                            |
| --------------------------- | --------------------------------------------------------------------------------- |
| absent / `pending`          | remove candidate; `failed` + failure; **keep run record**                         |
| `swapped`                   | rollback; `failed` + `PROMOTION_HEALTH` or interrupt; **keep run record**         |
| `health_ok`                 | **resume `finalizePromotion()`** + installation write — do NOT rollback (fix S15) |
| `finalized`                 | complete cleanup; `installation.json` sync if needed                              |

| Old `phase` (no run record) | Action                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `ready-to-promote`          | **Do not delete candidate** — surface `failed` with "pending promotion" or resume promote (fix S17) |
| `preparing`…`validating`    | remove candidate; failed                                                                            |

On startup: if `phase === failed`, broadcast to UI immediately (fix S21).

---

## 9. IPC + UI

### 9.1 New preload APIs

```ts
update.getRun(runId: string): Promise<UpdateRunRecord | null>
update.getUpdaterSnapshot(): Promise<AgentRuntimeSnapshot>
update.onUpdaterEvent(cb): () => void
update.getInstallation(): Promise<InstallationMetadata>  // for version display
```

### 9.2 `update-store` fixes

- `dismissed_for_session`: **module memory only**, never persist.
- `initialize()`: `detailsOpen = true` if `phase === failed` OR scheduled-quit OR mid-run phases.
- `startNow()`: handle result; keep dialog open on error.
- Subscribe `onUpdaterEvent` when `agent-running`.
- Poll or subscribe `getRun(run_id)` during promotion phases.

### 9.3 `UpdateProgressView` substeps

- Agent: label from `run.agent.status`.
- Promotion: three lines — swap / health / finalize from `run.promotion.status`.
- Failed: show `failure.code` + `failure.step`; link to log path.

---

## 10. New shared helpers to implement

### 10.1 `electron/update-run-record.ts` (new file)

```ts
getRunRecordPath(runId: string): string
readUpdateRunRecord(runId: string): UpdateRunRecord | null
writeUpdateRunRecordAtomic(runId: string, record: UpdateRunRecord): void
appendUpdateRunLog(runId: string, line: string): void
createRunId(): string
```

Atomic write: same pattern as `writeUpdateStateAtomic` in `update-state.ts`.

### 10.2 `electron/update-installation.ts` additions

```ts
readAndValidateInstallationAgainstActive(opts?: { repair?: boolean }): InstallationMetadata
```

- If active clean and HEAD ≠ `customized_head_commit`: repair if `repair: true` else throw `INSTALLATION_STALE`.
- Never infer `installed_version` from `package.json`.

### 10.3 `workspace-manager.ts` additions

```ts
normalizeActiveBeforeUpdate(activePath: string): Promise<void>
promoteCandidate(): PromotionReceipt  // was void
assertPostSwapInvariants(receipt: PromotionReceipt, candidateCommit: string): void
copyCandidateFromActive(): void  // uses md allowlist policy
```

---

## 11. Implementation order

Execute in order. Each phase should compile and pass tests before next.

### Phase 1 — Contracts + run record infrastructure

- [ ] Reshape `contracts/updates.ts` (§6.3)
- [ ] Add `electron/update-run-record.ts`
- [ ] Add `writeUpdateRunRecordAtomic` tests
- [ ] Add `readAndValidateInstallationAgainstActive`

### Phase 2 — Fix silent forensic loss (highest user pain)

- [ ] `check()` must not erase `failed` state (§7.6)
- [ ] All run aborts → `phase: failed` + `UpdateFailure` on run record (fix S5, S6)
- [ ] `appendUpdateRunLog` on every phase transition
- [ ] `removeCandidate` does NOT delete run record or log
- [ ] `update-store` cold-start shows `failed` (fix S21)

### Phase 3 — Remove context + slim upstream

- [ ] Replace `acquireUpdateContext` with `fetchUpstreamRef(candidate, manifest, repo)` — git fetch only
- [ ] Rewrite `buildUpdaterPrompt` (§7.7)
- [ ] Delete `updates/context/` on recovery migration pass
- [ ] Update `update-git.test.ts`

### Phase 4 — Candidate creation hardening

- [ ] `normalizeActiveBeforeUpdate` before copy
- [ ] Md allowlist in candidate copy
- [ ] Fix candidate `node_modules` symlink isolation before agent (fix S11)

### Phase 5 — Agent observability

- [ ] Coordinator callbacks from `agent.ts` updater events
- [ ] Real summary on `agent_end`
- [ ] Git dirty check before leaving `agent-running` (fix S8)
- [ ] Preload `onUpdaterEvent`, `getUpdaterSnapshot`, `getRun`
- [ ] UI substeps during agent phase

### Phase 6 — Promotion observability + recovery

- [ ] `promoteCandidate` → `PromotionReceipt` + invariant check
- [ ] Run record promotion substates
- [ ] Log `markActiveHealthy` false with reason
- [ ] Rewrite `recover()` per §8 (fix S15, S17)
- [ ] UI promotion substeps

### Phase 7 — Lean `state.json` migration

- [ ] Remove embedded manifest, from/to, validation_results, agent_summary, dismissed, progress_message, candidate_path, previous_path from `UpdateState`
- [ ] Migration on read: old `state.json` → lean + optional run record from leftover fields
- [ ] UI reads versions from installation + manifest files

### Phase 8 — Cleanup

- [ ] Remove dead `UpdateContext` path fields from contracts
- [ ] Update tests across `update-manager`, `workspace-manager`
- [ ] Run `bun run doctor && bun run lint && bun run build && bun run fmt`

---

## 12. `installation.json` reference

```json
{
  "installed_version": "0.1.0",
  "customized_head_commit": "abc...",
  "last_healthy_at": "2026-06-19T10:00:00Z"
}
```

| Field                    | Written when                                           |
| ------------------------ | ------------------------------------------------------ |
| `installed_version`      | Successful update completion only (not accept edit)    |
| `customized_head_commit` | Accept edit, successful update, HEAD repair when clean |
| `last_healthy_at`        | Same writers as HEAD                                   |

Create-once at `initializeWorkspaces()` from `app-template/installation.json` or `pipper.workspaceVersion`. **Never** re-derive from user-edited `package.json`.

---

## 13. `UpdatePhase` values (unchanged)

```
idle | available | scheduled | preparing | fetching-upstream | agent-running
| installing-dependencies | validating | ready-to-promote | promoting
| awaiting-health-check | completed | failed | rolling-back
```

Transitions defined in `electron/update-state.ts` `TRANSITIONS` — update if adding sub-phases is not desired; substates live in run record instead.

---

## 14. Testing requirements

| Scenario                             | Assert                                                 |
| ------------------------------------ | ------------------------------------------------------ |
| `check()` after `failed`             | `error` preserved                                      |
| Agent completes with no file changes | Fails at agent exit with `VALIDATION`, run record kept |
| `promoteCandidate` success           | Run record `swapped` before health                     |
| Health timeout                       | `rolled_back` + reason in log                          |
| Crash after `health_ok`              | Next recover finalizes, does not rollback              |
| `ready-to-promote` interrupt         | Candidate not silently deleted                         |
| Md allowlist                         | `blind.md` not in candidate                            |
| Hard reset dirty active              | Uncommitted changes gone before copy                   |

---

## 15. Related documents (optional reading)

| Doc                                    | Use                                         |
| -------------------------------------- | ------------------------------------------- |
| `blind.md`                             | Historical bug-hunt; superseded by §4 here  |
| `update.md`                            | Original MVP plan; diverges from this brief |
| `docs/agent-update-release-runbook.md` | Manifest authoring for releases             |

---

## 16. One-line summary

**Lean `state.json` + `runs/<id>.json` + `logs/<id>.log` hold truth; git ref replaces `context/`; hard-reset dirty `active/`; agent and promotion substates observable; recovery never silently deletes evidence or rolls back a health-confirmed promote; `check()` never erases failure.**
