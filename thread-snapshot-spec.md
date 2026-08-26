# Thread snapshot persistence — spec

Status: draft · Owner: @harshithpasupuleti · 2026-08-25

## 1. Problem and evidence

Cold thread-open time scales linearly with conversation history: **~34 ms per MiB** (measured: 40 MiB → 1.68 s, 120 MiB → 4.26 s, 200 MiB → 7.04 s). 85–97% of that is `session/load`: waiting for the agent process to stream raw history over stdio JSON-RPC while we re-fold it into the renderer slice.

Meanwhile, the main process already holds exactly the state the renderer needs for resident threads:

- `ThreadSessionRuntime.slice` (`electron/thread-session-registry.ts:5`) — reduced entries, lean toolCalls, plan, usage, configOptions, commands
- `runtime.toolPayloads` — parked full tool bodies (97% of bytes)
- `pushState()` already ships one authoritative `session-state` bridge event

When the runtime is evicted (tab close, app restart), all of that is thrown away and rebuilt by full replay.

## 2. Goal

**Open a previously-opened thread at O(paint) cost instead of O(history bytes), across app restarts.**

Non-goals:

- Replacing ACP session/load as the agent's source of truth (the agent still needs it to remember context)
- Making first-ever opens faster (no snapshot exists; replay path unchanged)
- Cross-device sync

## 3. Design overview — two-phase open

Today: click non-resident thread → register empty runtime → `session/load` blocks paint until replay completes → pushState.

New:

1. **Phase A (paint-critical)**: if a valid snapshot exists, build the runtime pre-seeded from it and `pushState()` immediately. Renderer paints the full timeline in one event. Target < 100 ms.
2. **Phase B (background)**: still call `session/load` so the agent restores its own context. While it streams its replay, run the reducer in **discard mode** (replay content duplicates the snapshot). When load resolves: clear discard mode, reconcile (see §7), refresh configOptions/commands.

Prompt gating: `sendPrompt` on a snapshot-restored-but-not-yet-loaded thread queues via the existing prompt queue and drains when Phase B settles (mechanism already exists: `drainPromptQueue`, `promptInFlight`). Local user-message echo appends immediately via `appendLocalUserMessage` (explicit slice assignment — not routed through the reducer, so discard mode cannot eat it).

Fallback ladder unchanged (load fail → resume → new): on any fallback, reset slice to empty, flip to reduce mode, behave exactly like today (`agent-connection-manager.ts:1688-1709` already resets slice/retention/payloads between attempts).

## 4. Data model

Two tiers, because payload bytes dominate but must not sit on the paint path:

**Tier 1 — manifest (SQLite, small, read synchronously on switch):**

```sql
CREATE TABLE IF NOT EXISTS thread_snapshots (
  thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  agent_session_id TEXT NOT NULL,     -- invalidation key (§7)
  agent_id TEXT NOT NULL,
  entry_count INTEGER NOT NULL,
  slice_json BLOB NOT NULL,           -- serialized AcpSessionSlice (lean)
  payload_path TEXT NOT NULL,         -- sidecar file ref (tier 2)
  payload_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

- `slice_json`: post-trim slice (`MAX_SESSION_ENTRIES=2000` / `MAX_SESSION_TOOL_CALLS=500` bound it — worst case ~1–2 MB JSON). Plain JSON; every field is serializable data.
- Uses the existing WAL connection and `ensureTable` pattern in `electron/db.ts`.

**Tier 2 — payload blob (sidecar file, loaded after paint):**

- `<userData>/thread-snapshots/<threadId>.json.gz` — `Record<toolCallId, ToolCallPayload>`, gzip.
- Rationale vs SQLite BLOB: 10–200 MB blobs bloat the DB/WAL; atomic rename on files gives crash safety; deleting a thread deletes one file.
- Loaded async right after pushState (post-paint microtask); `getToolCalls` / expand handlers await it. Until loaded, tool rows render lean (title/status) — same as today's pre-replay appearance, no new UX state.

## 5. Write path

Snapshot writes happen only at settled points (never mid-stream — guarantees `isStreaming:false` in every snapshot):

| Trigger          | Site                                                                                                                                                            | Mode                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Turn settle      | every `applyTurnStop` site in `agent-connection-manager.ts` (lines ~1072, ~1102, ~1725, ~2143) — centralize in one `maybeSnapshotAfterTurnStop(runtime)` helper | debounced 2 s per thread    |
| Runtime eviction | end of `closeThreadSessionInternal`                                                                                                                             | immediate flush             |
| App quit         | existing `will-quit` flush chain                                                                                                                                | flush all resident runtimes |

Rules:

- Serialize per-thread; coalesce (a pending write subsumed by a newer one is dropped).
- Atomicity: write sidecar `.tmp` + rename; single UPSERT for the row (WAL transaction).
- Skip write when nothing changed since last persisted `updated_at` marker (compare slice reference + payloads version counter).
- Cap total cache (LRU by `updated_at`, default 512 MiB); evict oldest row+file.

## 6. Restore path

In `switchThreadCore` (`agent-connection-manager.ts:1633`), replace the "not resident" branch:

```
if (!this.sessions.has(threadId)) {
  const snap = loadThreadSnapshot(threadId)            // tier-1 read
  if (snap && valid(snap, thread, live.agentId)) {     // §7 checks
    runtime = seedRuntimeFromSnapshot(threadId, snap)  // slice populated, replayMode='discard'
    this.sessions.register(runtime)
    this.pushState(threadId)                            // PAINT — do not wait for load
    void hydratePayloadsAsync(runtime, snap.payloadPath)
    // then fall through to the existing session/load flow, with
    // handleSessionUpdate honoring replayMode='discard' for this runtime
  } else {
    ...existing empty-runtime + session/load path (unchanged)...
  }
}
```

- `handleSessionUpdate` gains one check: if `runtime.replayMode === 'discard'`, count/skip the update (still update monitor counters) without touching the slice.
- On `sessionLoad` resolve: `runtime.replayMode = 'reduce'`; merge `configOptions`; reconcile (§7).
- `loadingSessionThreads` semantics split into two signals: `displayReady` (snapshot restored — true immediately) and `isThreadLoading` (session established — true until Phase B settles). Composer submit and the benchmark controller keep using the latter; nothing gates painting on it anymore.

## 7. Consistency and invalidation

Invariant audit (trusted state / readers / writers / transitions):

| Invariant                                                                                             | Guarantee                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot never newer than agent history                                                               | Writes only at turn settle; staleness bounded to one turn. Background load reconciles anyway.                                                                                                      |
| Replay never duplicates snapshot content                                                              | Discard mode drops replay updates while snapshot-seeded.                                                                                                                                           |
| Agent history diverged from snapshot (crash lost last turn, agent-side compaction, resume→new rebind) | After Phase B, compare replay-final entry_count > snapshot entry_count ⇒ **replay wins**: replace slice with replay result, evict stale payloads, pushState again. Equal-or-fewer ⇒ keep snapshot. |
| Session id changed under us (resume/new fallback)                                                     | Manifest keyed on `agent_session_id` + `agent_id`; mismatch ⇒ snapshot invalid ⇒ cold path (which itself writes a fresh snapshot at next settle).                                                  |
| Thread deleted                                                                                        | `ON DELETE CASCADE` + sidecar unlink hook in `deleteThread`.                                                                                                                                       |
| Crash mid-write                                                                                       | Temp+rename; WAL row atomicity. Torn state impossible; worst case is missing snapshot = today's behavior.                                                                                          |
| Concurrent switch during restore                                                                      | Existing `activationGeneration` + `enqueueThreadActivation` serialization covers it; seeding happens inside the same queued activation.                                                            |

## 8. Failure modes

- Sidecar corrupt/missing but row present → treat as lean-only restore (tier-1 still paints), delete row so next settle rewrites both.
- `slice_json` unparsable / schema_version mismatch → ignore, cold path, overwrite on next settle.
- Disk pressure / quota errors → log once, disable writes for session, cold path forever (feature is an optimization; correctness must never depend on it).

## 9. Rollout

- Env kill-switch `PIPPER_THREAD_SNAPSHOTS=0` (+ settings toggle later). Default off for one internal build, then on.
- Monitor: extend `sessionCacheEvent.trigger` with `"switch_snapshot"`; add restore duration + hit/miss to insights (`insights.switch.cacheHits` already exists — snapshot hits increment it; phase becomes `"snapshot_restore"` when display-ready came from cache).
- Analytics: `thread_open_source: replay | snapshot | resident` + restore_ms.

## 10. Testing plan

Unit (vitest, co-located):

- serialize/deserialize round-trip incl. trim boundary (2000/500 caps), unicode, empty slices
- invalidation matrix: session-id change, agent change, delete, version mismatch, corrupt JSON
- LRU eviction cap
- discard-mode reducer: replay updates don't duplicate seeded entries; local user append survives; reconcile replaces slice when replay is longer

Behavior (`agent-connection-manager` tests, mock agent):

- open → close tab → reopen: zero fixture updates consumed before pushState fires; final slice deep-equals full-replay slice
- prompt submitted during Phase B: queued, drained after load; timeline shows local echo immediately
- load fails after snapshot restore → resume/new fallback yields correct timeline (existing tests extended)

Benchmark acceptance:

- `bun run bench:open` on 500-turn/200 MiB fixture: thread-ready **7.0 s → < 400 ms** with snapshots on; startup metrics unchanged
- Add `--expect-snapshot` flag asserting zero replay-before-paint (parity check flips from update-count equality to snapshot-mode assertions)

## 11. Open questions

1. Do any agents mutate history server-side such that replay would be _shorter_ than our snapshot (compaction)? Current rule keeps snapshot; may need per-agent tuning.
2. Should tier-2 gzip become zstd? (Node has zlib built-in; zstd needs a dep — start with gzip.)
3. Subagent runs' timelines — out of scope v1, confirm they never route through the same slice.

## 12. Expected impact

| Scenario                | Today (200 MiB thread) |                     With snapshots |
| ----------------------- | ---------------------: | ---------------------------------: |
| Cold open after restart |                 ~7.0 s | < 0.4 s paint, load settles behind |
| Tab close → reopen      |            full replay |                      < 0.4 s paint |
| Resident switch         |           already fast |                          unchanged |
| First-ever open         |            full replay |           unchanged (writes begin) |
