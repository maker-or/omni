# Worktree Support — Implementation Plan (Phase 1: Create)

## Goal

Let a user **create** an isolated git worktree ("workspace") off an existing
project — a separate working directory on its own branch, sharing the project's
git history — that a coding-agent session can later be bound to via
`session/new`'s `cwd`.

**In scope this phase:** create a worktree, seed its gitignored files (`.env*`),
run an optional per-project setup script, list existing worktrees, and bind a
thread's session to a worktree path. Plus the security containment ("jail") that
makes an agent stay inside its worktree.

**Out of scope this phase (deferred):** parallel-agent orchestration, the
tab-bar-under-tab-bar UX, the merge gate (test/review before merge), worktree
deletion/archival, `run`/`archive` scripts, and port allocation.

---

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

4. **The jail's allowlist is a *set* of roots, fed by `additionalDirectories`.**
   ACP `additionalDirectories` (agent-advertised capability) declares the extra
   workspace roots for a session. Make the jail `sessionId → Set<root>` seeded
   from `cwd ∪ additionalDirectories`, so what we declare to the agent and what
   the jail permits are the same list. Default `additionalDirectories` empty
   (worktree only). Note: `additionalDirectories` does **not** solve env loading
   — a spawned test process resolves `.env` from its own cwd, so the physical
   copy is still required.

---

## Existing code this builds on (verified)

- **Project concept** — `contracts/projects.ts` (`Project { id, path, name, icon }`),
  `electron/projects.ts` (`listProjects`/`getProject`/`createProject`, SQLite),
  tables in `electron/db.ts:86-109`. A project = "which repo"; a worktree is a
  lighter thing nested under it. Creating a worktree must NOT reload the window
  or touch `activeProjectId` (that's `launch:complete`, `main.ts:1140-1167`).
- **Git invocation pattern** — `electron/workspace-manager.ts` shells to bare
  `"git"` on `$PATH` via `execFile`/`execFileSync` (no binary resolution). The
  active workspace is a normal non-bare single-worktree repo (`git init`, no
  `--bare`, at `workspace-manager.ts:227`) — a valid `git worktree add` anchor.
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

Worktree path location: a stable per-project dir (e.g. under the project or a
managed `worktrees/` sibling) — decide before implementing; must be outside the
main working tree so it isn't itself tracked.

### 2. `electron/db.ts`
Add nullable `worktree_path TEXT` column on `threads` via the existing
`ensureColumn` migration pattern (`db.ts:41-46`). No new table.

### 3. `contracts/worktrees.ts` (new)
`Worktree { path, branch, head }` (shape of a parsed porcelain entry). No `id` —
git owns identity via path/branch.

### 4. `electron/agent-connection-manager.ts` — two independent changes
- **Jail**: add `private readonly workspaceRoots = new Map<string, Set<string>>()`
  near the existing session maps (~lines 179-198). Populate in `createThread`/
  `switchThread` (roots = `cwd ∪ additionalDirectories`, gated on the agent
  advertising the capability). Add `assertWithinWorkspace(sessionId, path)` —
  `realpath`, prefix-check against the session's root set, throw
  `new Error("Path outside workspace")` on escape; no-op for sessions not in the
  map (editor/updater). Call it in `terminal/create` (on resolved `cwd`),
  `handleReadTextFile`, `handleWriteTextFile` (on `params.path`) before touching
  the fs. Clean up the map entry when the thread/session is torn down.
- **Worktree binding**: when a thread has a `worktree_path`, use it as the
  `sessionNew` cwd instead of `project.path` (lookup before the existing
  `project.path` fallback at ~1015/1052).

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

## Open questions

- Worktree on-disk location (under project vs. managed sibling dir).
- Auto-name the branch, or prompt the user, at create time? (Conductor
  auto-creates then the agent renames on first chat.)
- Merge-with-default vs. replace-default for the include list (plan says replace;
  confirm).

## Explicitly deferred

Parallel-agent orchestration · second tab bar UX · merge gate (test + review) ·
worktree deletion/archival + `archive` script · `run` script / port allocation ·
`worktrees` DB table (add when merge-gate needs app-only state).
