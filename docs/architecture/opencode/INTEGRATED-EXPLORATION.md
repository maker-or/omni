# OpenCode integrated exploration

Preserved CLI synthesis after three completed explore subagents. Read [the primary review](README.md) for accepted findings, corrections and runtime validation.

# Integrated Architecture Report — Pipper ACP Performance Review

## Method and execution

Three explore subagents ran in parallel over the working tree `/Users/harshithpasupuleti/.pipper/worktrees/.../performance`, all read-only. All three completed successfully (no subagent failures). Each inspected its named sources with targeted `rg` reads plus relevant behavior tests. No tests were run, no builds, no live agents, no `.env` reads; no timing, memory, or render/paint numbers were measured or invented. Explorer reports are attributed below as **E1** (connections/activation), **E2** (storage/navigation/workspace), **E3** (renderer/monitor/terminals).

A shared caveat surfaces immediately: much of the strongest "already-known" performance material lives in **untracked docs** (`docs/architecture/MEASUREMENTS.md`, `docs/performance/README.md`) that the explorers could read but not re-verify by execution. E1 and E3 both flag that several headline claims are measurement-backed _only in those docs_. This report treats those as unverified-here.

---

## E1 — Connections / activation

**New findings**

**E1-N1 — Subagent `session/new` has no timeout and can hold a concurrency lease forever.** `electron/subagents/subagent-manager.ts:468-471` issues a bare `await connection.agent.request(acp.methods.agent.session.new, …)`; the only timeout in the run wraps the _prompt_ (`:482-492`). If a provider completes `agent/initialize` but never answers `session/new`, `activeRuns` (`:143`, default max 3) never decrements and `slotWaiters` (`:546-557`) grows unbounded; `cancelRun` (`:311-322`) is a no-op because `run.sessionId` is null until `:472`. Trigger: a single stalled provider permanently consumes one-third of subagent capacity. Evidence: code-read for the hang; the neighboring prompt-timeout slot-release path is test-backed (`subagent-manager.behavior.test.ts:205-240`) but does **not** cover `session/new`. Safeguard present: the whole run body is `try/finally` and releases the slot on any other error. Regression check: a fake connection whose `session/new` never resolves, `maxConcurrent: 1`; assert the run rejects bounded and `activeRuns` returns to 0.

**E1-N2 — Abandoned-then-successful session establishment can leak the per-session MCP token.** MCP tokens are minted and registered (`subagent-manager.ts:219-221`), bound on success (`agent-connection-manager.ts:1906,1974,2004`), released on error (`:1902,1970,2000`). If a `switchThread` is superseded mid `session/load`, `raceActivation` rejects locally (`:2361-2374`) and the runtime is removed (`:2452`) — but the detached `session/load` keeps running and, if it later resolves, `attached.bind(...)` fires with no matching release. `releaseSessionMcp` is only reachable from paths that no longer apply to a removed runtime. Cost is small per entry but accumulates across rapid switches plus stale routable endpoints. Evidence: **inference** (requires the abandoned load to resolve); normal token lifecycle is test-backed (`subagent-manager.behavior.test.ts:181-203`). Safeguard: `McpHttpServer.close()`/`SubagentManager.dispose()` clear everything on shutdown.

**E1-N3 — The activation queue is an unbounded promise chain, and durable ops ignore the signal.** `enqueueThreadActivation` (`agent-connection-manager.ts:2011-2036`) aborts only the newest controller and chains every task; no array, no cap, no removal on completion. Durable `createThread`/`deleteThread`/`closeThreadSession` (`:2516,2673,2746`) deliberately receive but don't propagate the signal. A _new_ detail: the replacement switch spawned inside `deleteThreadInternal` (`:2737`) is itself invoked with no signal, so it cannot be superseded and runs its own phase timeouts. Cost is tail-latency retention (bounded per phase by ~3×10s), not unbounded memory. Evidence: code-read; magnitude is measurement-backed only in untracked docs. Regression check: enqueue a slow `createThread` then a `switchThread`; assert the nested replacement switch observes the queue signal once plumbed.

**Confirmations**

**E1-C1 — Cancellation is cooperative and stops _waiting_, not the ACP request.** Documented at `electron/activation.ts:7-13`; `raceActivation` (`:40-64`) settles the local promise while keeping handlers attached (`cancellable-activation.test.ts:41-104`). The wire request continues to its own timeout; `requestWithTimeout` (`connection-lifecycle.ts:72-94`) cannot cancel the underlying call. This is the design's explicit contract, not a bug.

**E1-C2 — One process per `agentId`, no refcount; `closeThreadSession` is lease-safe.** `ConnectionLifecycle.connections` (`connection-lifecycle.ts:177`) holds one `LiveConnection` per agent; `closeThreadSession` touches only the ACP session (`agent-connection-manager.ts:2759-2771`), so it cannot evict a process another thread shares — correct. The opposite problem is real: `getModelCatalogs` (`:433-543`) `acquireConnection`s _every_ selected agent and probes `session/new` for missing catalogs with **no main-process cache**, called from `agent-panel.tsx:2163-2173` on every `selectedAgentKey` change. Only the remote server caches it (`remote-server.ts:1052-1071`). Process warming is measurement-backed only in untracked docs. Regression check: call `getModelCatalogs` twice; assert process/session/token counts don't grow on the second call.

E1 also produced a full **timeout coverage map**. Most awaits are bounded; the unhbound candidates are subagent `session/new` (E1-N1), `attachMcpServers → ensureStarted`, and the unguarded tail of `switchThreadCore` (`:2495-2503`), plus FS-bound flush/delete with no timeout.

---

## E2 — Storage / navigation / workspace

**New findings**

**E2-N1 — One failed snapshot write permanently disables snapshot persistence app-wide.** `agent-connection-manager.ts:713-718` sets `snapshotWritesDisabled = true` in the write chain's `.catch` for _any_ error on _any_ thread; every later `scheduleSnapshot`/`queueSnapshotWrite` (`:656-661,673-683`) then no-ops with **no retry and no per-thread scope**. `thread-snapshot-store.ts:319-328` rethrows after cleanup, feeding it. A reachable trigger is `VACUUM` from `database-compaction.ts:20-27` (own connection, `busy_timeout=1000`) contending with a snapshot `INSERT` on the main connection (`busy_timeout=5000`, `db.ts:162-173`) → `SQLITE_BUSY` → permanent global disable until restart. Test evidence: `scripts/verify-compaction-contention.mjs:21,55-60` reproduces the busy failure and retries; **no test asserts the disable flag** (zero `*.test.ts` references). Cost: silent, total persistence loss with an app-global permanent blast radius from one transient event. Regression check: reject `write` once, then assert a _different_ thread still persists.

**E2-N2 — `launch-state.json` is written non-atomically; a torn write resets all navigation state.** `launch-state.ts:76-80` calls `writeFile` directly (no temp+rename), and `readLaunchState` (`:69-73`) catches every error and returns `DEFAULT_STATE`. A crash/kill mid-write yields partial JSON that is indistinguishable from "no state," losing `projectId`, `openThreadIds`, `activeThreadId`, switch history, and worktree selections together. Evidence: code-read; tests cover ordering/parsing (`launch-state.test.ts:54-80`) but never torn-write recovery. The codebase already has the correct idiom elsewhere (`remote-requests.ts:67-68`, `launcher-update-manager.ts:149,186,207`).

**E2-N3 — Snapshot debounce has no max-wait and no-ops during active turns.** `scheduleSnapshot` (`:663-668`) resets a 2s timer on every event with no max-age; `queueSnapshotWrite` (`:673-683`) skips while `isStreaming || promptInFlight || loadingSessionThreads`. Events arriving faster than 2s keep sliding the write, and a long turn suppresses flushes entirely, so durability latency is unbounded and event-driven. Fixes should coalesce/force-flush, not disable debounce. Evidence: code-read/inference.

**E2-N4 — Redundant persistence: ≥3 launch-state read-modify-write cycles per switch, open-tabs reads twice.** `activateThread` (`:2495-2503`) issues `updateWorkspaceSelection`, `updateLaunchSelection`, `recordThreadSwitch` as three independent mutations; each does read+full write (`launch-state.ts:118-149`). `open-tabs.ts:88-108` reads launch-state, then `writeOpenTabsState` reads it _again_ (`:98`) before writing; every mutation pays 2 reads + 1 pretty-printed rewrite. Roughly 5 reads / 3 writes per switch of a growing JSON. Evidence: code-read; call counts exact. Regression check: spy call counts; coalesce 3 writes → 1 without breaking ordering tests.

**E2-N5 — Sidecar generation readers have no generation guard.** Reads open `createReadStream(snapshot.payloadPath)` by path (`thread-snapshot-store.ts:208-209`) while a newer write (`:304-306`) or `enforceLimit` (`:415-417`) unlinks the prior generation; `load()` (`:140-152`) returns a memory-cached path without re-checking the file. On POSIX an open fd survives unlink (safe); on Windows `unlink` fails `EPERM/EBUSY`, **not** swallowed by `ignoreMissing` (`:98-102`), rethrowing into E2-N1's global disable. There is no snapshot-generation counter analogous to `activationGeneration`. Evidence: code-read + platform inference. Safeguards: atomic rename before DB pointer, `isPinned` eviction protection (`agent-connection-manager.ts:258`), `getToolCalls` catches restore failure.

**Confirmations (E2).** Snapshot queue is per-thread, serialized, keep-latest-bounded with an LRU cache (`thread-snapshot-store.ts:375-390`, test `:337-372`). Worktree install queue is a single `tail` with dedupe and `finally` cleanup (`worktree-install-queue.ts:5-19`). Compaction is transactional and integrity-safe in the idle case (test-backed) and contention-recovered (script-backed); its real exposure is lock contention, not corruption. Multiple connections open the same file with WAL + busy timeouts; only the main connection writes snapshots/threads.

---

## E3 — Renderer / monitor / terminals

**Critical framing correction.** E3 reports that claims (a)–(d) **do not appear as written** in `docs/architecture/opencode/renderer-terminals-and-monitoring.md` (or anywhere in the repo); a repo-wide search for the phrases returned zero matches. E3 therefore verified the _underlying mechanics_ and mapped them to the doc's actual F-items. This is the most important cross-cutting correction: **do not attribute the four paraphrased claims to the doc as literal text.**

- **(a) background streaming need not thrash the active projection — PARTIALLY SUPPORTED.** No separate background slice exists (`AgentState` has one active `state/snapshot/slice`, `agent-store.ts:98-120`); background state lives in shared keys (`threadToolCalls`, `runningThreadIds`). But background `session-update`/`stop` are explicitly dropped before projection (`:584-587,612-616`), so active text is not rebuilt by background chunks. _However_, E3-N1 shows every chunk still calls `set` unconditionally.

**E3-N1 — Ignored/background bridge events still notify and rerender the no-selector `AgentPanel`.** `applyBridgeEvent` computes an `ignored` flag (`:797`) but `set((s) => withSnapshot(patch))` (`:795-799`) has no early-return. Zustand 5 `setState` object-assigns and notifies on any object patch (`node_modules/zustand/vanilla.js:8-11`), and the default identity selector returns the new object (`react.js:7-15`), so `AgentPanel`'s bare `useAgentStore()` (`agent-panel.tsx:687`, `"use no memo"` at `:666`) rerenders even for empty patches. Evidence: code-read incl. vendored Zustand; no runtime render count. Regression check: fire ignored background events; assert subscriber invocations don't rise once an `if (ignored) return` guard is added.

- **(b) terminal caps are not allocations; explicit close exists — SUPPORTED.** Caps are retention/display limits over buffers (`ghostty-core.ts:4` 1 MiB scrollback; `terminal-store.ts:13` 200 k chars; `terminal-manager.ts:88` 1 MiB ACP output). Explicit close exists (`terminal-store.ts:194-203` PTY kill; `closeWorkspace`/`clearSessions`; `TerminalManager.release/killAll`). Caveat (matches doc F5): no idle/hidden eviction — `terminal-session.tsx:85-101` keeps cores mounted and both shells map all sessions.

**E3-N3 — `appendHistory` re-copies/re-trims a ~200k-char buffer per PTY chunk; two listeners fire per chunk.** `terminal-store.ts:286-304,92-99` builds `history + text`, does `indexOf`/`slice` over the cap, plus `stripTerminalControls` (`:29-90`) and a bucket-array copy; a global listener (`:328-334`) and a per-session router listener (`terminal-session.tsx:270-285`) both run per chunk. Cost is proportional to retained cap, not chunk size. Safeguards: `tabsRevision` isolates metadata; `TerminalInner` writes via router. Preserve fidelity — fix with windowed slice, don't truncate.

- **(c) mutation counting is not a full-document scan each mutation — SUPPORTED.** `monitor-runtime-observer.ts:358` maintains an incremental `mutationCount += 1`; subtree node counting (`:350-357,183-186`) is proportional to the changed node; the full-document `getElementsByTagName("*")` (`:412`) and `querySelectorAll("[data-pipper-id]")` (`:204`) run only on the 5s emit.

- **(d) React notifications do not prove a rendered commit per chunk — PARTIALLY SUPPORTED (as caution).** No store-level batching exists: each IPC event `set`s synchronously (`:795-799`); preload forwards each event directly (`preload.ts:480-484`). React 19 automatic batching can coalesce within a task, but separate IPC tasks generally commit separately and nothing enforces coalescing. The monitor coalesces _accounting_ (one rAF per window, `:295-313`), which separates notify metrics from `paintCount`; that is instrumentation, not render batching.

**E3-N2/N4/N5 (new).** Per-chunk projection costs scale with history and tool count, not chunk size: reducer copies entries (`acp-session-reducer.ts:132`), projection re-materializes the prefix (`acp-entries.ts:176,211`), `projectToolResultMessages` iterates all tool calls each call (`:218-220`), `estimateJsonBytes` walks payloads per event, `syncToolPayloadIds` is O(toolCalls) (`agent-store.ts:590`). Monitor worker boundary structured-clones payloads per tick/write (`worker-client.ts:317-397`); fallback runs sampling + SQLite on the main thread (`:99-215`); always-on by intent (`service.ts:151-153,438-444`). Renderer DOM census is O(DOM) every 5s (`:199-232,412,422`) and the freeze observer runs an rAF loop + timers (`:540-559`). E3 confirms F1–F9 against source, and notes `monitor-freeze-observer.ts` is **dead code** (no import found) and that `reportRendererFreeze` has no recording gate unlike its siblings.

---

## Claims rejected or downgraded

1. **The four paraphrased doc claims are not in the doc** (E3). Treat the document's real F-items as the citable basis.
2. **Background streaming "thrashing the active projection"** is overstated: session-updates for non-active threads are dropped before projection (`agent-store.ts:584-587`). The real cost is the _unconditional store notify_, not projection rebuild.
3. **"Terminal caps are allocations"** is false — they are retention limits; the genuine issue is no hidden-terminal eviction.
4. **"Mutation counting is a full-document scan per mutation"** is false — it is incremental; the O(DOM) scan is on the 5s emit only.
5. **"A rendered React commit per chunk"** is not proven either way; source shows no store batching and no guarantee of coalescing — do not claim per-chunk commits _or_ per-chunk coalescing without measurement.
6. E1/E2 explicitly mark several headline magnitudes as measurement-backed **only in untracked docs**; they are not independently verified here.

## Ranked architecture changes

Ranked by (correctness/durability risk × breadth) against effort, all supporting a bounded review rather than a rewrite:

1. **E2-N1 + E2-N5 — stop one failed snapshot write from globally disabling persistence.** Scope/retry the failure, add a snapshot-generation guard, and make Windows unlink failures non-poisoning. Highest blast radius (silent total persistence loss), correctness-first.
2. **E1-N1 — timeout subagent `session/new` and make cancel effective during establishment.** One stalled provider otherwise permanently burns a lease and grows an unbounded waiter list.
3. **E2-N2 — make `launch-state.json` writes atomic (temp+rename), with tolerant recovery.** Reuses an existing repo idiom; converts total navigation reset into bounded recovery.
4. **E3-N1 — early-return on `ignored` bridge patches.** Cheap, removes per-background-chunk notifications and rerenders; preserves all diagnostic intent.
5. **E1-N3 — cap/coalesce the activation queue and plumb the signal into the nested delete-switch.** Reduces tail latency under durable churn without changing FIFO semantics.
6. **E2-N4 + E2-N3 — coalesce the 3 launch-state mutations into one and add a snapshot max-wait flush.** Reduces redundant writes and bounds durability latency.
7. **E1-C2 — cache model catalogs per process.** Eliminates repeated provider warming; verify with a second-call no-growth assertion.
8. **E3-N3 / E3-N2 — windowed terminal trim and bounded per-chunk projection.** Lower risk, continuous cost, must preserve fidelity (no truncation).

## Sources inspected

**E1:** `electron/connection-lifecycle.ts`, `electron/agent-connection-manager.ts` (createThread, enqueueThreadActivation, switchThreadCore, closeThreadSession, invalidate/exit, getModelCatalogs), `electron/subagents/subagent-manager.ts`, `electron/activation.ts`, `electron/prompt-scheduler.ts`, `electron/cancellable-activation.test.ts`, `electron/subagents/subagent-manager.behavior.test.ts`. **E2:** `electron/thread-snapshot-store.ts`, manager snapshot-write/hydration paths, `electron/database-compaction.ts`, `db.ts`, `launch-state.ts`, `open-tabs.ts`, `worktree-install-queue.ts`, plus `scripts/verify-compaction-contention.mjs` and store/queue tests. **E3:** `src/store/agent-store.ts`, `src/lib/acp-entries.ts`, `src/lib/monitor-runtime-observer.ts`, `src/components/terminal-session.tsx`, `src/store/terminal-store.ts`, `electron/monitor/worker-client.ts`, `electron/monitor/service.ts`, the named architecture doc, and vendored Zustand 5.

## Limits of this review

No subagent ran tests, built, or observed runtime; every cost statement is ordinal and source-derived. Windows unlink behavior (E2-N5) is platform inference. Remote/phone sequencing was not traced. Doc-documented measurements remain unverified here. New findings are labeled separately from confirmations in each section above.
