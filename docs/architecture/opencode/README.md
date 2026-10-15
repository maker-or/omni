# OpenCode deep exploration — reviewed findings

15 October 2026. Three **actual OpenCode `explore` subagents completed**, covering connections/activation, storage/navigation/workspaces, and renderer/monitor/terminals. [Execution metadata](cli-exploration-run.json) records the three Task results and session IDs; OpenCode used its configured model. Their complete reports and synthesis are preserved below. This is an extension and critical review of the [earlier architecture investigation](../README.md).

Primary-agent verification reproduced important findings, corrected overstatements and added the scheduling experiments. No application implementation was changed in this pass. New code consists of reproducible diagnostic scripts and opt-in tests.

## Results that change the priorities

| Priority | Finding                                                                                                                         | Evidence                                                                                | Architectural change                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Subagent session establishment is outside the run deadline; cancellation during establishment can still dispatch a prompt later | Production manager + real MCP loopback with a scripted delayed provider and fake clock  | One deadline/signal across queue, acquire, session creation and prompt; release or close late results before dispatch                   |
| High     | Nested subagents can exhaust their own execution slots while parents wait for them                                              | Production manager + real MCP loopback, one-slot controlled reproduction                | A scheduler that distinguishes executing work from parents awaiting descendants, plus bounded pending work and cancellation propagation |
| High     | The monitor worker is missing from the current build; failure falls back to main                                                | Actual built Electron app, public monitor interface, artifact inspection                | Explicit worker build/package entry, readiness test and visible degraded-mode policy                                                    |
| High     | One snapshot-write error disables display-snapshot writes for all threads for the rest of the process                           | Production public flush methods with an injected write failure                          | Scope/retry recoverable failures; expose degradation and bound retained live payloads                                                   |
| High     | Worker VACUUM can still stall a synchronous writer                                                                              | Actual compaction implementation on a private SQLite backup; 1,219.6 ms blocked write   | Shared-database maintenance policy and asynchronous ownership of write waits                                                            |
| Medium   | Snapshot writes serialize pending revisions rather than keeping only the latest                                                 | Six queued flushes produced all six captured revisions; one tail-map entry              | One active write plus a replaceable latest pending revision per thread, with explicit flush/version semantics                           |
| Medium   | Delivered ignored bridge events notify the whole agent store without changing the active session/projection                     | 100 terminal-output events → 100 store notifications; active state/projection unchanged | Keep terminal delivery, skip empty agent-store patches and narrow UI subscriptions                                                      |

These priorities concern reliability and resource ownership together. No measured RAM saving, production hang frequency or UI frame-rate improvement is claimed. Earlier measured catalog warming, synchronous Git, gzip amplification, disk-budget queries and worktree dependency growth remain relevant; the new findings identify additional failure paths and missing guarantees.

## 1. Subagent deadlines do not cover establishment, and cancellation arrives too early to work

OpenCode's connections explorer identified the bare `session/new` await at `electron/subagents/subagent-manager.ts:468`. The prompt timeout is only installed at line 482, after queue admission, connection acquisition, MCP attachment and session creation. A configured “run timeout” is therefore a prompt-phase timeout, not a bound on the complete operation. Queue admission at line 451 also precedes the `try/finally` that releases a slot.

The [saved reproduction](establishment-deadline-verification.json) uses the actual manager and its real HTTP tool interface. A scripted provider holds `session/new`. With a 30,000 ms configured timeout, advancing a fake clock 60,000 ms leaves one run running, another queued and **zero callers settled**. Cancelling the parent sends no provider cancellation because the run has no session ID yet. Releasing session creation manually then results in **one prompt request being sent despite cancellation**, before both tool calls settle as cancelled. The source checks `run.cancelled` before establishment and after the prompt; it does not fence prompt dispatch after the establishment await.

This proves the local state-machine behavior, not that a real OpenCode/provider session hung in this investigation. In particular, it is not a diagnosis of the 300-second MCP errors below.

The interface should carry one operation deadline and cancellation signal through every phase. A late `session/new` result must acquire an owner or be closed; cancellation must be checked before sending work. Slots must be released even when establishment never answers, while disposing a shared provider process must respect other sessions and leases. Test both “never responds” and “responds after local cancellation,” including MCP endpoint cleanup.

## 2. Nested work can be queued behind the parent that needs it

`SubagentManager.acquireSlot` at line 546 counts all admitted runs, including a parent waiting for a nested `spawn_subagent` result. Depth permits descendants; the same global concurrency limit controls their execution. If all slots are occupied by waiting parents, their children cannot acquire a slot.

The [controlled reproduction](nested-scheduling-verification.json) uses one slot and maximum depth two. Before the parent deadline, the parent is running and its child is queued; only the parent's provider session has started. Advancing the fake clock to the 30-second prompt deadline cancels the parent, releases its slot and then lets the child start and finish. This also demonstrates that an already-queued descendant can outlive its parent's timeout. The one-slot fixture is the simplest saturated case; it is not a measured default three-slot workload or 30 seconds of wall-clock delay.

Changing the cap alone does not resolve the dependency cycle. The scheduler needs explicit parent/child ownership, cancellation of queued descendants and a distinction between work executing and a parent awaiting delegated work. Alternatives include yielding a parent's execution permit while it awaits children, or a deliberately bounded descendant scheduling policy. Verify that fairness, recursion depth and true concurrent resource limits remain enforced. Do not merely exempt every child from limits.

## 3. The current monitor build falls back to main

The primary agent checked `out/main/index.js` and launched that actual build with temporary user data and a local mock registry. `new Worker(new URL("./worker.ts", import.meta.url))` remains in the bundle, while the resolved file does not exist. The public monitor interface reports worker failure callbacks and continued sampling. The fallback implementation runs synchronous recording/pruning operations on the caller's main thread.

[Exact build hash and runtime evidence](monitor-worker-verification.json), [verification details](PRIMARY-VERIFICATION.md).

The previous report's statement that most sampling/recording ran in a worker was incorrect for this build and is corrected. `app.getAppMetrics()` already runs on main even with a healthy worker; it is not a fallback-specific cost. Also, the `ps` children are launched asynchronously in the fallback; the new finding does not mean each subprocess call is itself synchronous.

Fix the emitted artifact and test worker readiness in a built app, including packaged path resolution. Expose execution mode in health so fallback is distinguishable from healthy isolation. The two failure callbacks in the artifact can arise from error and exit on one worker; they are not two independent worker crashes. No CPU-overhead percentage or distributed-installer result was measured.

## 4. A transient snapshot failure has process-wide consequences

OpenCode's storage explorer identified `snapshotWritesDisabled = true` in `AgentConnectionManager.queueSnapshotWrite` at line 717. Every subsequent thread's scheduling/write path checks that flag. There is no recovery path in the running process.

The [verified fault injection](snapshot-queue-verification.json) invokes the actual public `flushThreadSnapshot` implementation with controlled storage. One write throws once; a second thread's flush never invokes storage. Both flushes return false. This verifies the global fail-stop policy rather than claiming a real disk failure occurred.

The distinction between a **display cache** and canonical agent history matters. Disabling these snapshots is not proof that all conversation history is lost: providers can persist and replay their own histories. It does remove the fast display-cache write path. It can also prolong retention of live tool bodies: that map is cleared after successful snapshot persistence at lines 705–711, which cannot happen while writes are disabled.

The existing guard avoids repeated failures against a broken/full disk; simply removing it can produce a retry storm. Scope failures, classify retryable conditions, back off, surface degradation and define a memory policy when persistence is unavailable. A new-thread snapshot should not be suppressed forever because an unrelated old generation failed once. Test errors before commit, after commit during cleanup and after disk recovery.

The compaction probe below reproduced a successful delayed write, **not** a 5-second busy-timeout exception. Its result does not prove compaction triggered the global-disable path. That composition remains a possible failure path requiring a separate injected/long-lock check.

## 5. Moving compaction to a worker does not isolate shared-database waits

The production compaction worker runs VACUUM on its own connection; main uses `DatabaseSync` with a 5-second busy timeout. Both access the same SQLite database. Writer exclusion remains shared.

On a private backup of the local database, an uncontended probe update took 0.046 ms. A write deliberately attempted after detecting the VACUUM lock waited **1,219.60 ms**, and a 5 ms heartbeat observed a **1,220.57 ms** gap. Integrity remained `ok`. The worker reported checkpoint busy; database-plus-WAL bytes temporarily grew instead of immediately shrinking.

[Raw evidence](compaction-contention-verification.json), [complete setup and limitations](PRIMARY-VERIFICATION.md).

This is one controlled contention observation, not Electron paint timing or an estimate of incident frequency. It corrects the assumption that “VACUUM runs in a worker” alone proves the rest of the application remains responsive. Maintenance and synchronous application writes need a shared policy; longer term, asynchronously owned storage avoids blocking main while SQLite waits. Keep SQLite's transactions and rollback guarantees.

## 6. One promise-map entry is not a bound on pending snapshots

The storage explorer described snapshot writes as “keep-latest-bounded.” Source and the [queue reproduction](snapshot-queue-verification.json) contradict that claim. The 2-second debounce coalesces timers **before enqueue**, but `queueSnapshotWrite` captures a slice and payload map for every enqueue and chains it behind the prior promise. Replacing the map's tail reference does not remove those closures.

Six concurrent public flush requests for distinct revisions produced **six writes in order**, while `snapshotWriteChains.size` was one. The fake storage adapter blocks the first write to expose the queue; it does not measure retained bytes or how often normal users build this backlog. A slow disk, repeated flush requests or sustained settling during long writes are workloads to investigate.

Use one in-flight write and one replaceable pending input where display-cache semantics allow it. A flush promise should specify which revision it guarantees persisted. Preserve live-body revision fencing, shutdown/close durability, base-generation selection after the previous write, and reader ownership. Prove that a later payload update cannot be cleared by an older successful write.

## 7. Ignored events still produce store notifications; projection and paint are separate

OpenCode's renderer explorer identified unconditional `set` at `src/store/agent-store.ts:795`. `applyBridgeEvent` can return an empty object, which still creates a new Zustand root state and notifies listeners.

The [renderer-store probe](ignored-event-verification.json) delivers 100 ACP terminal-output events through the actual bridge callback. Terminal output is routed correctly to its own store, but the agent store also emits **100 notifications**, while its active session object and panel snapshot remain identical. Injecting 100 background text updates exercises the same defensive no-op path and also emits 100 notifications.

The main manager normally suppresses background text deltas, so the injected case is not proof that those deltas traverse production IPC. Terminal output is a real delivered event type. No React render/commit, DOM or paint count was measured; those cannot be inferred one-for-one from subscription callbacks.

Skip genuinely empty agent-state patches while keeping terminal routing, notifications and monitor accounting. Narrow panel subscriptions. Verify that removing a no-op write does not drop permission, title, stop, terminal or other out-of-band behavior.

## Corrections and findings retained as hypotheses

| Reviewer claim                                                                          | Primary disposition                                                                                                                                                     |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot failures mean total permanent conversation persistence loss                    | Overstated. The process disables **display-snapshot writes**; provider history is a separate owner.                                                                     |
| The snapshot queue keeps only the latest pending input                                  | Rejected by the six-revision reproduction. Serialization and a single map tail do not imply coalescing.                                                                 |
| Background streaming inherently thrashes the active projection                          | Rejected as a general statement. Main suppresses background text deltas; renderer filters mismatched threads; the verified cost concerns delivered no-op notifications. |
| A store notification means a rendered React commit per chunk                            | Not established. The probe counts notifications only; React batching/scheduling and visible rendering require a separate test.                                          |
| Every activated terminal stays allocated forever                                        | Too broad. Explicit terminal close, workspace close and clearing remove sessions; hidden **still-open** terminals retain their cores.                                   |
| The 1 MiB scrollback limit plus 200k-character history is the measured RAM per terminal | Rejected. Those are limits, not measured allocations or complete accounting for WASM/grid/other state.                                                                  |
| Mutation counting scans the whole document on every mutation                            | Rejected. The mutation callback walks attribution ancestry and changed subtrees; a separate periodic census scans the document every five seconds.                      |
| Gate all freeze incidents behind manual recording to remove overhead                    | Not adopted. Always-on diagnostics are intentional. Bound/summarize incident retention and measure overhead while preserving the signal.                                |
| PTY history concatenation necessarily copies the full retained buffer per chunk         | Not proven by source alone; JS string representation and flattening matter. Benchmark representative terminal workloads before assigning complexity/priority.           |
| Evicting terminal cores and replaying plain recovery text preserves all terminal state  | Not established. Alternate-screen applications, cursor state and control sequences require richer fidelity tests/state handling.                                        |
| Snapshot debounce starvation proves canonical conversation data loss                    | Not established. These are settled display snapshots; avoiding mid-turn writes is intentional. Measure cache freshness separately from provider history durability.     |
| Late successful abandoned session establishment can retain MCP endpoints                | Plausible source-derived path from the connections explorer; no runtime reproduction yet. Test late replies and ownership cleanup before quantifying a leak.            |
| Generation unlink behavior is uniformly unsafe on Windows                               | Not verified on Windows. Reader leases/open-before-unlink races and cleanup failures deserve platform tests; no universal OS result is claimed.                         |
| A numeric generation counter alone fixes body-reader lifetime                           | Insufficient. Readers need a valid immutable generation/open handle or lease, with deferred cleanup.                                                                    |

The snapshot-memory LRU and payload-disk budget already exist. Their accounting units and exceptions should be documented; “there are no byte budgets anywhere” would be false. Likewise, making selected-provider catalog results cached does not alone make unused provider processes stop: lifecycle ownership/idle leases remain necessary.

## Execution provenance and original tool failures

The first three broad `pipper-subagents/spawn_subagent` calls selected `opencode-acp`; all returned a client error: `timed out awaiting tools/call after 300s`. A narrower storage retry returned the same error. [Exact recorded errors](mcp-call-results.json). Two source-review files appeared, but those calls do not prove successful completion or cancellation. `storage-and-workspaces.md` is incomplete; `renderer-terminals-and-monitoring.md` is an earlier raw report containing claims corrected above. Neither is the accepted summary.

The recovery used `opencode run` and its own Task tool, dispatching three actual `explore` subagents in parallel. All three Task results completed without truncation and the CLI exited zero. [Task/session/model provenance](cli-exploration-run.json). The final CLI synthesis is preserved, including its own overstatements, rather than silently rewritten to look independently verified.

This execution also exposes a protocol mismatch: the observed MCP client waits 300 seconds; Pipper's default subagent prompt deadline is 600 seconds (`electron/subagents/subagent-config.ts:14`), and establishment/queue wait are outside that timer. The server awaits completion before sending a tool response (`mcp-http-server.ts:196,236`). A client timeout does not prove backend cancellation. Long tasks need a deliberate end-to-end contract: bounded whole-operation deadlines or durable start/poll/cancel jobs with progress. Audit the actual clients before choosing timeout values. This mismatch does not prove the nested-slot or stalled-establishment cases caused these four tool failures.

## Reports and reproduction

Completed OpenCode source reviews:

- [Connections and activation](connections-explorer.md) — [exact Task output](connections-explorer.json).
- [Storage, navigation and workspaces](storage-explorer.md) — [exact Task output](storage-explorer.json).
- [Renderer, monitoring and terminals](renderer-explorer.md) — [exact Task output](renderer-explorer.json).
- [OpenCode integrated synthesis](INTEGRATED-EXPLORATION.md).

Primary verification:

```sh
# Four diagnostic tests, opt-in because they reproduce current adverse behavior.
PIPPER_ARCHITECTURE_SCHEDULING=1 \
bun run test electron/architecture-scheduling.bench.test.ts --maxWorkers=1

# Requires an existing app build; isolates its user data and Git fixture.
node scripts/verify-built-monitor-worker.mjs

# Opens the source read-only; compacts/writes only a private disposable backup.
node scripts/verify-compaction-contention.mjs /absolute/path/to/omni.sqlite
```

The diagnostic tests use actual production methods with controlled provider/storage dependencies; they assert behavior rather than fabricate production frequency, timings or RAM savings. The scheduling probes use fake clocks. A fix may deliberately make one of these adverse-behavior reproductions fail; convert it to the expected corrected outcome when implementing that fix. They are not ordinary correctness expectations for the intended future behavior.

A live process inventory is also [preserved](live-process-snapshot.json). It includes existing provider sessions and investigation/development descendants. It is not a clean application baseline or an attribution of memory to these three tasks. Do not use its summed RSS as unique physical RAM or a before/after improvement.

Validation is recorded in [the follow-up validation log](VALIDATION.md). This pass has not implemented the recommended architecture changes, verified a distributed installer, run Windows tests, reproduced a real-provider session-establishment hang, or measured renderer FPS. Coverage is the source paths listed by each explorer and the explicit primary probes, not a claim that every repository file was manually re-reviewed.
