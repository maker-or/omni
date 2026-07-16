# Worktree Support — Implementation Plan (Phase 1: Create)

## Goal

Let a user **create** an isolated git worktree ("workspace") off an existing
project — a separate working directory on its own branch, sharing the project's
git history — that a coding-agent session can later be bound to via
`session/new`'s `cwd`.

**In scope this phase:** create a worktree, seed its gitignored files (`.env*`),
run an optional per-project setup script, list existing worktrees, and bind a
thread's session to a worktree path. Plus a **path guard** that keeps an
agent's file operations inside its own worktree (see Threat model below).

**Out of scope this phase (deferred):** parallel-agent orchestration, the
tab-bar-under-tab-bar UX, the merge gate (test/review before merge), worktree
deletion/archival, `run`/`archive` scripts, port allocation, and OS-level
terminal sandboxing (see Threat model).

---

## Threat model (what "isolation" means this phase)

The goal is **cross-worktree isolation**: worktree A's agent must not read or
write into worktree B or the main checkout. It is *not* full-filesystem
sandboxing — we are not defending `/etc/passwd` etc. Because every worktree
lives under one root (`~/.pipper/worktrees/`), the boundary is a single subtree.

This phase defends against an **honest agent wandering** (a confused cwd, a
fat-fingered path), not a hostile/prompt-injected agent actively trying to
escape. Concretely:

- **ACP fs primitives** (`readTextFile`/`writeTextFile`) are *fully* guarded —
  a read/write aimed at a sibling worktree is rejected. This is a hard boundary.
- **Terminal** is **cwd-guarded only** (Option A): we jail *where* the command
  starts, but a spawned process can still `cd ../other-worktree`. An honest
  coding agent runs relative to cwd and won't; a hostile one could. We accept
  this gap for the phase and wire `terminalManager.create` with a **single
  injection point** so OS sandboxing (macOS `sandbox-exec`, deny writes outside
  the worktree root) can be slotted in later without a redesign. **Deferred:**
  that hard terminal boundary (Option B).

## Key decisions (and why)

1. **Git is the source of truth — no `worktrees` DB table.**
   `git worktree list --porcelain` already reports every worktree's path,
   branch, and HEAD, and git persists this in `.git/worktrees/`. A parallel
   SQLite table would be a second source of truth that desyncs the moment
   someone runs `git worktree remove` outside the app. List worktrees by
   parsing porcelain output live. The only DB change is a nullable
   `worktree_path` column on `threads` (app-only state git can't hold: which
   worktree a thread is bound to). Revisit a table only in the merge-gate phase,
   when there's genuine app-only state (test results, merge status).

2. **Copy gitignored files, never symlink.**
   A fresh worktree only contains tracked files; `.env*` is gitignored and
   absent. A symlink back to the main checkout's `.env` resolves *outside* the
   worktree root, so the containment jail (below) would reject the agent's own
   read of it — and if we exempted it, we'd hand the agent a writable path back
   into the main checkout (cross-contamination). So we **copy**. This matches
   Conductor's "files to copy" (copy, not link; default `.env*`; deps excluded).

3. **Two seed steps on opposite sides of the trust boundary.**
   - **File seed** (env copy): untrusted data, allowlist-driven, tightly
     contained. Copies gitignored files matching the project's include list.
   - **Setup script**: *trusted*, user-authored, runs once at create time, and
     *may* deliberately reach into the main checkout (e.g. symlink
     `node_modules`). It gets `WORKSPACE_PATH` / `ROOT_PATH` / `WORKSPACE_NAME`
     in its env. This is fine precisely because it is user-written and runs at
     create time — unlike the jailed agent.

4. **The guard's allowlist is a *set* of roots, fed by `additionalDirectories`.**
   ACP `additionalDirectories` (agent-advertised capability) declares the extra
   workspace roots for a session. Make the guard `sessionId → Set<root>` seeded
   from `cwd ∪ additionalDirectories`, so what we declare to the agent and what
   the guard permits are the same list. **The guard always seeds from `cwd`**
   regardless of capability advertisement — capability gating only controls
   whether the extra `additionalDirectories` roots get *added*, never whether the
   session is guarded at all (a non-advertising agent must not fall through to a
   no-op). Default `additionalDirectories` empty (worktree only). Note:
   `additionalDirectories` does **not** solve env loading — a spawned test
   process resolves `.env` from its own cwd, so the physical copy is still
   required.

---

## Existing code this builds on (verified)

- **Project concept** — `contracts/projects.ts` (`Project { id, path, name, icon }`),
  `electron/projects.ts` (`listProjects`/`getProject`/`createProject`, SQLite),
  tables in `electron/db.ts:86-109`. A project = "which repo"; a worktree is a
  lighter thing nested under it. Creating a worktree must NOT reload the window
  or touch `activeProjectId` (that's `launch:complete`, `main.ts:1140-1167`).
- **Git invocation pattern** — `electron/workspace-manager.ts` shells to bare
  `"git"` on `$PATH` via `execFile`/`execFileSync` (no binary resolution). NB:
  that module is the app's **self-update** machinery (its `active`/`candidate`
  library checkouts), *not* user worktrees — we borrow only its git/`execFile`
  idiom. Our `git worktree add` anchor is the user's `project.path` (a repo the
  user selected), which is a normal non-bare single-worktree repo — a valid
  anchor. This feature is otherwise greenfield.
- **Session cwd binding** — `agent-connection-manager.ts` `createThread`/
  `switchThread` call `sessionNew` with `project.path` as cwd (~lines 1015, 1052).
  Editor (~1407) and updater (~1668) sessions are internal — not user worktrees,
  not jailed the same way.
- **Jail target handlers** — `terminal/create` (`agent-connection-manager.ts:505-513`),
  `handleReadTextFile` (773-784), `handleWriteTextFile` (786-792) take
  agent-supplied `cwd`/`path` with no containment check today. All three ACP
  requests carry `sessionId` (unused for this). Handlers throw plain
  `new Error(...)`; the SDK wraps into a protocol error response.
- **IPC pattern** — `projects:create`/`projects:list` (`main.ts:1081-1109`),
  bridge in `preload.ts`, folder picker `dialog:pickDirectory` (`main.ts:1111-1123`).
- **Manager module shape** — `electron/subagents/subagent-manager.ts`: exported
  class, constructor options interface, injected deps, errors thrown as plain
  `Error`, host callback (not EventEmitter), IPC wired in `main.ts` `registerIpc()`
  (~line 1012).
- **Test conventions** — Vitest (`vitest.config.ts`, `environment: "node"`,
  includes `electron/**/*.test.ts`). Fixtures: `mkdtempSync(join(tmpdir(), "pipper-…-"))`,
  `execFileSync("git", ["init"], { cwd })`, commit with inline `GIT_AUTHOR_*`
  env, assert via `execFileSync("git", …)` + `existsSync`, cleanup in `afterEach`.

---

## Changes by layer

### 1. `electron/worktree-manager.ts` (new)
Stateless class, shape mirrors `subagent-manager.ts` (options interface, injected
deps, plain `Error`s, `"git"` via `execFile`). Methods:
- `createWorktree(projectPath, branch)` → ordered steps:
  1. `git worktree add <worktreePath> -b <branch>` off the base branch.
  2. **Seed files**: copy gitignored files matching the project's include list
     (see §5) into the worktree — allowlist, mode `0600`, destination resolved
     and asserted inside the worktree root, main-process `fs.copyFile` (never
     shell `cp`), don't follow a symlinked source, don't clobber blindly.
  3. **Setup script** (if project defines one): run once with `WORKSPACE_PATH` /
     `ROOT_PATH` / `WORKSPACE_NAME` in env. Trusted; may touch main checkout.
- `listWorktrees(projectPath)` → parse `git worktree list --porcelain` live
  (path, branch, HEAD). No caching.

**Worktree on-disk location (decided):** `<worktrees-root>/<project-slug>/<name>`.
- `<worktrees-root>` is `~/.pipper/worktrees` on macOS, with platform-appropriate
  equivalents elsewhere, honoring a `PIPPER_WORKTREES_PATH` override — mirroring
  how `getPipperLibraryPath()` handles the self-update library. This is a **home
  dotdir** (`~/.pipper`), distinct from the app's self-update library
  (`~/Library/pipper` on macOS) — no filesystem collision.
- `<project-slug>` is derived from the project **`id`** (stable, fs-safe), *not*
  the display `name`, so two like-named projects don't stomp each other.
- Outside the main working tree, so the worktree is never itself tracked.

**Branch naming (decided, Conductor style):** auto-generate a branch at create,
off the project's **default branch**; the agent renames it on first chat. No
user prompt in the create flow.

### 2. `electron/db.ts`
Add nullable `worktree_path TEXT` column on `threads` via the existing
`ensureColumn` migration pattern (`db.ts:41-46`). No new table.

### 3. `contracts/worktrees.ts` (new)
`Worktree { path, branch, head }` (shape of a parsed porcelain entry). No `id` —
git owns identity via path/branch.

### 4. `electron/agent-connection-manager.ts` — two independent changes
- **Path guard**: add `private readonly workspaceRoots = new Map<string, Set<string>>()`
  near the existing session maps (~lines 179-198). Populate in `createThread`/
  `switchThread`: root set = `cwd` always, `∪ additionalDirectories` only when the
  agent advertised the capability (never conditional on the *guard* existing —
  see Key decision 4). Add `assertWithinWorkspace(sessionId, path)`:
  - **containment check via `path.relative(root, resolved)`** — reject if it
    starts with `..` or is absolute (NOT `startsWith`, which lets `/proj-evil`
    escape root `/proj`); pass if any root in the set contains it.
  - throw `new Error("Path outside workspace")` on escape; no-op for sessions not
    in the map (editor/updater are internal, unguarded).
  - Call it in `handleReadTextFile` / `handleWriteTextFile` (on `params.path`)
    and `terminal/create` (on resolved `cwd`) before touching the fs. For the
    two fs handlers, avoid TOCTOU by operating on the path via **`O_NOFOLLOW`**
    (open-then-fstat on the fd) rather than resolve-then-reopen-by-path, so a
    symlink swapped in after the check can't redirect the op.
  - Clean up the map entry when the thread/session is torn down.
  - **Terminal caveat (Option A):** the `cwd` check only bounds where the command
    starts; a spawned process can still `cd` out. Route the spawn through a single
    wrapper point in `terminalManager.create` so a future OS sandbox (Option B)
    is a localized change. This is the accepted gap for the phase (Threat model).
- **Worktree binding**: when a thread has a `worktree_path`, use it as the
  `sessionNew` cwd instead of `project.path` (lookup before the existing
  `project.path` fallback at ~1015/1052). **Validate on bind**: if the stored
  path no longer resolves to a live worktree (`git worktree list` doesn't list
  it / dir gone), fall back to `project.path` and surface it — don't let
  `sessionNew` fail on a stale path (git remains source of truth; the column is
  a hint).

### 5. Include-list config (env copy)
Read the project's gitignored-file include list, precedence:
`.worktreeinclude` (repo root, gitignore syntax) → `file_include_globs` setting →
default `.env*`. **Custom patterns replace the default** (match Conductor;
predictable-but-surprising beats a hidden always-add). Never copy `node_modules`/
`dist` — those are the setup script's job.

### 6. `electron/main.ts` + `electron/preload.ts`
New IPC channels `worktrees:create`, `worktrees:list`, following the
`projects:create`/`projects:list` convention exactly. No auth/reload ceremony —
this is not a project switch. Add to `registerIpc()` and the preload bridge.

### 7. Renderer
- `src/store/worktree-store.ts` — zustand, mirrors `project-store.ts` shape
  (list, loading, error, create/list actions over the new IPC).
- A "Create Workspace" affordance near the project/thread listing
  (`src/components/others-view.tsx` / `agent-panel.tsx`): triggers create, and
  the resulting worktree becomes selectable as a thread's target directory.
  **This phase: creation + listing only** — no second tab bar (parallel-agent
  phase).

### 8. Tests — `electron/worktree-manager.test.ts` (new)
Follow `workspace-manager.test.ts` fixtures exactly: `mkdtempSync` temp repo,
`execFileSync("git", ["init"])`, initial commit, then assert `createWorktree`
produces a new dir on the expected branch (`git worktree list --porcelain`),
that seeded `.env` is copied with mode `0600`, and that a symlinked/escaping
source is not followed. Cleanup in `afterEach`.

---

## Implementation notes (as built)

- **`worktree-manager.ts` is plain exported functions**, not a class — it is
  stateless with no injected deps, so it matches `projects.ts`/`threads.ts`
  better than `subagent-manager.ts`. Kept electron-free (node builtins only) so
  it unit-tests without mocking the app.
- **`additionalDirectories` is not exposed by the ACP SDK in use**, so the path
  guard seeds purely from the session cwd (the always-on safety property in Key
  decision 4). The extra-roots union remains a documented extension point, not
  wired this phase — the guard is still never a no-op for a user session.
- **Added `listChildWorktrees` (realpath-aware main-tree exclusion).** git
  canonicalizes worktree paths, so `createWorktree` returns the realpath'd path
  and the main-tree filter compares realpaths — a plain string compare would
  leak the main tree when the project path contains a symlink.
- **TOCTOU hardening** uses `O_NOFOLLOW` on the read/write opens where available
  (skipped on Windows, which lacks the flag).

## Resolved decisions

- **On-disk location:** `~/.pipper/worktrees/<project-slug>/<name>` (macOS;
  platform-appropriate + `PIPPER_WORKTREES_PATH` override). No collision with
  `~/Library/pipper`. Slug from project `id`. (§1)
- **Branch naming:** Conductor style — auto-generate off the default branch,
  agent renames on first chat. (§1)
- **Include list:** replace-default (not merge) — matches Conductor. (§5)
- **Terminal containment:** Option A (cwd-guard + wrapper injection point);
  OS sandbox (Option B) deferred. (Threat model)

## Explicitly deferred

Parallel-agent orchestration · second tab bar UX · merge gate (test + review) ·
worktree deletion/archival + `archive` script · `run` script / port allocation ·
`worktrees` DB table (add when merge-gate needs app-only state) · **hard terminal
boundary via OS sandbox (Option B)** — slotted into the `terminalManager.create`
wrapper point when the hostile-agent case is worth the deprecated-API cost.
