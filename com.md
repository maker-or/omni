# Workspace-First Experience — Readiness Report

**Date:** 2026-07-16  
**Scope:** Person-in-the-loop users (workspace-first model). Fleet/dashboard for orchestrators is explicitly out of scope.  
**Target model (Option 2):** The title bar workspace picker is the primary navigation context. Everything visible and creatable in the shell — threads, terminals, agent cwd, file surfaces — belongs to the currently selected workspace. Switching workspace hides the previous workspace’s UI (tabs, terminals) and shows that workspace’s threads (or an empty state). Multiple threads per workspace are supported.

---

## Executive summary

**Verdict: Not ready.**

The application has a strong **backend and data foundation** for workspace-first navigation, but the **renderer and session orchestration layers** still behave like “project-first with an optional workspace hint.” The gap is not git, ACP, or worktree creation — it is how the UI scopes threads, tabs, terminals, and persisted state around a single authoritative workspace context.

| Layer                                    | Readiness     | Notes                                                   |
| ---------------------------------------- | ------------- | ------------------------------------------------------- |
| Git worktree operations                  | **Ready**     | Create, list, branch switch, live validation            |
| Thread ↔ worktree binding (DB)           | **Ready**     | `threads.worktree_path` column, validated on bind       |
| Agent session cwd per thread             | **Ready**     | `switchThread` / `createThread` resolve cwd correctly   |
| Path guard (ACP fs + terminal start cwd) | **Ready**     | Per-session workspace roots; terminal is cwd-guard only |
| File listing (`projects:listFiles`)      | **Ready**     | Follows `getActiveCwd()` (active thread)                |
| Title bar workspace UI                   | **Partial**   | Picker exists; not authoritative everywhere             |
| Workspace as navigation context          | **Not ready** | Dual state; no scoping                                  |
| Tab strip scoped to workspace            | **Not ready** | Global open tabs across workspaces                      |
| Terminals scoped to workspace            | **Not ready** | Partial restart on header switch only                   |
| Launch / restore workspace memory        | **Not ready** | Not persisted                                           |
| Multi-thread per workspace on switch     | **Not ready** | Switch hijacks to one canonical thread                  |
| All create-thread paths use workspace    | **Not ready** | Several paths omit worktree                             |
| Tests for orchestration                  | **Not ready** | Git logic tested; UX wiring is not                      |

**Rough overall:** ~65% data/agent layer, ~25% product experience as specified.

---

## Target invariants (the contract workspace-first must satisfy)

These are the rules the product should enforce once workspace-first is complete. Any surface that violates one of these is a gap.

1. **Single source of truth:** For a given project, `currentWorkspacePath` (main root or linked worktree path) is defined in one place and every consumer reads it.
2. **Workspace owns visibility:** The tab strip, thread menus, and thread creation only show threads whose `worktree_path` matches the current workspace (null = project root / “main”).
3. **Workspace owns creation:** Every new thread is created with the current workspace binding. No silent fallback to project root unless the user is on “main.”
4. **Workspace owns terminals:** New terminals spawn in `currentWorkspacePath`. Switching workspace hides or stashes the previous workspace’s terminal sessions and restores (or empties) the target workspace’s set.
5. **Workspace switch is a context change, not a thread lottery:** Switching workspace does not assume “one thread per worktree.” It enters a workspace and shows **all** open threads (and history) for that workspace.
6. **Thread tab switch stays inside workspace:** Selecting a thread tab only switches among threads in the **current** workspace. Cross-workspace thread access requires changing the workspace picker first (or an explicit “open in workspace X” flow).
7. **Restart coherence:** After app relaunch, header workspace, visible tabs, active thread, agent cwd, and terminal cwd all agree.
8. **Agent cwd follows active thread:** When the active thread changes within a workspace, agent and file surfaces follow that thread (already true today). The workspace picker does not change unless the user changes it.

---

## Target user flow (reference)

1. User opens the app → project restores → **workspace restores** (or defaults to main).
2. User sees only threads belonging to that workspace in the tab strip.
3. User clicks **+** → new thread is created in the **current workspace**.
4. User opens a terminal → cwd is the **current workspace**.
5. User switches workspace in the title bar → threads and terminals from workspace A **leave view**; workspace B’s threads appear (or empty state); terminals for B restore or start fresh per policy.
6. User may have **multiple threads** in workspace A; all remain visible while A is selected.

---

## What already exists (verified inventory)

### Git and worktree manager (`electron/worktree-manager.ts`)

- Creates worktrees under `~/.pipper/worktrees/<projectId>/<name>` (with `PIPPER_WORKTREES_PATH` override).
- Lists worktrees live from `git worktree list --porcelain` (no stale DB table).
- Includes project root as `isProjectRoot` entry for the title bar.
- Seeds gitignored files (`.env*` / `.worktreeinclude`), optional setup script.
- `listBranches` — local `refs/heads` only (documented as Phase 1).
- `switchWorktreeBranch` — checks out a branch inside a selected worktree.
- `isLiveWorktree` — validates stored paths; stale paths fall back to project root on bind.
- Unit tests in `electron/worktree-manager.test.ts`.

### Thread model (`contracts/threads.ts`, `electron/threads.ts`, `electron/db.ts`)

- `Thread.worktree_path`: absolute path to linked worktree, or `null` for project root.
- `createThread` persists `worktree_path`.
- `listProjectThreads` returns threads for a **project** (no worktree filter yet).
- `listThreads` / `listThreadsByIds` — global, no workspace filter.

### Agent connection manager (`electron/agent-connection-manager.ts`)

- `resolveThreadCwd(worktree_path, project.path)` — validated bind; stale → root.
- `getActiveCwd()` — active thread’s runtime cwd; documented as cwd source of truth for file listings.
- `switchThread` / `createThread` — session cwd and path guard registered from resolved cwd.
- `AcpSessionState.cwd` exposed to renderer via agent store snapshot.
- Workspace path guard on ACP `readTextFile` / `writeTextFile` and agent `terminal/create` start cwd.
- Terminal spawn is **Option A** (start cwd only; process can `cd` out) per `docs/worktree.md`.

### Worktree IPC (`electron/main.ts`, `electron/preload.ts`)

- `worktrees:list` — all worktrees including main.
- `worktrees:create` — create linked worktree.
- `worktrees:switch` — calls `activateProjectWorktree` (see gap below).
- `worktrees:listBranches` / `worktrees:switchBranch` — local branch operations inside selected worktree.

### `activateProjectWorktree` (`electron/main.ts`)

- Validates target path against live git list.
- Maps main root to `worktree_path = null`.
- Finds **first** thread matching project + worktree_path, or **creates one** thread if none.
- Calls `switchThread` on that thread.
- Opens the thread tab via `openThreadTab` (adds to global open set).
- Returns thread + worktree metadata.

### Renderer worktree store (`src/store/worktree-store.ts`)

- Loads worktrees and branches per project.
- `selectedWorktreePathByProject` — in-memory map, **not persisted**.
- Updated only on successful `switchWorktree` / `switchBranch` (header flows).
- `selectWorktree` exists but is **never called** from the codebase (dead API).

### Title bar UI (`src/App.tsx`)

- Workspace dropdown (list, create, switch).
- Branch dropdown (“Local branches · {workspace}”).
- Header label derived from `selectedWorktreePathByProject` with fallback to project root → displays as “main.”
- On workspace switch via header: `switchWorktree` IPC + `restartSessionsIn` for terminals if terminal view was active.

### Tab strip (`src/components/global-tab-bar.tsx`)

- Shows **all** open threads from `OpenTabsState.openThreadIds` (not filtered by workspace).
- Thread picker in project menu uses `useMergedProjectThreads` — **all project threads**, not workspace-scoped.
- `handleCreateThread` passes `selectedWorktreePathByProject[projectId]` as worktree binding (correct when header state is accurate).
- `handleSelectThread` → `selectThread` only; **does not** sync workspace store or terminals.
- `handleNewTerminal` uses `selectedWorktreePathByProject` or project root.
- Terminals cleared on **project** change, not workspace change (except header-driven `restartSessionsIn`).
- Effect auto-registers active agent thread into open tabs via `tabs.open` (global accumulation).

### Open tabs / launch state (`electron/open-tabs.ts`, `electron/launch-state.ts`)

- `LaunchState`: `projectId`, `threadId`, `activeThreadId`, `openThreadIds`, `threadSwitchHistory`.
- **No** `selectedWorktreePath` or per-workspace tab partition.
- Open tabs are a **single global list** per app install, not scoped by workspace.
- `activateFromLaunchState` restores project + preferred thread only.

### Terminals (`src/store/terminal-store.ts`, `electron/main.ts` PTY spawn)

- User terminals: renderer store holds sessions with per-session `cwd`.
- `restartSessionsIn(cwd)` kills all sessions, recreates with new cwd, **clears scrollback**.
- PTY spawn uses session cwd from renderer; falls back to home if path missing.
- No per-workspace session stash; no restore when returning to a workspace.

### File surfaces

- `projects:listFiles` uses `getActiveCwd()` — **follows active thread**, not header workspace directly. Correct when active thread matches workspace context; wrong when they diverge.
- Composer `@` file picker (`@/components/ui/input-message.tsx`) calls `projects:listFiles` — inherits same behavior.

### Diff view (`src/store/diff-store.ts`)

- Diffs keyed by `threadId`; resets when thread changes.
- No direct workspace coupling; acceptable if thread switches stay within workspace.

### Agent panel / orchestration (`src/components/agent-panel.tsx`)

- Subagent orchestration `createThread` **does not pass worktreePath** → new orchestration threads bind to **project root**, not current workspace.

### Legacy thread store (`src/store/thread-store.ts`)

- `createThread` calls `threads.create` **without** `worktreePath` argument.
- Still used in some code paths; creates root-bound threads if invoked.

### Pipper edit mode / companion (`electron/pipper-edit-session.ts`, companion IPC)

- Pipper visual edit baseline uses `getActivePath()` — the **app self-update workspace**, not user project worktrees. Intentionally separate; not part of user workspace-first, but document to avoid conflating the two “workspace” concepts.

### Analytics (`electron/analytics-schema.ts`)

- `worktree_created`, `thread_created` exist.
- No `workspace_switched` or workspace-scoped context on events yet.

### Documentation (`docs/worktree.md`)

- Phase 1 plan: create, list, bind thread, path guard.
- Explicitly deferred: second tab bar, parallel-agent orchestration UI, worktree deletion, merge gate.
- Renderer note references removed `others-view.tsx`; terminal logic now lives in `App.tsx` + `global-tab-bar.tsx`.

---

## Gap analysis (detailed)

### G1 — Dual source of truth for “current workspace”

**Today:** Header uses `selectedWorktreePathByProject` (Zustand, ephemeral). Agent/files use active thread’s cwd via `getActiveCwd()` / `AcpSessionState.cwd`.

**Problem:** These diverge after restart, thread-tab switches, and any path that does not go through the header workspace dropdown.

**Required:** One canonical `currentWorkspacePath` per project. Header, thread creation, terminal creation, and (on restore) launch state must read/write the same value. Optionally **derive** header display from active thread when inside a workspace-scoped shell, but picker changes must still drive context switches.

---

### G2 — Tab strip is not workspace-scoped

**Today:** `OpenTabsState.openThreadIds` is global. `global-tab-bar` renders all open threads regardless of `worktree_path`. `tabs.open` adds threads to the global list when workspace switching (`activateProjectWorktree`) without removing other workspaces’ tabs.

**Problem:** Violates “threads vanish when I switch workspace.” User sees threads from workspace A while workspace B is selected in the header (or vice versa).

**Required:**

- Filter displayed tabs: `thread.worktree_path` matches current workspace (normalize null vs project root path).
- On workspace switch: change visible subset; do not delete underlying open-tab records unless product policy says “close on hide” (recommend **hide, not close**).
- Consider persisting **per-project, per-workspace** open tab sets in launch state.

---

### G3 — Thread picker / project thread lists are not workspace-scoped

**Today:** `threads:listProject` returns all threads in project. Hover menu “Threads” in `global-tab-bar` shows merged project threads. `useMergedProjectThreads` filters by `project_id` only.

**Problem:** User can select a thread from another workspace from the menu, breaking workspace-first without an explicit workspace change.

**Required:**

- Backend: `listProjectThreads(projectId, worktreePath | null, limit, offset)` or client-side filter with stable normalization.
- UI: thread picker and any “recent threads” lists scoped to current workspace.
- Policy: clicking a thread from another workspace should either be impossible in UI or trigger workspace switch first (recommend **hide** cross-workspace threads entirely in v1).

---

### G4 — `activateProjectWorktree` assumes one canonical thread per worktree

**Today:** On `worktrees:switch`, finds **first** `listThreads()` match for `(project_id, worktree_path)` or creates **one** new thread.

**Problem:** Conflicts with multi-thread-per-workspace. Switching workspace jumps to a single thread instead of restoring the workspace’s tab set and last active thread in that workspace.

**Required:**

- Redefine workspace switch:
  1. Set `currentWorkspacePath`.
  2. Resolve visible open tabs for that workspace.
  3. Activate last-used thread in that workspace (from per-workspace memory) or first visible tab or empty state.
  4. Do **not** collapse to one thread per worktree.
- Creating threads in a workspace already supports multiples; switch logic must catch up.

---

### G5 — Thread tab switch does not update workspace context (and shouldn’t need to in v1)

**Today:** `selectThread` / `agent:switchThread` changes agent only. Header and terminals unchanged.

**Under workspace-first v1:** Thread tabs only show same-workspace threads, so this is less severe **after G2**. Until G2 ships, tab switch is a primary drift vector.

**Required:** Implement G2 first. Optionally sync header label from active thread’s `worktree_path` as a safety net.

---

### G6 — Terminals are not workspace-scoped

**Today:**

- New terminal: `selectedWorktreePathByProject` or project root.
- Workspace switch via header: `restartSessionsIn(newPath)` only if user used header handlers in `App.tsx`.
- Project switch: `clearSessions()`.
- No stash when leaving workspace A; returning to A does not restore prior terminals.

**Problem:** Violates “terminals belong to workspace” and “switching workspace changes terminal context.”

**Required (pick a policy):**

**Option A — Stash per workspace (recommended for in-loop users):**

- Key terminal sessions by `(projectId, workspacePath)`.
- On workspace switch: persist current sessions under old key (including scrollback if desired), load sessions for new key or empty.
- Kill/recreate PTY processes on restore (ids change) but optionally restore `history` string from stash.

**Option B — Always fresh on switch (simpler):**

- On workspace switch: `clearSessions()` or `restartSessionsIn`, no restore.
- Clear UX copy: “Switching workspace resets terminals.”

Either way, new terminals must use `currentWorkspacePath`, not a stale header map.

---

### G7 — Launch / restore does not remember workspace

**Today:** `readLaunchState` restores `projectId` + `threadId` / `activeThreadId` + global `openThreadIds`. `selectedWorktreePathByProject` starts `{}` every run.

**Problem:** After restart, header shows “main” while restored thread may be worktree-bound. Open tabs may include threads from multiple workspaces. New threads/terminals default to root.

**Required:**

- Extend `LaunchState` (or separate persisted store) with:
  - `selectedWorktreePathByProject: Record<projectId, path>` **or**
  - derive initial workspace from restored `activeThreadId`’s `worktree_path` (prefer derive + persist on explicit picker change).
- Optionally: `openTabsByProjectAndWorkspace` nested structure.
- On `activateFromLaunchState`: set workspace context before renderer paints header.

---

### G8 — Not all create-thread entry points bind workspace

| Entry point                                           | Passes current workspace?                            |
| ----------------------------------------------------- | ---------------------------------------------------- |
| `global-tab-bar` `handleCreateThread`                 | Yes, when `selectedWorktreePathByProject` is correct |
| `agent-panel` orchestration `createThread`            | **No** → project root                                |
| `thread-store` `createThread`                         | **No** → project root                                |
| `activateProjectWorktree` auto-create                 | Yes (explicit worktree)                              |
| `worktrees:create` then `switchWorktree` in `App.tsx` | Yes                                                  |

**Required:** Audit every `createThread` / `threads:create` / `agent:createThread` call site. Introduce a single helper: `getCurrentWorktreeBinding(projectId)` → `worktree_path | null` used everywhere.

---

### G9 — Project switch vs workspace switch interaction undefined in UI

**Today:** Changing project clears terminals; does not clear `selectedWorktreePathByProject` for other projects (map is per-project). Worktree store `clear()` does **not** clear `selectedWorktreePathByProject`.

**Required:**

- On project switch: restore that project’s last selected workspace from persistence (or main).
- Define whether open tabs are per-project only or per-project-per-workspace (recommend latter for target model).

---

### G10 — Branch switch within workspace

**Today:** `switchBranch` updates git branch in the **selected worktree path** and calls `activateProjectWorktree`. Branch change does not change workspace identity (path stable). Header selection updated.

**Status:** Mostly compatible. Ensure branch switch does not reset workspace-scoped tab sets. Surface raw git errors on dirty tree (known UX debt).

---

### G11 — Stale / deleted worktree handling

**Today:** `resolveThreadCwd` falls back to project root if worktree no longer live. Thread row still stores stale `worktree_path`.

**Required for workspace-first:**

- When listing threads for a workspace, define behavior for stale bindings (hide? show in “orphaned”? auto-rebind?).
- Empty workspace picker entry if git no longer lists path.
- User-visible warning when active thread degraded to root.

---

### G12 — Open-tab auto-registration fights workspace scoping

**Today:** `global-tab-bar` effect calls `tabs.open(snapshotThreadId)` whenever agent snapshot thread changes. This **accumulates** tabs globally.

**Problem:** Any thread ever activated tends to stay in open tabs, including other workspaces.

**Required:** Either scope `tabs.open` to current workspace bucket, or filter at display time and prune hidden workspace tabs from “open” on workspace switch (prefer structured per-workspace storage over prune).

---

### G13 — Agent-owned terminals (ACP) vs user terminals (PTY)

**Today:** Agent terminals via ACP are session/workspace guarded at spawn. User PTY terminals in renderer are separate.

**Required:** Document both in workspace-first spec. User terminals are the main gap (G6). Agent terminals follow thread cwd already.

---

### G14 — Subagents inherit orchestrator cwd

**Today:** Subagent spawn uses parent session cwd (or explicit override in args). If orchestrator thread is root-bound due to G8, subagents run in wrong tree.

**Required:** Fix orchestrator thread creation workspace binding; subagents then inherit correctly.

---

### G15 — Analytics and observability

**Today:** No workspace context on thread/workspace events.

**Recommended:** Add `workspace_path` / `is_main` to `thread_created`, `worktree_created`, and a new `workspace_switched` event for debugging drift reports.

---

### G16 — Test coverage

**Tested:** `worktree-manager.test.ts` (git operations), `terminal-store.behavior.test.ts` (`restartSessionsIn`), `open-tabs.test.ts` (ordering, not workspace), agent store behavior tests (createThread with worktree arg).

**Not tested:**

- `activateProjectWorktree`
- `getActiveCwd` integration with launch restore
- Workspace-filtered tab strip
- Terminal stash across workspace switch
- Launch state workspace persistence
- Multi-thread same workspace switch flow

---

## Behavioral conflicts (summary table)

| User expectation (workspace-first)         | Current behavior                                |
| ------------------------------------------ | ----------------------------------------------- |
| Title bar shows my real workspace          | Often shows “main” after restart                |
| Tab strip = threads in this workspace only | All open threads, all workspaces                |
| + creates thread in current workspace      | Usually yes via tab bar; orchestration paths no |
| Switch workspace → different tabs          | Jumps to one thread; old tabs still visible     |
| Switch workspace → terminals follow        | Only on header path; no stash                   |
| Multiple threads per workspace             | Supported on create; switch collapses to one    |
| Stay in sync when switching thread tabs    | Header/terminal drift until G2                  |

---

## Acceptance criteria (definition of done)

Workspace-first is **done** when all of the following hold in manual and automated tests:

1. Select workspace A → tab strip shows **only** A’s threads; create thread → `worktree_path` matches A.
2. Open terminal → cwd is A’s path; agent `getState().cwd` matches.
3. Switch to workspace B → A’s tabs **not visible**; B’s tabs shown or empty state; active agent thread is in B.
4. Create multiple threads in A; switch away to B and back to A → **both** threads still visible in A’s strip.
5. Restart app → header, tabs, active thread, and file picker agree on the same workspace.
6. No create-thread path silently binds to project root while a non-main workspace is selected.
7. Thread picker does not list threads from other workspaces.

---

## Explicitly out of scope (this report)

- Fleet / dashboard for parallel multi-worktree orchestration (future persona).
- Worktree deletion / archival (deferred in `docs/worktree.md`).
- Remote branch checkout in title bar (local only today).
- OS-level terminal sandbox (Option B in threat model).
- Pipper self-edit workspace (`getActivePath`) — separate from user project worktrees.
- `app-template/` mirror (edit root scope only per AGENT.md).

---

## Recommended implementation order

1. **Phase 0 decisions** (terminal policy, tab hiding).
2. **Phase 1** canonical + persisted workspace state (fixes restart drift immediately).
3. **Phase 2** filter threads + rework workspace enter (core UX).
4. **Phase 3** open tabs bucket model (makes hide/show correct across sessions).
5. **Phase 4–5** terminals + create-thread audit.
6. **Phase 6–7** polish and tests.

Estimated risk: **medium**. No schema migration beyond possible launch-state shape extension; main work is renderer orchestration and open-tabs redesign, not git or ACP.

---

## Bottom line

The application is **not ready** for workspace-first as specified, but it is **well positioned** to get there: threads already carry `worktree_path`, the agent already runs sessions in the correct cwd per thread, and the title bar already has workspace UI wired to partial backend flows.

What is missing is treating workspace as the **navigation shell** — scoping tabs, terminals, persistence, and switch orchestration — instead of a **label** that only updates when the user uses one specific dropdown path.

Implementing the phases above turns the existing foundation into the person-in-the-loop experience without waiting for the orchestrator dashboard.
