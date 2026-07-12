# Blindspots and Real Bugs: Pattern Analysis

Analysis of omni/Pipper codebase against concurrency, durability, and state-management patterns (P1-P12).

---

## P1: Single Writer Principle Violations

**Issue: Multiple concurrent writers to shared state files**

- `electron/open-tabs.ts`: Uses `enqueueMutation()` to serialize mutations to `launch-state.json` ✓
- `electron/threads.ts`: Direct writes to thread database without serialization queue ✗
  - `getThread()`, `createThread()`, `updateThread()`, `deleteThread()` are called from IPC handlers (`tabs:open`, `tabs:close`, `agent:switchThread`) which can fire concurrently
  - Two `updateThread()` calls can both read, modify, and write back, with the second write silently overwriting the first
  
- `src/store/agent-store.ts`: Multiple stores (`agent-store`, `thread-store`, `diff-store`, `update-store`) each maintain independent RAM copies
  - `applyThreadTitleUpdate()` patches three different caches (queryClient, useThreadStore, open-tabs) — if one fails mid-flight, caches diverge
  - No transactional guarantee across the three mutations

- `src/store/pipper-store.ts`: 
  - Local state (`editMode`, `overlayVisible`, `processingId`) can be set via `setProcessingId()` OR via `syncFromBroadcast()` 
  - Race: emit `setProcessingId()` locally, then `syncFromBroadcast()` arrives with stale value, local value is lost

**Risk**: Lost updates. Concurrent tab operations can silently drop thread state changes.

---

## P2: RAM vs Disk Truth Problem

**Issue: RAM state outlives disk; divergence undetected**

- `LauncherUpdateManager.ts`: In-memory `state` field (line 72) is the hot copy, persisted to `this.statePath` only on certain state transitions
  - `recover()` reads from disk at startup, but if app crashes mid-flight with unsync'd RAM state, recovery path re-derives from corrupted disk file
  - Example: `setState()` called with `persist=false` (line 122), state lives in RAM but next restart won't see it
  
- `UpdateManager.ts`: Similar pattern — in-memory `state` (line 197) updated via `persist()` which writes atomically, but:
  - `this.cancelled` flag (line 199) is only in RAM; if app crashes during cancellation, flag is lost and update resumes on restart
  - `this.healthResolve` (line 202) is a Promise in RAM; loses the callback on crash

- `agent-store.ts`: Zustand store holds `state`, `slice`, `subagentRuns` in RAM
  - These are NOT persisted to disk; if app crashes mid-flight, all unsaved agent state is lost
  - Recovery depends on re-fetching from agent via `getUpdaterState()` or `getUpdaterSnapshot()`, but agent process may have exited

**Risk**: State loss on crash. User sees "ready" in UI but disk has different phase. Silent corruptions if recovery assumes consistent state.

---

## P3: Destructive Operations Mid-Flight

**Issue: `normalizeActiveBeforeUpdate()` runs `git reset --hard` with no guard**

- `workspace-manager.ts` line 325-327:
  ```ts
  export async function normalizeActiveBeforeUpdate(activePath = getActivePath()): Promise<void> {
    await execAsync("git reset --hard HEAD && git clean -fd", { cwd: activePath });
  }
  ```
  - Called from `update-manager.ts` during "preparing" phase
  - No check: is the active workspace locked by a running agent? Is an editor currently writing to it?
  - Agent process spawned by `agent-connection-manager.ts` runs CWD = active workspace; git reset can corrupt in-flight file operations
  - No fence/busy-gate before invoking this

**Risk**: Corrupt workspace if agent or user editor is actively writing during normalization. File locks may remain, workspace unrecoverable.

---

## P4: IPC Validation + Busy Gate Missing

**Issue: No sender validation; no pre-update busy check**

- `main.ts`: IPC handlers for update operations (`app:checkForUpdates`, `app:startUpdate`, etc.) don't validate:
  - Are they called only from the main window?
  - Is there a running update already? (Check exists in UpdateManager but not before calling into it)
  - Are there unsaved edits in the active workspace?
  
- `agent-connection-manager.ts`: Spawns agent via `resolveAgentSpawn()` but doesn't check:
  - Is a workspace update in progress? 
  - Is the workspace locked for normalization?

- No "busy gate" blocks concurrent operations:
  - Update preparing phase can start while workspace is being actively modified by agent
  - Two windows could try to promote candidate simultaneously

**Risk**: Race between editor/agent and workspace updates. Update operation invalidates assumptions about workspace state.

---

## P5: State Cleanup on Close/Delete

**Issue: Partial rollback on errors**

- `agent-connection-manager.ts` line 965-992 (`deleteThread`):
  ```ts
  async deleteThread(threadId: string): Promise<void> {
    // ...
    if (this.connection && sessionId) {
      try {
        await this.connection.agent.request(acp.methods.agent.session.delete, { sessionId });
      } catch {
        // best effort  ← SILENT SWALLOW
      }
    }
    this.sessions.delete(threadId);  // ← Continues even if remote delete failed
    removeThreadRow(threadId);
  }
  ```
  - If remote agent refuses to delete (e.g., still streaming), function continues
  - Local session is deleted, but remote session lives on, orphaned
  - Next time session is referenced, it will error or reconnect incorrectly

- `LauncherUpdateManager.recover()` line 137-150:
  - Cleans up `.partial` files but doesn't verify they're actually removable
  - If file is still locked by another process, `rmSync(..., { force: true })` succeeds silently without actually removing

**Risk**: Orphan remote sessions. Orphan download files. State inconsistency on failed delete.

---

## P6: State Distribution Across Windows

**Issue: Different windows can have divergent state**

- Pipper overlay state (`pipper-store.ts`):
  - Each window has its own Zustand instance
  - `syncFromBroadcast()` syncs from IPC, but race condition:
    - Window A calls `setProcessingId('task1')` (local update)
    - Electron main broadcasts `processingId: 'task2'` 
    - Window A receives broadcast AFTER its own update, overwriting its value
    - No deduplication; later write wins, not latest intent
  
- Open tabs state (`open-tabs.ts`):
  - Uses `enqueueMutation()` to serialize disk writes ✓
  - But renderer windows cache this state in React queries
  - If main process mutation succeeds but broadcast to renderer fails/delays, windows show stale active thread

**Risk**: Two windows show conflicting active tab. Overlay state out of sync between windows. User edits get routed to wrong location.

---

## P7: File/SQL Ordering Across Crash Boundaries

**Issue: Promotion assumes consistent directory state**

- `workspace-manager.ts` line 352-374 (`promoteCandidate`):
  ```ts
  renameSync(active, previous);        // A lives
  try {
    renameSync(candidate, active);     // B → A
  } catch (error) {
    renameSync(previous, active);      // Rollback: lives → A
    throw error;
  }
  ```
  - Atomic at filesystem level, but assumptions:
    - No process holds open files in `active` during swap
    - `previous` directory is truly empty on entry (asserted but not checked during operation)
    - Agent process that was reading/writing `active` correctly releases all handles
  
- `recoverInterruptedPromotion()` line 408-419:
  - If app crashes between `renameSync(active, previous)` and `renameSync(candidate, active)`, function checks which dirs exist and reconstructs state
  - But if agent process still holds FD to old `active` path (now `previous`), promoting `candidate` creates inconsistent state: agent reading old workspace while prod uses new

**Risk**: Agent reading stale workspace during recovery. File descriptors point to wrong workspace. Workspace corrupted if process doesn't release locks before promotion.

---

## P8: "Ready" Semantics Unclear

**Issue: `ready-to-promote` phase doesn't guarantee background work finished**

- `update-manager.ts`: State machine enters `ready-to-promote` after validation (line 477 via `validateCandidate()`)
  - But validation is incomplete:
    - Dependencies are installed (`prepareCandidateDependencies()` in "installing-dependencies" phase)
    - Candidate workspace is validated (`validateCandidate()` in "validating" phase)
    - But no check: has the installation finished syncing? Are all files on disk?
    - `fsyncSync()` is used in atomic writes (update-state.ts, update-installation.ts) but NOT in workspace file operations
  
- `awaitHealthCheck()` phase (line ~600) attempts to verify "ready", but:
  - Calls `this.options.agent.isEditorBusy()` to check if editor is idle
  - But no guarantee that background tasks (git, downloads, dependency installation) completed
  - Editor "not busy" ≠ "all I/O finished"

**Risk**: Promote while background tasks still running. Disk partially written, next read sees incomplete state.

---

## P9: Metadata Files Not Included in Dirty/Update Gates

**Issue: State files excluded from consistency checks**

- `update-state.ts`, `update-installation.ts`: Define atomic writers for `state.json` and `installation.json`
  - These files are the source of truth for recovery
  - But `normalizeActiveBeforeUpdate()` does `git reset --hard && git clean -fd`
  - Neither of these are git-tracked, so they survive normalization
  - However, `launch-state.json` (threads, active tabs) IS in the workspace but NOT in `.gitignore`, so reset COULD wipe it
  
- `dirtyFilesFromStatus()` in `update-candidate-diagnostics.ts`:
  - Checks `git status` for dirty workspace files
  - Does NOT check if `installation.json` or update `state.json` are out of sync with workspace

**Risk**: Metadata files can diverge from workspace during an update. Restart sees inconsistent `state.json` vs actual workspace content.

---

## P10: Update + Workspace Managers Share No Mutex

**Issue: `workspace-manager` and `update-manager` run concurrently without coordination**

- `update-manager.ts` calls:
  - `normalizeActiveBeforeUpdate()` during prepare phase
  - `promoteCandidate()` during promotion phase
  - `finalizePromotion()` or `rollbackPromotion()` after health check
  
- Meanwhile, no mechanism prevents:
  - `agent-connection-manager.ts` spawning a new agent (which activates the active workspace)
  - A second update check/refresh happening
  - A manual workspace cleanup or recovery
  
- `StartNow()` checks `if (this.running)` but this is a simple flag, not a queue:
  - Call startNow() twice rapidly → second call returns cached Promise
  - But what if third call arrives while first Promise still settling? No queueing, it gets the second Promise which is also in-flight

**Risk**: Agent starts mid-update. Workspace normalization races with editor startup. Two updates overlap.

---

## P11: Spec vs Implementation Gap

**Issue: Recovery functions assume state that may not match disk**

- `LauncherUpdateManager.recover()` line 137-150:
  - Spec: "Recover state from disk"
  - Implementation: Reads `state.json`, then checks if downloaded file path is "managed"
  - Gap: If `state.json` is corrupted/truncated, `readLauncherUpdateState()` returns default state, losing prior progress
  - Gap: If `downloaded_path` points to a file that's been manually deleted, recovery tries to verify a non-existent file without fallback

- `UpdateManager.constructor()` line 206-231:
  - Reads `state.json` on startup
  - If corrupted, renames file and creates idle state with error message
  - Gap: Message says "Recovered unreadable workspace update state" but doesn't clarify what was LOST (run ID, progress, manifest)

- Promotion recovery (`recoverInterruptedPromotion()` line 408):
  - Spec: "Restore workspace to consistent state after crash"
  - Implementation: Checks which dirs exist (`active`, `previous`, `candidate`) and restores based on that
  - Gap: Doesn't check if agent process still holds file locks on the dirs being moved
  - Gap: Doesn't verify git HEAD of restored workspace matches what we expect

**Risk**: Silent data loss. Recovery succeeds but is incomplete. Next operation fails due to unmet recovery preconditions.

---

## P12: Cascade Delete Not Implemented

**Issue: Deleting a resource doesn't reliably cascade cleanup**

- `deleteThread()` in `agent-connection-manager.ts`:
  - Sends `session.delete` to remote agent (line 973)
  - Catches errors and continues (line 976: `// best effort`)
  - Deletes local session map entry and thread row
  - Gap: If remote delete fails, orphan session remains in agent, consuming resources
  - Gap: Next time user interacts with agent (new thread), agent still has old session context

- Thread deletion doesn't cascade to:
  - Related tabs (closed via `closeThreadTab()` separately, not atomically)
  - Subagent runs (`subagentRuns` in agent-store are not cleaned up)
  - Agent session state (remote delete is attempted but failures are swallowed)
  - Terminal instances tied to that thread (if any)

- Workspace deletion (candidate removal):
  - `removeCandidate()` calls `rmSync(..., { recursive: true, force: true })`
  - But what if workspace has open file handles? Force removes anyway, leaving orphan FDs
  - No cleanup of associated state (update state, run records, transcripts)

**Risk**: Orphan sessions/resources. Memory leaks in long-running app. Inconsistent agent state.

---

## Summary Table

| Pattern | File(s) | Severity | Root Cause |
|---------|---------|----------|-----------|
| P1 | `threads.ts`, `agent-store.ts`, `pipper-store.ts` | High | No serialization queue; multiple concurrent writers |
| P2 | `LauncherUpdateManager`, `UpdateManager`, `agent-store` | High | RAM-only state; no persistence for some flags |
| P3 | `workspace-manager.ts` + `update-manager.ts` | Critical | `git reset --hard` with no busy gate |
| P4 | `main.ts`, `agent-connection-manager.ts` | High | No sender validation; no pre-update workspace lock check |
| P5 | `deleteThread()` in `agent-connection-manager.ts` | High | Silent swallow on remote delete failure; orphan session |
| P6 | `pipper-store.ts`, `open-tabs.ts` broadcast | Medium | Race on `syncFromBroadcast`; late arrival overwrites local intent |
| P7 | `promoteCandidate()` + agent process lifetimes | High | Assumes all file handles released; no verification |
| P8 | `update-manager.ts` "ready-to-promote" phase | Medium | No fsync guarantee; background I/O may still be in-flight |
| P9 | Metadata files in `updates/`, not in dirty gates | Medium | `installation.json`, `state.json` not checked for sync |
| P10 | `update-manager.ts` + `workspace-manager.ts` | High | No shared mutex; concurrent agent spawn + workspace normalization |
| P11 | Recovery functions in both managers | Medium | Spec/impl gap; recovery succeeds but incomplete |
| P12 | `deleteThread()`, `removeCandidate()` | High | Cascade cleanup attempted but best-effort; orphan resources |

---

## Recommended Fixes (No Implementation)

1. **P1**: Add global mutation queue (like `open-tabs.ts`) for all thread/store writes. Consider single-instance SQLite instead of JSON files.

2. **P2**: Persist all mutable state atomically (include `cancelled`, `healthResolve`) or make recovery idempotent.

3. **P3**: Add pre-normalization validation: check no agent process owns workspace, no file locks, no pending I/O. Use advisory lock file.

4. **P4**: Require pre-update checks: is workspace locked? Is editor active? Busy gate all conflicting operations.

5. **P5**: Fail hard if remote delete fails; don't continue local deletion until remote succeeds.

6. **P6**: Use version stamps or causal tracking instead of "last write wins" broadcast.

7. **P7**: Before promotion, verify all processes have released workspace file handles (lsof check or advisory lock).

8. **P8**: Add fsync() calls after dependency install. Don't mark "ready" until all background I/O acknowledged.

9. **P9**: Include metadata files in consistency gates. Or: move them outside workspace (sibling dirs).

10. **P10**: Shared mutex or queue: UpdateManager and workspace spawn both route through one serializer.

11. **P11**: Write recovery spec as comments. Add assertions that verify recovered state (git refs, file counts, hash matches).

12. **P12**: Replace `// best effort` with explicit error propagation or automatic retry with backoff.
