# OpenCode explore subagent: storage

This is the preserved subagent report. Read [the primary review and evidence classifications](README.md) before treating individual claims as accepted findings.

I have completed a very thorough read of the assigned domain (plus the relevant tests/benches and the uncommitted diffs). No files were modified. Below, `REPO` = `/Users/harshithpasupuleti/.pipper/worktrees/ac746c8c-5b7c-4167-90bc-601ca03b4988/performance`.

---

## NEW findings

### N1 — One failed snapshot write permanently disables snapshot persistence for the whole app session, and DB compaction can trigger it

- Exact source:
  - `REPO/electron/agent-connection-manager.ts:713-718` — the per-thread write chain's `.catch` sets `this.snapshotWritesDisabled = true` unconditionally, for any error, for any thread.
  - `REPO/electron/agent-connection-manager.ts:656-661` and `673-683` — every later `scheduleSnapshot`/`queueSnapshotWrite` early-returns when `snapshotWritesDisabled` is set. There is no retry and no per-thread scoping.
  - `REPO/electron/thread-snapshot-store.ts:319-328` — the store's `write()` rethrows after cleaning up its temp/final files, feeding that catch.
  - `REPO/electron/db.ts:162-173` — all snapshot writes go through the single main-process `getDb()` connection (`thread-snapshot-store.ts:134-136`; manager constructs the store without a `database`, line 257-259), with `busy_timeout = 5000`.
  - `REPO/electron/database-compaction.ts:20-27` — the compaction worker opens its own connection with `busy_timeout = 1000` and runs `VACUUM` then `PRAGMA wal_checkpoint(TRUNCATE)`.
- Trigger sequence: user triggers `storage:compactDatabase` (`REPO/electron/main.ts:1985-1991`) while a debounced snapshot write is running. `VACUUM` holds an exclusive DB lock; the snapshot `INSERT … ON CONFLICT` on the main connection waits up to 5000 ms then throws `SQLITE_BUSY` → the write chain catch disables snapshots for the rest of the process. The same permanent-disable path is reachable from any transient error (disk full, missing base sidecar `ENOENT`, or a Windows `EBUSY`/`EPERM` from `unlink` at `thread-snapshot-store.ts:304-306`/`415-417`, which `ignoreMissing` does not swallow).
- Cost/ownership: persistence of _all_ threads is lost silently until app restart; the UI still works because the runtime is in memory, so the failure is invisible except for a `console.warn`. A single transient event has an app-global, permanent blast radius.
- Evidence level: **inference** (composed from code-read). The lock contention itself is **test-backed**: `REPO/scripts/verify-compaction-contention.mjs:21,55-60` deliberately reproduces the `locked/busy` write failure and then retries with `busy_timeout=5000`. No test asserts the app's `snapshotWritesDisabled` behavior (I searched all `*.test.ts`; zero references).
- Safeguards already present: WAL + `busy_timeout` on all connections (`db.ts:172-173`, `monitor/worker.ts:76-78`), `VACUUM`/checkpoint run in a worker thread, compaction requests deduped (`main.ts:1985-1991`), store cleans its temp file on failure (`thread-snapshot-store.ts:319-328`).
- Regression check that would catch a fix: unit-test `queueSnapshotWrite` with a `snapshotStore.write` that rejects once, then assert a subsequent write for a _different_ thread still persists (today `snapshotWritesDisabled` makes it a no-op), and/or assert `SQLITE_BUSY` is retried rather than poisoning the global flag.

### N2 — `launch-state.json` is written non-atomically and a torn write silently resets all navigation/workspace state

- Exact source:
  - `REPO/electron/launch-state.ts:76-80` — `writeLaunchState` calls `writeFile(file, JSON.stringify(state, null, 2))` directly, no temp-file+rename.
  - `REPO/electron/launch-state.ts:69-73` — `readLaunchState` catches _every_ parse/read error and returns `DEFAULT_STATE`, so a truncated file is indistinguishable from "no state".
- Trigger sequence: process kill/power loss/crash during a `writeFile`, leaving partial JSON. Next launch (`readLaunchState`) returns defaults → `projectId`, `openThreadIds`, `activeThreadId`, `threadSwitchHistory`, and `selectedWorktreePathByProject` are all lost together. This is the single persisted source of truth per its own doc comment (`launch-state.ts:15-21`).
- Cost/ownership: all workspace navigation context is owned by one small JSON blob rewritten in full on every mutation; losing it is a total, not partial, navigation reset.
- Evidence level: **code-read only**. Tests cover ordering/serialization (`REPO/electron/launch-state.test.ts:54-73`) and parsing (`75-80`) but never torn-write recovery.
- Safeguards already present: the in-process mutation queue (`launch-state.ts:88-97`) serializes concurrent read-modify-write so no _in-process_ lost update occurs (test-backed by `open-tabs.test.ts:211-236`).
- Regression check: assert `writeLaunchState` writes to `*.tmp` then `rename`s (the codebase already has this idiom in `REPO/electron/remote-requests.ts:67-68` and `writeLauncherUpdateStateAtomic` used at `REPO/electron/launcher-update-manager.ts:149,186,207`), or a test that leaves a truncated file and asserts state recovers rather than resetting when a backup exists.

### N3 — The snapshot debounce has no max-wait and no-ops during active turns, so persistence can be starved indefinitely

- Exact source:
  - `REPO/electron/agent-connection-manager.ts:663-668` — each `scheduleSnapshot` `clearTimeout`s the existing per-thread timer and sets a fresh 2000 ms timer. Events arriving faster than every 2 s keep resetting it; there is no max-age/force-flush.
  - `REPO/electron/agent-connection-manager.ts:673-683` — `queueSnapshotWrite` returns a resolved promise (no write) whenever `slice.isStreaming || promptInFlight || loadingSessionThreads.has(...)`. Nothing forces the dirty snapshot out during a long streaming turn.
  - Only `settleRuntime` (`762-766`), `flushThreadSnapshot` (`736-743`) and `dispose`/`flushAllSnapshots` (`745-750`, called at `3212`) force a write.
- Trigger sequence: a long turn plus frequent out-of-band settled updates (e.g., background tool-call flushes) — the timer keeps sliding and the last persisted generation can lag arbitrarily behind, then a crash loses everything since the previous flush.
- Cost/ownership: durability latency is unbounded and driven by external event cadence; cheapest fix is a max-wait/coalescing flush rather than disabling the debounce.
- Evidence level: **code-read/inference**. No test exercises sustained-timer behavior.
- Safeguards already present: debounce itself limits write amplification; `snapshotDirty` gate (`659`); settle/dispose flush.
- Regression check: fake-timer test firing a dirty update every 1 s for >10 s and asserting at least one write fired (a max-wait would pass; today it would not until activity stops).

### N4 — Redundant persistence: one thread switch performs ≥3 full launch-state read-modify-write cycles, and open-tabs reads the same file twice per mutation

- Exact source:
  - `REPO/electron/agent-connection-manager.ts:2495-2503` — `activateThread` calls `updateWorkspaceSelection(...)`, `updateLaunchSelection(...)`, and `recordThreadSwitch(...)` as three independent queued mutations.
  - `REPO/electron/launch-state.ts:118-129` and `135-149` — each mutation does `readLaunchState()` then a full `writeLaunchState`.
  - `REPO/electron/open-tabs.ts:88-108` — `readOpenTabsState()` reads launch-state, then `writeOpenTabsState()` reads launch-state _again_ (`98`) before writing; every mutation (`123-134`, `147-168`, `200-216`, `218-232`) pays two reads + one full pretty-printed rewrite.
- Trigger sequence: any tab switch / open / close (IPC handlers `REPO/electron/main.ts:2597-2626`; renderer invocations at `REPO/electron/preload.ts:336-339`).
- Cost/ownership: per switch roughly 5 file reads and 3 full-file writes of a growing JSON (source-map of `selectedWorktreePathByProject` plus tab history up to 100). The three writes are conflict-free and could be coalesced into one mutation.
- Evidence level: **code-read only** (call counts are exact; no benchmark asserts write counts).
- Safeguards already present: the shared queue prevents lost updates; `normalize` compacts IDs (`open-tabs.ts:75-86`).
- Regression check: spy on `readLaunchState`/`writeLaunchState` and assert per-switch call counts; a coalescing fix should reduce 3 writes → 1 without breaking the existing ordering tests.

### N5 — Sidecar generation readers have no generation guard; a concurrent read can outlive unlink/eviction, and the memory cache returns snapshots without checking the file still exists

- Exact source:
  - `REPO/electron/thread-snapshot-store.ts:208-209` — `readPayloadEntries` opens `createReadStream(snapshot.payloadPath)` by path, not by a validated generation handle.
  - `REPO/electron/thread-snapshot-store.ts:304-306` and `415-417` — a newer write unlinks the previous generation, and `enforceLimit` unlinks evicted generations.
  - `REPO/electron/thread-snapshot-store.ts:140-152` — `load()` returns a memory-cached `LoadedThreadSnapshot` (with its `payloadPath`) without verifying the row/file still exists on disk.
  - `REPO/electron/agent-connection-manager.ts:561-577` — `getToolCalls` calls `loadPayloads` on `runtime.snapshotPayloadSource`, which is not serialized behind `snapshotWriteChains`.
- Trigger sequence: a `loadPayloads`/base-sidecar stream is open for a thread while another write/`enforceLimit` unlinks that path. On POSIX an open fd keeps the inode readable (safe, complete data); on Windows the `unlink` fails `EPERM`/`EBUSY`, which is _not_ swallowed by `ignoreMissing` (`98-102`), so `write()` rethrows → feeds N1's global disable. There is no snapshot-generation counter analogous to `activationGeneration`/`threadActivationGenerations` (`agent-connection-manager.ts:289-290`); the only "generation" is the filename `${now}-${random}` (`235`).
- Cost/ownership: generation naming + rename-before-DB-point makes torn _reads_ impossible for a single sidecar; the risk is cross-platform delete-vs-open and reading an evicted cached path.
- Evidence level: **code-read/inference** (the POSIX vs Windows behavior is platform reasoning I could not execute here; `isPinned` at `agent-connection-manager.ts:258` protects resident runtimes from `enforceLimit`, which mitigates the base-read case but not `delete()`).
- Safeguards already present: atomic rename before the row points at it (`108-109`, `262-268`); pinned sessions excluded from eviction (`414`); `getToolCalls` catches restore failure and clears the source (`572-576`).
- Regression check: a test that starts `loadPayloads`, deletes/rewrites the generation, and asserts either a complete read or a clean handled error (not a global write disable).

---

## CONFIRMATIONS (verified as designed/tested)

- **C1 — Compaction safety.** `compactDatabase` runs `VACUUM` + `wal_checkpoint(TRUNCATE)` in a worker with its own connection, reports `checkpointBusy`, and is deduped to one in-flight call (`database-compaction.ts:1-40`, `main.ts:1985-1991`). Idle-case integrity is test-backed (`REPO/electron/database-compaction.test.ts:8-27`), and contention-safe recovery is test-backed (`scripts/verify-compaction-contention.mjs:68,81-82` asserts `integrity_check === "ok"`). It cannot corrupt because VACUUM is transactional; the real exposure is lock/contention (see N1), not integrity.
- **C2 — Snapshot queue is per-thread, serialized and keep-latest-bounded.** `scheduleSnapshot` clears the previous timer (coalesce), and `snapshotWriteChains` serializes per thread and deletes settled entries (`agent-connection-manager.ts:655-726`); the in-memory cache is LRU-bounded by entries+bytes (`thread-snapshot-store.ts:375-390`, test `thread-snapshot-store.test.ts:337-372`). So it does not append-every-write and is bounded by thread count, not event count.
- **C3 — Worktree install queue.** Single global `tail` serialization plus in-flight dedupe by resolved path; a failed job is removed in `finally` so later paths and retries proceed (`REPO/electron/worktree-install-queue.ts:5-19`, tests `REPO/electron/worktree-install-queue.test.ts:4-38`).
- **C4 — Compaction/DB open count.** Multiple connections do open the same file: main (`db.ts:166`), monitor worker (`monitor/worker.ts:75`, plus in-process fallback `worker-client.ts:107`), and compaction worker (`database-compaction.ts:20`). All set WAL and `busy_timeout` (5000 main/monitor, 1000 compaction). Only the main connection is the single writer for snapshots/threads; the monitor worker writes its own tables. `setSelectedAgentIds` uses `BEGIN IMMEDIATE` (`db.ts:464`).
- **C5 — Sidecar rewrite amplification is real but documented/measured.** Every write re-serializes the whole lean slice and re-streams the full base payload file (unchanged payloads copied through, changed overridden) — `thread-snapshot-store.ts:240-302`; measured in `REPO/electron/architecture-costs.bench.test.ts:85-118` ("sidecar rewrite amplification"). Pinned/resident runtime payloads are protected from eviction (`thread-snapshot-store.ts:414`), and base streaming is intentionally used to avoid inflating a large history into memory (`47-59`).

---

## Could not verify / honesty notes

- I did not run tests, the app, or the benchmark scripts (read-only mandate), so all timing/contention characterizations are ordinal, not measured; I deliberately avoided inventing ms/MB figures beyond constants printed in source (2000/5000/1000 ms).
- The Windows `unlink`-vs-open-stream `EPERM`/`EBUSY` behavior in N5 is platform inference; on macOS/POSIX the read survives unlink, so the torn-data risk there is nil.
- I did not audit `monitor/db.ts` write paths or the renderer Zustand stores beyond their interaction points, so I cannot rule out additional redundant writes originating in the renderer; the write counts in N4 are main-process only.
- The uncommitted diff adds `isPinned` protection and orphan cleanup to the snapshot store and `selectedPayloads` merge priority in `getToolCalls`; my N5/N1 analysis already assumes those changes are present.
