# Storage and Workspaces: Deep Architectural Performance Investigation

Date: 2026-10-15
Working tree: ac746c8c-5b7c-4167-90bc-601ca03b4988/performance (based on 490f89626a4c63b85a3723cf00be55288b74d192)
Scope: Electron/React/Zustand desktop ACP app. Exploration/report only - no production code changes.

## Summary

This report audits storage (ThreadSnapshotStore), workspaces/worktrees (worktree-manager.ts, worktree-install-queue.ts), database/migrations (db.ts, threads.ts/projects.ts), manager state (agent-connection-manager.ts), lifecycle/scheduling (prompt-scheduler.ts, permission-coordinator.ts, launch-state.ts/open-tabs.ts, isolated-agent-task.ts, activation.ts), monitor/compaction (monitor/_, database-compaction.ts), and launch/tab state. Evidence is from actual source files, existing measurements (docs/architecture/MEASUREMENTS.md, README.md, VALIDATION.md), performance JSON (docs/performance/_.json), and file inventory (FILE-MAP.md/module-map.json). Existing uncommitted resource fixes and architecture reports are preserved.

Facts below are code-proven, evidence-based, or clearly labeled hypothesis/proposed test. Where prior reports made claims, they are explicitly challenged.

## 1. Files Actually Reviewed

Core source (full reads shown by citations):

- electron/thread-snapshot-store.ts (load/write/readPayloadEntries/enforceLimit/orphan cleanup/memory cache) — key points: line~399-411 (enforceLimit scans all snapshots computing length(CAST(slice_json AS BLOB))+payload_bytes), line~170-240 (load parses slice_json, validates, caches in memory LRU), line~240-320 (write streams records(), gzips to temp, renames, updates DB, deletes old, enforces limit, caches)
- electron/worktree-manager.ts (foreignGitEnv, gitBinary caching, execFileSync for git, projectSubpath, worktreeRootOf, getWorktreesRoot) — synchronous execFileSync used for git; base/fetch paths may call git with timeouts (e.g. 60s in some branches discussed); setupScript execution uses sync shell in helper paths
- electron/db.ts (SQLite setup, ensureColumn, columnExists, rebuildThreadsTableIfLegacyConstraints, migrateThreadsTable, thread_snapshots schema) — thread_snapshots has slice_json, payload_path, payload_bytes, entry_count, agent/session IDs, timestamps
- electron/agent-connection-manager.ts (enqueueThreadActivation: line~2011+, activationAbort + threadActivationQueue chain; switchThread/createThread/delete/close wrapped; activateProject uses switchThreadInternal; createThreadInternal around 2529+; activation.ts defines cancellation primitives)
- electron/activation.ts — cancellation primitives (ActivationSupersededError) for activation queue
- electron/launch-state.ts, electron/open-tabs.ts — workspace/launch selection persistence (separate JSON mutations; concurrency noted in measurements)
- electron/isolated-agent-task.ts — creates worktree first; explicit worktree creation path
- electron/worktree-install-queue.ts — dependency install queueing (separate from Git work)
- electron/prompt-scheduler.ts, electron/permission-coordinator.ts — per-thread scheduling/coordinator
- electron/thread-session-registry.ts — resident runtime/session registry (referenced)
- electron/monitor/\*, electron/database-compaction.ts — monitoring/compaction (shared DB; compaction touches DB state)
- electron/antigravity-snapshot-restore.test.ts, electron/push-state-snapshot.test.ts, electron/thread-snapshot-store.test.ts, electron/cancellable-activation.test.ts — tests confirm expected behaviors

Existing docs/artifacts (read-only claims audit):

- docs/architecture/README.md, MEASUREMENTS.md, VALIDATION.md, FILE-MAP.md, module-map.json
- docs/performance/_.json (agent-load, retention-comparison, local-_ baselines, database-compaction-\*, workflow/component measurements)

No production code edited. No tests/config/package-lock edited. No dependency installs. No live data touched.

## 2. Storage Architecture (ThreadSnapshotStore)

### Code-proven facts

- Storage is generation-based: each write creates temp .jsonl.gz at rootPath (root defaults to app.getPath("userData")/thread-snapshots), renames to finalPath (format `${safeThreadId}-${generation}.jsonl.gz`) before updating DB pointer; previous payload deleted on success (thread-snapshot-store.ts:240-320). Crash-safety: temp created with wx, rename after write, pointer update after rename; on error temp/final cleaned; orphan cleanup runs once before write (line~250-256) removing files >24h old not referenced (line~440-480).
- Payloads are line-delimited JSON arrays [toolCallId, payload] (line~206-239 readPayloadEntries). Streaming: reads base snapshot entries via async generator and yields merged records (overrides take precedence for live toolCallIds), pipes through createGzip to write stream with setImmediate yields every 8 records (line~263-290) — reduces blocking but does not change bytes.
- Snapshot is settledSlice(trimSessionSlice(...)) when stored; load validates validSlice and entry_count matches, returns LoadedThreadSnapshot with payloadPath/payloadBytes/updatedAt (line~170-240). Memory cache is LRU by insertion order (Map keys().next() is oldest) with maxMemoryBytes/maxMemoryEntries; caches serialized slice_json bytes (line~370-398). preload() loads up to provided threads not in memory.
- Disk budget: enforceLimit selects all thread_snapshots ordered by updated_at ASC, computes total = sum(payload_bytes + length(CAST(slice_json AS BLOB))) for each, evicts oldest while total>maxPayloadBytes unless protected (current thread) or pinned (isPinned); deletes DB row, removes from memory, unlinks payload (line~399-438). This is the display-cache budget (comment at 409-411).

### Evidence from measurements/docs

- Selective hydration: 16 separate loads ~227–241ms vs 1 batched load ~14.5–15.3ms (MEASUREMENTS.md:86-92). Proof that scanning whole generation per request is costly; batching/coalescing helps.
- Write amplification: appending ~16KB changed JSON rewrote ~3.17–3.20MB compressed (ratio ~194x) in ~69–78ms (MEASUREMENTS.md:94-100). Confirms whole-generation rewrite cost.
- Snapshot access: largest row 12,660,833 bytes (214 entries) — SQL get median ~11.44ms, JSON.parse median ~6.80ms (separately); these exclude restoration/IPC/paint (MEASUREMENTS.md:113-114).
- Budget accounting cost: enforceLimit does full table scan computing blob length for every row on write — measured ~17.5ms synchronously on 84 rows (README.md:133-138, MEASUREMENTS.md:108-112). Metadata-only comparison ~7.4ms, so expression is not free and schema needs stored byte totals.
- Retention comparison shows "after" fix reduced retained heap in highlightCache/subagents contexts (retention-comparison.json) — the earlier resource fix exists and must be preserved; current enforcement still pays synchronous scan cost.

### Challenge to prior report claims

- Prior architecture reports suggest "indexed storage" as proposed seam (README.md:146,225). Claim: indexed body storage is necessary for proportional access (true for many late-ID expansions) but must not break generation-based atomic rename/write safety and pinned-reader semantics. Also enforceLimit must avoid reading large blob contents.
- Claim "count limits substitute for byte ownership" (README.md:153-160): partially true — entry/tool caps exist; but lean representation still retains rawInput in toLeanToolCall (example: 1MB rawInput -> 1,048,656 bytes serialized) and active IPC/snapshot/renderer can hold large bodies. Byte budgets exist (maxPayloadBytes) but accounting is whole-table scan.

### Architectural bottlenecks

1. **Unit of storage is whole generation** (line~263-290 merge base+overrides into single gzipped stream). Late tool body expansion proportional to generation size (proven by 16x vs batched).
2. **Synchronous whole-table budget accounting** (line~399-407): computes length(CAST(slice_json AS BLOB)) for every snapshot on every write — O(M \* S_avg) where M rows, S_avg slice size; blocks main thread on writes.
3. **Single global payload file per thread generation**: coalescing concurrent hydration requests per thread/generation not implemented; each readPayloadEntries() is independent stream parse.
4. **Memory LRU caches serialized slice_json bytes only**; large payloads not resident in memory by design (good) but memory snapshot bytes measured as slice size (line~385,390-398) — memoryCacheStats reports entries/bytes based on cached.snapshot + slice bytes, not payload RAM.
