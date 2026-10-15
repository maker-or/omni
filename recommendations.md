# Architecture and performance recommendations

15 October 2026. Covers the current working tree, including the earlier resource fixes, based on commit `490f89626a4c63b85a3723cf00be55288b74d192`.

The largest remaining concerns are resource ownership, work scheduled on the Electron main thread, and operations whose cost grows with total history or workspace count. The earlier cache fixes address real retention, but they do not establish a reduction in total application RAM. The next changes should address these architectural costs and preserve session, terminal, persistence and cancellation guarantees.

This document consolidates both investigation passes and the three completed OpenCode explorations. It records open recommendations; creating this document does not implement them. Completed improvements appear separately near the end.

## Evidence and how to interpret it

- **Measured:** a runtime observation, with its workload and limitations stated. Local mocks, forced-GC heap deltas and read-only database measurements are not customer production measurements.
- **Reproduced:** an adverse behavior exercised through production methods with controlled dependencies or injected failures. This establishes the behavior, not its production frequency.
- **Source-confirmed:** the implementation has the described behavior, but its end-to-end impact has not been measured.
- **Unverified risk:** a plausible failure or cost that needs a targeted reproduction before treating it as an established incident or leak.

Evidence came from an architecture report, workflow and component measurements, a reviewed OpenCode follow-up and a resource investigation. Those reports are no longer kept in the repository; the commands under [Reproduction and acceptance checks](#reproduction-and-acceptance-checks) regenerate them under `docs/`. The file map indexed 733 files at the architecture inventory point. That is an automated dependency/IO inventory, not a claim that every file was manually reviewed or profiled. Marketing, mobile and native paths were not independently performance-profiled.

Raw OpenCode outputs include assertions corrected during primary verification. The reviewed follow-up and explicit reproductions take precedence over those raw assertions.

## Priorities and implementation order

**P1** means address early because an issue can stall unrelated work, retain execution resources, or undermine resource/failure guarantees. **P2** means a measured scaling cost or a substantial ownership gap. **P3** means investigate, harden or simplify after the higher-confidence changes. These are engineering priorities, not security severity ratings or promised savings.

| Order | Workstream                                               | Recommendations   | Completion signal                                                                                                        |
| ----- | -------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1     | Subagent deadlines, cancellation and scheduler ownership | R03–R05           | Establishment and queued work are bounded; cancelled parents cannot dispatch late work or strand descendants.            |
| 2     | Monitor execution and storage failure isolation          | R08, R15–R16, R30 | Built worker starts; recoverable snapshot failures recover; maintenance cannot synchronously stall main.                 |
| 3     | Provider and activation lifetimes                        | R01–R02, R06–R07  | Unused catalog providers can be released; slow preparation does not block a resident switch; late resources have owners. |
| 4     | Worktree disk usage and repository operations            | R20–R23           | Disk inventory explains growth; setup policy is shared; Git is asynchronous and installer jobs have bounded lifetimes.   |
| 5     | Snapshot and retained-history scaling                    | R09–R14, R17      | Pending inputs and caches have byte bounds; small reads/writes avoid processing whole histories.                         |
| 6     | Navigation, renderer and terminal work                   | R18–R19, R24–R29  | Repeated persistence and irrelevant notifications decrease; terminal continuity survives any memory changes.             |
| 7     | Diagnostics and regression prevention                    | R31–R36           | Sampling and retention are bounded; representative performance gates and end-to-end traces are maintained.               |

Establish the R34–R35 measurement contract before implementing the corresponding optimizations. Changes within a workstream should be independently reviewable; a broad rewrite is not required to obtain useful results.

## Thread lifecycle: where architectural costs enter

The normal draft-send path is `agent-panel.tsx` → renderer `agent-store.createThread` → preload IPC → `main.ts` → `AgentConnectionManager.createThread` → global activation queue → project/cwd lookup → provider acquire/initialize → ACP `session/new` → runtime/metadata registration → state publication → navigation persistence. The renderer then refreshes authoritative state, reloads the project thread list, selects the thread and sends the prompt. An existing same-thread fast path means this does **not** unconditionally perform a second ACP switch.

A resident switch reuses the provider/session but still does metadata lookup, cwd validation, state publication and navigation persistence. A persisted restore additionally reads/parses a display snapshot, publishes it, restores the provider session and reconciles replay. Display availability, agent readiness, durable navigation and visible paint are separate milestones.

| Existing measurement                       |                                               Observation | Interpretation                                                                            |
| ------------------------------------------ | --------------------------------------------------------: | ----------------------------------------------------------------------------------------- |
| Cold-provider thread request               |                     66.27 ms median, 63.67–67.56 ms range | Three fresh instrumented Electron runs with a local mock CLI.                             |
| Warm same-provider creation                |                                            4.30 ms median | Preload request; excludes the full draft UI path and paint.                               |
| Resident switch                            | 6.87 ms average per switch in the median ten-switch batch | Local resident sessions; 40 launch-state writes occurred across each ten-switch scenario. |
| Persisted restore request                  |                                           10.44 ms median | Small fixture; not representative of the largest local snapshot.                          |
| Worktree creation                          |                  145.99 ms median, 145.54–162.46 ms range | Small Git fixture without dependency installation or network.                             |
| Resident switch behind delayed preparation |                                     426.14 ms median wait | Injected 400 ms initialize delay; demonstrates queue coupling.                            |

These numbers are observations from the saved measurements, not production percentiles. Inclusive method spans overlap and must not be added as independent phase costs. Ordinary thread creation does not inherently create a worktree or install dependencies.

## Provider processes, activation and subagents

### R01 — Separate catalog discovery from execution-process lifetime

**P1 · Measured and source-confirmed.** [AgentConnectionManager](electron/agent-connection-manager.ts) and [ConnectionLifecycle](electron/connection-lifecycle.ts) acquire selected providers for model discovery, sometimes creating a temporary session to obtain models. Closing that session does not release the cached provider process. In the controlled eight-provider catalog scenario, connections increased from three to nine with zero resident sessions, and all nine remained after ten seconds. Six were newly started; the ninth cached provider was the deliberately slow fixture provider.

Return cached catalogs separately from explicit refresh. Refresh only the required provider, deduplicate concurrent refreshes, and define freshness/error caching. Make provider acquisition return an owned lease covering sessions, prompts, catalog requests, authentication and subagents, with an explicit warm policy and idle grace period. Caching catalog results alone does not dispose existing processes.

**Verify:** cached lookup spawns nothing, simultaneous refresh spawns once, the last lease eventually releases the process, and background prompts/auth/subagents survive idle cleanup. Preserve the existing useful multiplexing of sessions through one process per provider instance. Measure real provider process-tree memory before estimating savings.

### R02 — Move preparation out of the global UI activation queue

**P1 · Reproduced latency coupling.** Create, switch, close and delete share the activation chain in [the manager](electron/agent-connection-manager.ts). Background creation joins it. A 400 ms injected provider initialization delayed an unrelated resident switch by 424.28–428.70 ms across three runs. Actual provider initialization can be much slower; that was not measured here.

Prepare runtimes independently, with per-thread mutation exclusion and per-provider spawn deduplication. Keep a short ordered commit for active UI selection. Use activation generations to reject stale results and dispose abandoned preparation. Bound pending durable operations; coalesce superseded selection requests where safe without dropping actual create/delete requests or starving them. Audit replacement activation during deletion as well as normal switches.

**Verify:** a resident switch finishes while unrelated initialization remains blocked; rapid A→B→A activation has the correct winner; close/delete/reconnect preserve cwd, MCP, permission and terminal ownership. Removing the queue without replacing these invariants is insufficient.

### R03 — Apply one deadline and cancellation signal to the complete subagent operation

**P1 · Reproduced.** In [SubagentManager](electron/subagents/subagent-manager.ts), queue admission, connection acquisition and `session/new` precede the prompt timeout. Slot acquisition also precedes the cleanup `try/finally`. Cancellation during establishment has no session ID to cancel.

The real MCP-loopback reproduction, with a scripted provider and fake clock, configured 30 seconds and advanced 60 seconds: one run remained running, one queued and zero callers settled. Cancelling the parent and then releasing `session/new` still sent one prompt before the calls settled as cancelled. This was not a real-provider hang or 60 seconds of wall-clock waiting.

Carry an operation deadline/signal through every phase. Check it after every asynchronous boundary and immediately before dispatch. Release scheduling permits when establishment cannot finish; close or adopt late sessions and release their MCP resources. Do not kill a shared provider merely to cancel one session.

**Verify:** never-responding establishment, late success, queued cancellation, connection failure and parent cancellation all settle callers and return resource counts to baseline; no prompt is dispatched after cancellation.

### R04 — Make nested delegation compatible with bounded concurrency

**P1 · Reproduced.** A parent awaiting a nested subagent retains its execution slot. Saturating the slots with such parents queues children behind the work awaiting them. The controlled one-slot, depth-two case stalled until the parent's fake-clock deadline; its queued child then started after the parent was cancelled. Defaults allow three concurrent runs and depth two, but default-cap saturation was not separately measured.

Model parent/child ownership explicitly. Separate executing work from a parent waiting on delegated work, for example by yielding its permit under a bounded descendant policy. Recursively cancel queued descendants. Preserve fairness, depth limits and an actual ceiling on execution resources; increasing the cap or exempting every child merely moves the failure.

**Verify:** saturated nested workloads complete within their deadlines, cancellation removes queued children, sibling failures do not orphan runs, and true concurrent provider/resource usage remains bounded.

### R05 — Define the long-running MCP job contract

**P1 · Observed interface mismatch.** Three original MCP exploration calls and one retry each returned `timed out awaiting tools/call after 300s`. Pipper's default prompt deadline is 600 seconds, excludes establishment/queue wait, and [the MCP server](electron/subagents/mcp-http-server.ts) waits for completion before responding. These errors do not prove backend cancellation or identify the nested scheduler as their cause. Three direct OpenCode CLI exploration Tasks subsequently completed; provenance is preserved.

Choose a bounded whole-operation contract compatible with actual clients, or introduce durable start/status/progress/cancel jobs with IDs. Define caller disconnect, expiry, retries, idempotency and result retention. Make the UI distinguish queued, establishing, executing, cancelled and abandoned work.

**Verify:** client timeout/disconnect does not silently duplicate or orphan work; retry can identify the existing job; cancellation and expiry release resources. Test actual supported MCP clients before choosing timeout values.

### R06 — Give abandoned late session results and MCP endpoints explicit owners

**P2 · Unverified risk.** Source tracing in [the manager](electron/agent-connection-manager.ts) suggests that superseding an activation can stop waiting without stopping the underlying ACP request. A late successful session can bind an MCP attachment after its runtime was removed. This has not been reproduced as a leak, and no retained-byte estimate exists.

Associate preparation, attachment tokens and late replies with a lifecycle owner. A success after cancellation must be adopted by a still-valid runtime or disposed. Centralize release on failure, replacement and transport exit.

**Verify first:** supersede activation, resolve the old request late, and assert that provider sessions, MCP roots/tokens and runtime maps return to baseline. Include successful and failed late cleanup.

### R07 — Audit lifecycle maps and pending-request bounds together

**P3 · Unverified retention/backpressure risks.** Per-thread activation-generation entries and other runtime-associated maps deserve deletion/exit auditing. A count of active threads alone does not describe retained permissions, timers, terminal roots, MCP state or queued payloads. No stale-map leak rate or pending-payload memory measurement was established.

Document creation/removal for each resource and give pending operations both count and byte bounds where appropriate. Reject or backpressure excess work explicitly. Avoid treating every process/session reference as a leak while an intentional owner remains.

**Verify:** repeated create/delete, failed load, reconnect, provider exit and cancellation cycles reach a stable baseline; queue saturation has a predictable result and preserves live requests.

## Snapshots, databases and disk budgets

### R08 — Recover from snapshot failures without disabling every thread forever

**P1 · Reproduced.** [Snapshot write orchestration](electron/agent-connection-manager.ts) sets a global disable flag after one write failure. The fault injection made one write fail; a different thread's next flush returned false without a second storage attempt. No recovery exists until process restart. Successful persistence also clears live tool-body maps, so disabled writes can extend RAM retention.

These are display snapshots; this does not establish loss of canonical provider conversation history. Replace the global permanent switch with scoped failures, error classification, bounded backoff and a visible degraded mode. Define safe live-body retention when persistence is unavailable. Keep protection against repeatedly writing to a full/broken disk.

**Verify:** failures before commit, during post-commit cleanup, on one thread and during disk recovery do not permanently disable unrelated healthy writes or clear bodies prematurely. The compaction probe reproduced a delayed successful write, not a busy-timeout exception triggering this flag.

### R09 — Coalesce pending snapshot inputs with explicit flush semantics

**P2 · Reproduced.** The two-second debounce coalesces before enqueue. Each enqueued write captures its own slice and payload map in a promise chain. Six concurrent flush revisions caused six writes despite a tail-map size of one. Pending retained bytes and production backlog frequency were not measured.

Use one active write plus a replaceable latest pending input per thread where display-cache semantics permit. State which revision each flush promise guarantees. Select the base generation after the previous write and retain shutdown/close guarantees. An older write must not clear newer live payloads.

**Verify:** block storage, enqueue many revisions, and demonstrate bounded inputs with the final revision persisted; test concurrent body updates, close/shutdown, errors and revision-specific waiters.

### R10 — Replace repeated whole-history body work with indexed access

**P2 · Measured.** [ThreadSnapshotStore](electron/thread-snapshot-store.ts) scans gzip JSON lines to find requested bodies and rewrites a generation on append. In the 128-tool, 4 MiB high-entropy fixture, 16 separate late-ID requests took a median 227.62 ms; one batched request took about 15 ms. A 16,413-byte append wrote 3.18–3.20 million compressed bytes, approximately 194 times the changed JSON size. These are application bytes, not storage-device write amplification.

First batch/coalesce requests by thread and immutable generation. Then evaluate indexed body records or chunks so small reads and updates scale with requested content. Move expensive parse/serialization/compression off main where measured. Preserve live-update precedence and migrate with a readable fallback.

**Verify:** returned bodies remain exact; late updates, concurrent readers, failed commits and crash recovery retain valid generation pointers; record CPU, bytes processed, temporary space and retained memory. The earlier request-scoped hydration fix saves RAM while exposing this read tradeoff.

### R11 — Store exact transcript byte accounting transactionally

**P2 · Measured cost introduced by the earlier correctness fix.** Budget enforcement now correctly includes `length(CAST(slice_json AS BLOB))`, but queries every snapshot after writes. Against 84 real rows containing 49,674,737 transcript bytes and 22,673,023 sidecar bytes, the exact synchronous query took a median 17.46 ms. A 7.37 ms metadata-only comparison omits transcript accounting and is not a valid replacement.

Store exact UTF-8 transcript/total bytes with each transactional update; use narrow metadata and incremental totals/indexes for eviction. Backfill outside interaction-critical work and batch recency touches where possible.

**Verify:** Unicode, overwrite, eviction, failed transactions, migrations and deleted sidecars preserve correct totals. Compare the new accounting to a full independent scan. Do not regain speed by excluding transcript bytes again.

### R12 — Bound transcript bytes and page the display path

**P2 · Measured and source-confirmed.** The largest local lean snapshot had 214 entries but occupied 12,660,833 bytes. SQL get and JSON parsing separately took medians 11.44 ms and 6.80 ms before IPC, projection or paint. Lean tool records retain full `rawInput`: a synthetic 1 MiB input produced a 1,048,656-byte record, versus 352 bytes for the corresponding output preview. Entry/tool-count caps therefore do not bound byte cost.

Use a transcript window/index with on-demand historical pages. Evaluate references for oversized inputs after auditing permission displays, diffs, summaries and other consumers. Give live and persisted representations byte-aware policies, retaining access to complete content. Consider asynchronously owned storage for synchronous reads/parses.

**Verify:** long histories and large inputs restore and expand exactly, optimistic/replayed entries reconcile correctly, and initial display cost scales with the visible window. Measure end-to-end readiness and paint separately.

### R13 — Lease snapshot generations for readers

**P2 · Source-derived race; platform impact unverified.** Sidecar readers open streams asynchronously, while replacement and eviction can unlink generations. Runtime pinning protects snapshot rows, not every old generation held by an in-flight reader. A cached path alone is not an availability guarantee. Windows behavior was not tested.

Use immutable generation ownership with reader leases or open handles acquired before cleanup. Defer deletion until safe, handle missing/corrupt bodies explicitly, and make crash recovery reclaim abandoned files. A numeric generation counter alone does not solve reader lifetime.

**Verify:** pause readers around open, replace/delete/evict their generation, and assert complete content or a defined recoverable outcome on supported platforms; include cleanup failure and restart cases.

### R14 — Make soft budgets and total disk usage visible

**P2 · Source-confirmed limitations.** The 512 MiB snapshot budget can be exceeded by resident/newest pinned backing data. SQLite page overhead, WAL, diagnostics and temporary compaction space are outside it. The four-entry/32 MiB snapshot-memory LRU counts serialized bytes, not actual heap. Orphan cleanup runs once on the store's first write with a 24-hour grace period. Recent orphan generations and later abandoned files can therefore remain until a future store instance performs cleanup; without another write, that cleanup does not run.

Report categories separately: live pinned data, evictable cache, database pages/free pages, WAL, diagnostics, orphan generations and maintenance headroom. Schedule ownership-aware orphan cleanup. Explain soft-cap exceptions and handle low disk space predictably instead of deleting live backing data.

**Verify:** independent filesystem/SQLite inventory reconciles with reported categories; pin-heavy and disk-full cases preserve readable live data and stop growth through a defined policy.

### R15 — Coordinate compaction with synchronous writers

**P1 · Measured contention.** Running VACUUM in [a worker](electron/database-compaction.ts) does not remove SQLite's shared writer lock. On a private backup using production compaction, an uncontended write took 0.046 ms; a deliberately contended synchronous write waited 1,219.60 ms, with a 1,220.57 ms heartbeat gap. Integrity remained `ok`. Checkpoint was busy and database-plus-WAL temporarily grew from 267,972,832 to 487,486,432 bytes; the probe reclaimed zero bytes at that point. This is one controlled contention observation, not permanent growth, corruption or Electron paint timing.

Coordinate maintenance and application writes; schedule compaction during an explicit idle/maintenance state and move database waits behind asynchronous ownership. Account for busy checkpoints and temporary free space. Preserve current in-flight deduplication and transaction guarantees.

**Verify:** concurrent prompts, snapshots, navigation and monitoring remain responsive during maintenance; low-space/busy/abort cases return useful results. Check integrity, logical row hashes, peak storage and both WAL/database sizes. Full evidence.

### R16 — Isolate high-volume diagnostics from application storage

**P1 · Source-confirmed contention domain.** Thread metadata, snapshots, diagnostic recording and maintenance share `omni.sqlite`. Main uses synchronous SQLite, with a five-second busy timeout; a worker connection still competes for the same writer lock. The contention experiment proves this class of cross-connection wait, not each proposed collision.

Evaluate a separate diagnostics database and a single asynchronous storage owner for application operations. Batch writes deliberately, expose backpressure/failures, and preserve transactional relationships within each domain. Avoid moving each caller to unrelated workers that still contend without coordination.

**Verify:** diagnostic floods and compaction cannot block interaction-critical writes; recording remains queryable, migrations preserve data, and failed queues have bounded memory.

### R17 — Measure display-cache freshness before changing debounce policy

**P3 · Source-confirmed policy; impact unverified.** Settled snapshots are debounced for two seconds, with no maximum wait. Long or repeatedly unsettled turns can leave the display cache old. This is distinct from canonical provider durability, and avoiding full mid-turn writes is intentional.

Record cache age and restore experience. If needed, add a safe maximum-age checkpoint for settled revisions, with coalescing and byte budgets. Do not force a full snapshot per streamed chunk.

**Verify:** long turns, repeated settling, shutdown and restart keep the promised display freshness without increasing write amplification or capturing inconsistent revisions.

## Navigation, workspaces and dependency storage

### R18 — Commit navigation once and reduce metadata mirrors

**P2 · Measured and source-confirmed.** Across ten resident switches, the fixture observed 97–99 launch-state reads and 40 writes. The manager separately persists workspace selection, launch selection and history; these serialize even when awaited through `Promise.all`. Tab registration adds another mutation. Counts cover the whole scenario, including renderer reactions.

Create one revisioned, atomic navigation commit returning the authoritative state. Maintain a validated memory mirror and skip idempotent updates. Consolidate thread-title/metadata ownership across the agent store, tab state and query caches. Remove redundant post-create refreshes only after proving the authoritative push has arrived. Eliminate unnecessary sequential metadata round trips and use pagination where needed.

**Verify:** switching and draft completion reduce measured IO without lost fields, stale tabs or wrong workspace selection; concurrent remote/UI changes and restart restore the same committed revision. Preserve the existing same-thread fast path.

### R19 — Make launch-state persistence atomic and recoverable

**P2 · Source-confirmed crash-consistency risk.** [launch-state.ts](electron/launch-state.ts) writes JSON directly and defaults state on read/parse errors. A partial write can therefore appear as a reset. No power-loss/torn-write incident was reproduced.

Use temporary-file replacement, appropriate durability and a last-known-good recovery strategy. Distinguish missing initial state from corrupt/unreadable state. Combine logically related selection/tab updates while retaining serialized mutation semantics.

**Verify:** injected partial writes, process termination, permissions failures and simultaneous mutations produce a valid previous/new state or a surfaced recovery path; never silently overwrite recoverable state with defaults.

### R20 — Move repository and fallback filesystem work off main

**P1 · Source-confirmed; small-worktree latency measured.** [worktree-manager.ts](electron/worktree-manager.ts) uses synchronous Git. The base-fetch path allows a 60,000 ms timeout; an optional setup helper runs a synchronous shell command without a timeout. Those long stalls were not reproduced. Worktree-list cache misses still validate synchronously, and file-mention fallback traversal also has synchronous work despite its asynchronous IPC surface.

Introduce asynchronous repository operations with per-repository ordering, cancellation, timeouts and structured errors. Refresh remote refs outside the critical interaction according to explicit verified-base freshness rules. Keep path containment, environment handling, dirty-worktree protection and rollback of only newly created resources.

**Verify:** delayed/hung Git and setup scripts cannot stall the main heartbeat or unrelated repositories; cancellation leaves valid Git registration and filesystem state. Measure cold/warm listing and creation on realistic repositories.

### R21 — Address dependency/build duplication separately from Git worktrees

**P1 · Measured local footprint; customer exhaustion not reproduced.** Git objects are already shared, but tracked checkouts, `node_modules`, build outputs and package-manager stores are separate storage categories. The earlier local scan found 13 managed worktrees; this checkout alone had 1,092,726,062 logical dependency bytes across 110,224 files. Its 1,423,790,080 allocated-byte reading can overcount shared APFS clone extents. Most other scanned worktrees were small.

Offer explicit source-only versus prepared-workspace policy, with per-project package-manager-aware setup. Show per-worktree dependencies/build outputs and shared caches separately. Provide a reviewable archive/cleanup workflow for known generated output, with dirty/untracked ownership checks. Investigate immutable/content-addressed dependency and build caching using the actual project's package manager.

**Verify:** repeat the affected user workload and measure logical bytes, physical allocation where supported, shared stores and regeneration costs. Serialized installs and opt-out do not deduplicate existing dependencies. Do not automatically delete user worktrees/untracked files or share writable `node_modules` through cross-branch symlinks.

### R22 — Bound installer job lifetime and pending work

**P2 · Source-confirmed; stuck installer not reproduced.** [The installation queue](electron/worktree-install-queue.ts) serializes and deduplicates work, preventing the earlier concurrent burst. Its global tail also allows one slow job to delay unrelated repositories. Pending jobs need cancellation/ownership when a workspace is deleted, plus explicit backlog and timeout handling.

Give jobs a workspace identity/version, revalidate existence at start, cancel queued deleted workspaces, and stop active process trees safely when appropriate. Expose queued/running/failed/skipped state. Keep bounded pending work; consider measured limited concurrency or repository scheduling rather than removing serialization.

**Verify:** delete/recreate a workspace while queued, hang a package manager, enqueue duplicates and saturate the queue. Confirm no install occurs in an abandoned/reused path and peak CPU/RAM/disk remain within the chosen policy.

### R23 — Share desktop and remote workspace lifecycle policy

**P2 · Source-confirmed divergence.** Desktop workspace IPC wraps worktree creation and automatic installation; [isolated-agent-task.ts](electron/isolated-agent-task.ts) directly creates a worktree. Setup behavior can therefore depend on the entry point.

Extract one lifecycle interface with explicit source-only/prepared policy, validated cwd, owned job state and cleanup. Let desktop/remote callers choose activation separately so remote setup does not steal UI focus. Roll back only resources created by the failing operation.

**Verify:** equivalent desktop and remote requests produce the same setup policy and status; cancellation, partial creation, existing directories and concurrent requests preserve user data and correct agent cwd.

### R24 — Build file-mention data lazily and cancel actual work

**P2 · Source-confirmed; major latency impact unmeasured.** [AgentPanel](src/components/agent-panel.tsx) requests workspace files on project/cwd changes even when mention UI is closed. Its cancellation flag drops stale results but does not cancel the underlying Git/traversal job.

Load on demand, coalesce by workspace revision, reuse an invalidated index, and perform walks asynchronously. Propagate cancellation or discard work before expensive phases where possible.

**Verify:** unopened mention UI avoids unnecessary scans; rapid workspace changes do not build a backlog; created/deleted files and uninitialized repositories still appear correctly when requested.

## Renderer, startup and terminal memory

### R25 — Avoid empty agent-store patches and narrow subscriptions

**P2 · Reproduced notifications.** [agent-store.ts](src/store/agent-store.ts) unconditionally calls `set` even when an event produces an empty patch. Delivering 100 terminal-output events caused 100 agent-store notifications while active session and panel projection identities remained unchanged. Terminal output was also correctly routed to its own store. Raw probe.

Skip empty patches after required event routing/accounting, and replace broad panel subscriptions with the actual selected state. Review the panel's compiler opt-out carefully because virtualizer compatibility matters.

**Verify:** permissions, titles, stop/running state and terminal delivery are unchanged; listener counts fall for irrelevant events. Measure React commits separately: notifications do not prove one render per event. Injected background updates exercise this path, but main normally suppresses background text deltas.

### R26 — Make streaming derivation incremental and measure event-to-paint

**P2 · Component cost measured; FPS impact unmeasured.** Reducer/projection caches and virtualized DOM already exist. Remaining array copies, tool-ID sets/scans and prefix-array reconstruction still grow with history. For 1,000 chunks, reducer-plus-projection medians ranged from 0.68 ms on an empty history to 33.82 ms with 1,500 prior entries and no tools. Independent cases contain JIT/GC noise and are not a monotonic model or DOM timing.

Use incremental tail/per-tool revision derivation and narrow subscriptions. Consider coalescing adjacent text updates with bounded latency while flushing permission, tool, stop and activation transitions immediately. Preserve ordering, stable IDs, optimistic echo reconciliation and interleaved tools/text. Background text does not inherently thrash the active projection because main filters it.

**Verify:** representative mixed streams produce identical conversation state, with event-to-paint and CPU measurements; compare GC and long tasks as well as helper timings. Preserve settled-entry referential identity and deferred diff extraction.

### R27 — Give renderer payload and diff caches byte budgets

**P2 · Measured retention and source-confirmed policies.** Main request-scoped hydration does not release [renderer tool bodies](src/store/tool-payload-store.ts). A production-module forced-GC probe retaining 24 × 512 KiB bodies held 11.90 MiB; cleanup released 11.51 MiB, with a final test reference able to retain one body. This was a Node worker, not Electron RSS. [diff-store.ts](src/store/diff-store.ts) can retain old/new file content for 100 threads by count rather than bytes. Resident runtime count limits likewise do not bound bytes.

Define byte-aware ownership for expanded bodies, diffs and resident runtimes, with active/in-flight pins and refetchable eviction. Persist complete content where required and release renderer copies when their consumers disappear. Track cross-process copies separately.

**Verify:** large-body expansion across many threads reaches a bounded retained footprint; eviction/refetch preserves exact content, open views and live updates. Avoid claiming an 8 MiB highlight cache or a session-count cap is an application memory ceiling.

### R28 — Establish real lazy-loading boundaries

**P2 · Source/build-confirmed; startup benefit unmeasured.** [App.tsx](src/App.tsx) lazily imports terminal code that is also statically reachable through [AdvancedShell](src/components/advanced-shell.tsx). The build reports the ineffective split. The renderer entry statically reaches 130 local runtime modules; this is dependency reachability, not execution duration or retained RAM. The large renderer-chunk warning also does not prove poor FPS.

Split at actual view/service boundaries and verify emitted chunks rather than adding a dynamic import beside a static path. Preserve required startup initialization and state restoration.

**Verify:** cold-launch milestones, available UI, first useful thread view and later terminal activation improve on repeated fresh processes without shifting a larger stall to first interaction. Include packaged artifact size and cache behavior.

### R29 — Budget hidden terminal continuity without corrupting terminal state

**P2 · Source-confirmed retention; per-terminal RAM unmeasured.** Still-open workspace terminals retain PTYs and, after activation, terminal cores even when stashed/hidden. Explicit close, workspace close and clear paths exist; they do not live forever unconditionally. Workspace terminals and ACP terminals have separate owners/caps. A 200,000-character history cap or 1 MiB scrollback/output limit is not a measured allocation or the complete WASM/grid/process footprint.

Measure 0/10/20 terminal workloads, including shell processes, cores, WASM, histories and hidden views. Introduce per-session and total budgets with an explicit continuity policy. If detaching a view from a live PTY, preserve actual VT state; plain recovery text strips escape sequences and does not prove fidelity for alternate-screen apps, cursor state or resize behavior.

**Verify:** shells, editors, full-screen programs, reconnect and resize survive any suspension/rehydration. Do not kill an inactive shell solely to meet a memory target. Benchmark history concatenation/flattening before replacing it with a deque; source alone does not prove full-buffer copying per chunk.

## Monitoring, attribution and regression protection

### R30 — Build and package the monitor worker explicitly

**P1 · Reproduced in the actual built app.** [worker-client.ts](electron/monitor/worker-client.ts) resolves `./worker.ts`, but that file is absent from the emitted main directory. The built app reports worker failure callbacks and continues through main-thread fallback. Artifact/runtime evidence corrects the earlier assumption that monitoring was running in a worker. Two error/exit callbacks can describe one failed worker, not two crashes.

Emit a JavaScript worker entry, resolve it correctly in development/build/package modes, and expose healthy-worker versus fallback mode. Define fallback behavior deliberately. `app.getAppMetrics()` already runs on main even with a healthy worker; fallback `ps` calls are asynchronous, so they should not be described as synchronous subprocess execution.

**Verify:** launch the actual built and packaged app, assert worker readiness and continued recording, then inject failure and inspect health/recovery. A source-level worker-constructor test is insufficient. Distributed installers and Windows remain unverified.

### R31 — Make monitoring overhead adaptive and measurable

**P2 · Source-confirmed recurring work; overhead percentage unmeasured.** Default sampling is approximately 1 Hz. Process attribution can issue up to two `ps` calls per non-main PID per tick according to source; this is not a measured syscall count. Sampling also obtains CPU information. The renderer performs a whole-document census every five seconds plus attribution queries; limiting the report to 24 entries does not bound the census. Mutation callbacks inspect changed subtrees/ancestry rather than rescanning the entire document per mutation.

Keep cheap always-on counters; batch/adapt expensive process detail and schedule DOM census according to need/idle budget. Preserve useful diagnostics when the monitor window is closed. Review RAF, scheduler and timer observation costs alongside the earlier visibility fix.

**Verify:** monitor closed/open/recording across 0/8/16/32 provider-plus-PTY workloads, measuring CPU, main/renderer long tasks, process launches and attribution fidelity. Set cadence from those results.

### R32 — Gate full monitor snapshot construction and deliver bounded updates

**P2 · Source-confirmed.** Live snapshots copy bounded rings of up to 300 ticks, 120 renderer samples, 600 ACP events and 600 bridge events. Construction can occur before the closed-window recipient drops the result. A closed monitor does **not** imply that full snapshots are IPC-serialized. When open, full snapshots may be cloned repeatedly on ticks and other changes.

Gate expensive construction by actual subscribers, send a full snapshot on attach, and use revisioned deltas or coalesced refresh thereafter. Add byte bounds and backpressure for slow subscribers. Existing queue-depth accounting describes pipeline work, not subscriber acknowledgements.

**Verify:** closed windows avoid unnecessary construction; reconnecting subscribers get complete state; slow consumers cannot grow memory or delay application event processing.

### R33 — Bound diagnostic retention while preserving always-on incident capture

**P2 · Measured historical footprint; growth policy source-confirmed.** The earlier installed database contained 4,977 freeze incidents occupying about 159 MiB of table pages. Of these, 3,814 had hidden/timer-drift flags, which alone do not prove every historical record false. The observer visibility bug was fixed, but old rows remain. Incident collection intentionally runs without manual recording; time-based probabilistic pruning and persistent recording history do not establish a byte ceiling.

Define age/byte/per-kind policies, coalesce episodes, and separate valuable incidents from redundant samples. Surface retention and storage categories, preferably in an isolated diagnostics store. Preserve intentional always-on signal; gating everything behind manual recording would remove useful failure evidence. Do not blanket-delete historical rows based on visibility flags.

**Verify:** repeated incidents and long recordings reach documented limits while retaining useful sequences; pruning has bounded cost; logical deletion and actual disk reclamation are reported separately.

### R34 — Join timing phases and maintain the benchmark entry points

**P2 · Source-confirmed attribution gaps.** `switchThreadInternal` starts timing after the main activation queue; the IPC wrapper includes that queue but excludes the renderer queue. Request completion, early display, agent readiness, navigation durability and paint are distinct. A RAF callback does not by itself establish completed pixel paint. Source import/IO graphs are not runtime traces. Existing `bench:fixture`, `bench:thread`, `bench:open` and `bench:query` scripts point at absent ignored `benchmarks/` files.

Propagate one correlation ID through renderer queue, IPC, main queue, preparation, display, ready, persistence and rendering milestones. Separate CPU from asynchronous waits and mark overlapping spans. Replace/repair unavailable benchmark commands with maintained tracked fixtures and scripts.

**Verify:** a delayed phase appears in the correct end-to-end trace, cold/warm/resident/restore cases are distinguishable, and clean-checkout benchmark commands run. Use rendering instrumentation appropriate to the claim instead of labeling IPC completion as paint.

### R35 — Establish representative end-to-end resource regression gates

**P1 · Evidence gap.** Existing isolated retention wins are real, but the short eight-mock-agent whole-app sample was too noisy to prove a total RAM reduction. Summed RSS double-counts shared pages; investigation process snapshots include unrelated/development descendants. No customer repository, real-provider memory baseline, production memory ceiling, Windows performance result or renderer FPS measurement was obtained.

Maintain workloads varying 1/4/8/16 threads, provider instances, workspaces, history lengths, payload sizes and terminal counts. Cover visible/hidden streaming, switches, reconnects, failures, nested delegation, installation and maintenance. Record heap, process-tree RSS and unique memory where available, peaks, GC/CPU/long tasks, logical/allocated disk, shared package caches, WAL and temporary space. Use controlled hardware, repeated fresh processes and explicit warmup.

**Verify:** baseline distributions and semantic/integrity assertions are reproducible in a clean checkout. Derive relative budgets from those measurements; do not invent thresholds or promise savings before measuring. Reproduce an affected user's disk workload when available. Extend coverage deliberately to supported platforms and separate native/mobile/marketing paths.

### R36 — Refactor around ownership boundaries and restore type-check confidence

**P3 · Maintainability concern; no direct speed claim.** The large connection manager mixes lifecycle, activation, snapshots and MCP concerns. Splitting it into forwarding wrappers alone would not change runtime cost. An apparently unused [older freeze observer](src/lib/monitor-freeze-observer.ts) duplicates concepts from the active observer, and compatibility exports should be distinguished from actual obsolete runtime dependencies. An earlier comparison found 94 baseline TypeScript diagnostic lines; build/test success is not a passing standalone type check.

Extract modules that own complete invariants: provider leases, prepare/activate, descendant scheduler, navigation commit, repository jobs, indexed snapshots and diagnostics retention. Confirm consumers before removing duplicates. Keep intentional ACP compatibility aliases; this is an ACP application, not a reason to rewrite around deprecated pi-sdk. Establish a type-check baseline/gate and resolve existing errors separately, prioritizing lifecycle and IPC contracts.

**Verify:** refactors preserve behavior and make ownership/failure tests simpler; enforce no new type diagnostics and eventually a clean full check. Require measurements for claims that structural changes improve speed or RAM.

## Earlier improvements already implemented

These findings should not be counted again as untouched problems. Remaining limitations are linked to the recommendations above. Full methodology and raw before/after data are in the resource report.

| Improvement                                                    | Verified result                                                                                                                                               | Remaining concern                                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Syntax-highlight weighted LRU                                  | 400 real-source blocks: median retained heap 51.30 → 8.04 MiB. Cache now has estimated-string limits of 8 MiB and 256 entries.                                | Mounted component state, grammars and other memory are outside the cache budget; oversized blocks can render without being cached. |
| Request-scoped persisted tool hydration in main                | Twelve controlled sessions: retained heap 17.42 → 2.80 MiB, with exact content/live-update checks.                                                            | Repeated gzip reads and renderer retention remain: R10, R27.                                                                       |
| Completed subagent cleanup, including copied previews          | Twenty-four completed reports: retained heap 24.08 → 0.57 MiB. Full transcript/transport references and V8 sliced-prefix retention were addressed.            | Active/queued establishment, deadlines and nested ownership remain: R03–R07.                                                       |
| Snapshot transcript-byte accounting and orphan cleanup         | Twenty-four text-heavy fixture threads with a 64 KiB budget: allocated snapshot files 909,312 → 81,920 bytes.                                                 | Full-table accounting cost, pinned soft-cap exceptions and cleanup lifetime: R11, R13–R14.                                         |
| Hidden timer/RAF freeze filtering                              | Controlled hidden throttling/visibility transitions no longer generate false starts; visible stalls still report.                                             | Historical data and diagnostic retention/overhead: R31–R33. Real Long Task observations remain enabled in background.              |
| Worker-based database compaction and Storage action            | Private backups retained all logical row hashes and passed integrity checks. Development DB 301.8 → 71.7 MiB; installed DB 255.5 → 208.7 MiB.                 | Shared write locks and temporary headroom remain: R15–R16. Live personal databases were not compacted in the investigation.        |
| Serialized/deduplicated installs and automatic-install opt-out | Actual Electron settings/worktree checks verified skipped installation; eight mock provider processes and real Git worktrees preserved complete tool history. | Default automatic install remains enabled; no existing dependency deduplication/reclamation: R21–R23.                              |
| Obsolete managed installer cleanup                             | Temporary-file tests preserve the current installer and unrelated files while removing obsolete managed installers.                                           | No production installer backlog or production savings were measured.                                                               |

### Second pass (15 October 2026)

| Recommendation | Change                                                                                                                                                                                                                                                                                                                                                       | Verification                                                                                                                                         | Remaining                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| R30            | Main build emits `out/main/monitor-worker.js`; `monitorWorkerUrl()` resolves it, and health reports `workerMode`.                                                                                                                                                                                                                                            | `scripts/verify-built-monitor-worker.mjs` on the built app: `workerMode: "worker"`, zero worker failures, samples recorded.                          | Packaged installers and Windows not run.      |
| R08, R09       | One failed snapshot write no longer disables writes for the session: debounced writes back off (2 s doubling to 5 min) and reset on success. Each thread keeps one active write plus one pending write that captures the latest state when it starts.                                                                                                        | Opt-in diagnostic: the other thread's flush writes after one failure; six flushes during a blocked write persist `revision-0` and `revision-5` only. | No visible degraded-mode UI.                  |
| R03, R04       | Subagents have one deadline covering queueing, connection, `session/new` and prompt. Queued waiters are removed on cancel; nothing is prompted after cancellation; a late `session/new` result is closed. A delegating subagent lends its slot to its child and reclaims it (ahead of new admissions) before resuming. Cancellation cascades to descendants. | Three new behavior tests plus the converted establishment and nested diagnostics.                                                                    | R05 job contract unchanged.                   |
| R19            | Launch state is written to a temporary sibling and renamed; the starting state is kept as `launch-state.json.bak` and used if the main file is corrupt. Identical writes are skipped.                                                                                                                                                                        | Two new launch-state tests.                                                                                                                          | Navigation write count (R18) not re-measured. |
| R22            | Install jobs receive an AbortSignal; workspace deletion cancels a queued install (skipped when reached) or stops the running process. Jobs skip a workspace that no longer exists. The 10-minute timeout already existed.                                                                                                                                    | New install-queue test.                                                                                                                              | Global serialization kept on purpose.         |
| R25            | Bridge events that produce an empty patch no longer call `set`.                                                                                                                                                                                                                                                                                              | Opt-in diagnostic: 0 notifications for 100 terminal-output and 100 background events.                                                                | React commit counts not measured.             |
| R28            | `AdvancedShell` lazy-loads `TerminalSession`.                                                                                                                                                                                                                                                                                                                | Build emits a separate `terminal-session` chunk.                                                                                                     | Startup timing not measured.                  |

R34 was not changed: the `bench:*` scripts refer to gitignored local files present in the main checkout.

Heap results use forced-GC controlled comparisons against the original commit; they are not physical-memory ceilings. The isolated savings must not be added together as a whole-app RAM promise. The single short-run process-tree RSS observation, 1,304.0 → 1,250.9 MiB, does not establish an application-wide improvement.

## Reproduction and acceptance checks

The systems below already exist. Use them as starting points for changes, then add targeted behavior/invariant checks where coverage is missing. Some opt-in diagnostic tests deliberately assert current adverse behavior; convert their assertions to the corrected outcome when implementing a fix.

```sh
# Dependency/IO inventory. This is a static map, not runtime coverage.
node scripts/analyze-architecture.mjs

# Three fresh Electron workflow runs with isolated fixtures and mock providers.
node scripts/benchmark-architecture.mjs --runs 3

# Actual snapshot/reducer/projection/cache component measurements.
# The database argument is optional; when provided, it is opened read-only.
PIPPER_ARCHITECTURE_BENCH=1 \
PIPPER_ARCHITECTURE_REPORT="$PWD/docs/architecture/component-measurements.json" \
PIPPER_ARCHITECTURE_DATABASE="/absolute/path/to/omni.sqlite" \
bun run test electron/architecture-costs.bench.test.ts \
  --maxWorkers=1 --execArgv=--expose-gc

# Four controlled reproductions: establishment, nesting, snapshots, store events.
PIPPER_ARCHITECTURE_SCHEDULING=1 \
bun run test electron/architecture-scheduling.bench.test.ts --maxWorkers=1

# Verify actual emitted monitor-worker behavior after building.
node scripts/verify-built-monitor-worker.mjs

# Source database read-only; writes/compaction use a disposable private backup.
node scripts/verify-compaction-contention.mjs /absolute/path/to/omni.sqlite

# Controlled before/after retention comparisons.
bun run bench:resources \
  --baseline 490f89626a4c63b85a3723cf00be55288b74d192 --runs 3

# Requires a current build; actual Electron, mock ACP processes and Git worktrees.
bun run bench:agents --check-settings

# Read-only resource accounting; substitute actual locations.
bun run audit:resources \
  --database /absolute/path/to/omni.sqlite \
  --directory /absolute/path/to/app-data
```

Prior investigation validation passed Doctor (100/100), lint (nine existing warnings), production/native build, formatting, and the ordinary test suite (855 passed; 12 opt-in cases skipped). The four scheduling diagnostics passed when explicitly enabled. See the exact validation record. That does not establish a clean standalone TypeScript check, packaged-worker success, Windows behavior or production performance. Re-run the repository-required checks and relevant workload when implementing each recommendation.

## Architectural guardrails for the proposed changes

- Keep canonical provider history, display snapshots, live transcripts and renderer caches as distinct ownership domains. Eviction of a cache must preserve access to required complete content.
- Keep one shared provider connection per instance where supported; acquire/release it through real owners rather than open-tab count.
- Preserve ordered transcript events, optimistic echo reconciliation, permission transitions and latest-activation fencing across cancellation and reconnect.
- Preserve hidden-window coalescing, background-delta suppression, settled-entry reuse, virtualized DOM and deferred expensive diff extraction.
- Preserve Git/path containment and user ownership. Cleanup must identify generated resources and avoid deleting dirty worktrees or unrelated files.
- Test failures, saturation, late completion and restart as well as the happy path. Accept a change for measured benefit and preserved invariants, not smaller files, moved code or an assumed optimization.
