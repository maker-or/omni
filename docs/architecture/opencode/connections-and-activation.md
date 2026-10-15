# Connections, Sessions, and Activation

Independent investigation of how Pipper establishes provider connections, keeps
thread (ACP session) state, and serializes "activation" work — and how those
lifecycles scale with agent count, thread count, and worktree count.

- **Worktree:** `.../worktrees/ac746c8c-.../performance`
- **Base revision:** `490f89626a4c63b85a3723cf00be55288b74d192`
- **Nature:** code reading + static analysis. No production code was modified.
  No benchmarks were run by this investigation; every number cited is either
  from an existing artifact (cited by path) or explicitly marked as a
  hypothesis that needs runtime verification.
- **Sibling reports (do not duplicate):** renderer startup / render graph,
  terminals, monitoring → `renderer-terminals-and-monitoring.md`; storage,
  worktrees, SQLite/migrations, manager state → `storage-and-workspaces.md`;
  monitor-worker build defect → `PRIMARY-VERIFICATION.md`.

Line numbers were re-verified against the **current worktree** (many files are
modified relative to the base revision, notably `agent-connection-manager.ts`).

---

## 1. The two registries and one queue

Three objects hold almost all connection/activation lifetime:

| Concern                                                       | Owner                                     | File                                       |
| ------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------ |
| Live provider transports, one per agent instance              | `ConnectionLifecycle`                     | `electron/connection-lifecycle.ts`         |
| Live thread runtimes (ACP session state), one per open thread | `ThreadSessionRegistry` (`this.sessions`) | `electron/thread-session-registry.ts`      |
| Serialized "one activation at a time" work                    | `threadActivationQueue`                   | `electron/agent-connection-manager.ts:286` |

`AgentConnectionManager` (constructed as `AgentManager` at `main.ts:3202`) owns
all three. `AgentManager` is **not** a subclass — `electron/agent.ts:5` re-exports
the same class under two names:

```
export { AgentConnectionManager, AgentManager } from "./agent-connection-manager.ts";
```

So every "manager" sentence in the prior reports refers to one type.

### Ownership map (what holds what, for how long)

- **`ConnectionLifecycle.connections: Map<agentId, LiveConnection>`**
  (`connection-lifecycle.ts:177`). One live transport per agent instance.
  `setActive` / `getCached` / `all` (`:192`/`:196`/`:201`), `terminateAll`
  (`:239`). **There is no idle timeout and no eviction.** A connection lives
  until `terminateAll()` (shutdown) or `removeAgentInstance` tears the instance
  down. This is the root fact behind the RAM story in §2.
- **`ThreadSessionRegistry` (`this.sessions`)** maps `threadId → runtime`
  (slice, cwd, projectId, agentId, `promptInFlight`, `activeTurnId`, tool
  payloads, snapshot-retention metrics). Runtimes are created by
  `switchThreadCore` (`:2191`) / `createThreadInternal` (`:2529`) and removed
  **only** by `closeThreadSessionInternal` (`:2749`) / `deleteThreadInternal`
  (`:2676`). Switching away from a thread does **not** release it.
- **`snapshotStore`** (`:257`) pins the on-disk snapshot of any thread that is
  currently resident: `isPinned: (threadId) => this.sessions.has(threadId)`.
  Closing a tab unpins and flushes; switching does not.
- **`threadActivationQueue`** (`:286`) is a single promise chain. Every public
  mutator — `switchThread` (`:2117`), `createThread` (`:2507`), `deleteThread`
  (`:2672`), `closeThreadSession` (`:2745`), and launch-state restoration
  (`:2039`) — funnels through `enqueueThreadActivation` (`:2011`).

### The queue's supersede rule

`enqueueThreadActivation` (`:2011`) aborts the _previous_ activation's
`AbortController` before starting the next (`:2017`), then chains on the prior
task's settled promise (`:2033` clears the handle if still current). New work
_does not jump the queue_; it waits for the current task to observe its abort
signal and unwind. Two consequences:

1. **Only the most recent activation matters.** If a user clicks through five
   tabs quickly, activations 1–4 are aborted; only the last does real work —
   provided each cooperates. The busy path requests the signal
   (`throwIfSuperseded` / `raceActivation` in `electron/activation.ts`) around
   `session/new`, `session/load`, `session/resume` (`:1883`, `:1963`, `:1996`).
2. **A slow task still blocks the queue until it finishes unwinding.** Because
   ACP is stdio JSON-RPC, an already-sent `session/new`/`session/load` cannot be
   cancelled mid-flight; the manager can only stop _waiting_ on it. These calls
   are bounded by `ACP_SWITCH_PHASE_TIMEOUT_MS` (default 10s, env
   `PIPPER_ACP_SWITCH_TIMEOUT_MS`, min 1000 — `connection-lifecycle.ts:22`) and
   `ACP_NPX_INIT_TIMEOUT_MS` (120s for the first `npx`-based spawn, `:28`).

This is the mechanism behind README's "one global queue" concern; see §4 for the
one place it is deliberately bypassed.

---

## 2. Findings

Each finding: mechanism → trigger → scaling cost → invariant/tradeoff →
proposed seam → regression test → priority. Priorities are `P0` (address
first), `P1`, `P2`.

### F1 — Provider processes are never idle-released; a health/catalog call can warm _all_ of them (P0)

**Mechanism.** `getModelCatalogs()` (`agent-connection-manager.ts:433`) builds a
result from three sources:

1. Selected + enabled-instance agents (`:441–451`), warmed via
   `acquireConnection` (`:452–460`), skipping agents whose driver is unknown;
2. `this.sessions.values()` — models seen on resident runtimes (`:479`);
3. `this.lifecycle.all()` — models seen on live connections (`:482`).

Then, for any selected agent whose result is still empty, it **probes a
temporary session**: `session/new` → read `models` → `session/close`
(`:493–541`, guarded by a `result[agentId]?.length` early return at `:503`, with
best-effort `catch` at `:534`). It does not early-return when the renderer
already has a persisted catalog — the warming is unconditional.

**Trigger.** The renderer calls it on **every** `selectedAgentKey` change.
`src/components/agent-panel.tsx:2163–2173`:

```ts
useEffect(() => {
  ...
  const catalogs = await window.omni?.agent?.getModelCatalogs?.();
  const remember = useModelCatalogStore.getState().remember;
  ...
  remember(agentId, models);
}, [selectedAgentKey]);
```

`selectedAgentKey` is `selectedAgentIds.join("\0")` (`agent-panel.tsx:778`), so
selecting/deselecting providers re-fires it. IPC entry point:
`main.ts:2721` (`agent:getModelCatalogs`).

**Scaling cost.** The warm step (`:452–460`) calls `acquireConnection(agentId)`
(detached spawn, does not flip active/preferred) for every warmed id, inside a
`Promise.all` — so toggling eight providers on warms up to eight connections
concurrently, and each is **retained for the app lifetime** (F2). The subsequent
probe then opens a temporary `session/new` and closes it (`:526–539`), but the
transport stays. Net: up to eight live provider processes rooted by a metadata
read.

**Invariant/tradeoff.** Read-only metadata (catalog) is fetched through a
side-effecting path (spawn a process). The renderer already persists catalogs
(`useModelCatalogStore`), so the "always refresh" behavior trades a hard RAM
bound for catalog freshness that the UI does not obviously need on every
selection change.

**Proposed seam.** Split "catalog" into (a) _known_ (from persisted store +
`lifecycle.all()` + resident runtimes, no side effects) and (b) _probe_
(explicit, user-initiated "Refresh models"). `getModelCatalogs` should read (a)
and only probe on an explicit miss/refresh. Alternatively keep the probe but
require a _lease_: if no thread from that agent is resident, close the transport
when the probe session ends.

**Regression test.** Unit: call `getModelCatalogs` twice with an empty catalog,
assert the second call does not spawn (spy on `ConnectionLifecycle`/
child-process). Behavior: assert `lifecycle.all().length` stays 0 after a
catalog round-trip when no threads are resident.

**Relationship to prior work.** README §1 and MEASUREMENTS
(`catalog-eight-agents` median 48.25ms, `catalog-repeat` 4.12ms) already name
this. This finding adds the **unconditional** nature and the coupling to the
never-evict rule (F2).

### F2 — No connection lease: transports outlive the work that needed them (P0)

**Mechanism.** `ConnectionLifecycle` has exactly two release paths:
`terminateAll()` (`connection-lifecycle.ts:239`, called from `AgentManager`
shutdown at `agent-connection-manager.ts:1329`) and instance removal
(`removeAgentInstance`, `agent-connection-manager.ts:412`). Nothing ties a
connection's lifetime to the set of resident runtimes that reference its
`agentId`.

**Trigger.** Any of: warming a catalog (F1), creating/opening a thread
(`createThreadInternal` calls `ensureConnection`/`acquireConnection` —
`:2529`+), or switching to a thread for an agent not yet connected.

**Scaling cost.** Linear in the number of distinct agent instances ever
_touched_, not in the number currently _used_. `acquireConnection` (`:1238`)
spawns _detached_ (does not flip active/preferred) for background work — a
phone-originated background thread therefore also roots a full transport. With
`PROFILE_ENV_BY_DRIVER` (`agent-instances.ts`) every instance has its own
profile dir, so these are genuinely separate processes.

**Invariant/tradeoff.** Connection reuse is the point (reconnect cost is high —
first `npx` spawn up to 120s). The missing piece is _bounded_ reuse: a lease
that expires when the last referencing thread/session is gone, with a short
grace so a quick tab-switch does not thrash.

**Proposed seam.** Add `ConnectionLifecycle.acquire(agentId) / release(agentId)`
(refcount) driven by `ThreadSessionRegistry` membership + explicit leases for
catalog/background work; evict on refcount 0 after a grace window. The queue in
§1 already serializes teardown, so eviction can reuse `terminateAll`-style
teardown per agent.

**Regression test.** Open N threads across N agents, close all tabs, assert
`lifecycle.all().length === 0` (after grace). Bench: RSS after the sequence.

**Relationship.** This is the lease README recommends ("lease or eviction based
on whether any thread is resident"). This report supplies the exact ownership
graph (`sessions` ↔ `lifecycle`) that the lease must be keyed on.

### F3 — Thread runtimes and their pinned snapshots persist across switches (P1)

**Mechanism.** `switchThreadCore` (`:2191`) creates/updates a runtime in
`this.sessions`, and switching away keeps it. Only `closeThreadSessionInternal`
(`:2749`) — invoked by `tabs:close` (`main.ts:2603` → `closeThreadSession`
`:2607`) or `deleteThread` (`main.ts:2582` → `deleteThreadInternal` `:2676`) —
calls `sessions.remove`, `releaseWorkspaceRoot` (`:1879`), and
`flushRuntimeSnapshot`. Because `snapshotStore.isPinned` is
`threadId => sessions.has(threadId)`, a switched-away-but-still-open thread also
keeps its snapshot pinned in the cache.

**Scaling cost.** Grows with _open tabs_, bounded above by the snapshot cache
budgets (`THREAD_SNAPSHOT_*` in `thread-snapshot-store.ts`: 512MB disk, 32MB /
4 entries memory) — but the _pin_ defeats LRU eviction for exactly the threads
the user is most likely to keep open. The slice itself is capped by the reducer
(`MAX_SESSION_ENTRIES = 2_000`, `MAX_SESSION_TOOL_CALLS = 500`,
`src/lib/acp-session-reducer.ts:43–44`), so per-thread memory is bounded; the
unbounded axis is the _number of retained runtimes_.

**Invariant/tradeoff.** Keeping a switched-away thread resident is what makes
warm switching cheap (README §2; MEASUREMENTS `resident-switches-10` median
68.73ms, avg 6.87ms). The tradeoff is that "resident" and "pinned" are the same
predicate, so a user with many tabs gets both the warm-switch win and the
retention cost with no way to opt into eviction for cold tabs.

**Proposed seam.** Distinguish _active_, _warm_ (resident, evictable), and
_persisted_ (snapshot only). Let `isPinned` track only the active + a bounded
warm LRU, not membership in `sessions`, so idle tabs can be spun down to
snapshots.

**Regression test.** `resource-retention.bench.test.ts` style: open K tabs,
touch only the first, assert resident runtime count is capped and inactive tabs
restore from snapshot.

### F4 — Background work roots the same heavy objects but is intentionally off the queue (P1)

**Mechanism.** `createThreadInternal` (`:2529`) with `opts.background` uses
`acquireConnection` (`:1238`, detached spawn), whereas foreground uses
`ensureConnection` (`:1210`, which flips active/preferred). The _public_
`createThread` still goes through the queue (`:2516`), but the background
continuation then proceeds **outside** the serialization for its prompt/stream
work.

**Trigger.** Phone-remote / headless thread creation
(`prepareIsolatedAgentTask`, `electron/isolated-agent-task.ts`).

**Scaling cost.** A background thread keeps a transport (F2) and a runtime (F3)
alive for the app lifetime even after the task finishes, and its stream work is
no longer a queue participant. The queue therefore does not protect foreground
switching from a background agent's event flood — that protection, if any, lives
in the broadcaster (see F6).

**Invariant/tradeoff.** Deliberately detached so a remote task does not block
the user's UI activation. The cost is a second, uncoordinated set of live
objects.

**Proposed seam.** Make background ownership explicit: a distinct lease type
that (a) auto-releases on task completion and (b) is visible to the eviction
policy so background transports are the _first_ to be reclaimed.

### F5 — The queue is global; independent projects/agents wait on each other (P1)

**Mechanism.** A single `threadActivationQueue` (`:286`) serializes _all_
projects and _all_ agents. `switchThread` (`:2117`), `createThread` (`:2507`),
`deleteThread` (`:2672`), `closeThreadSession` (`:2745`) all share it.

**Trigger.** Any activation anywhere.

**Scaling cost.** Worst case is one long activation (cold spawn up to
`ACP_NPX_INIT_TIMEOUT_MS` = 120s, or a slow `session/load` of a huge transcript
bounded by the 10s phase timeout) delaying unrelated project/agent work. The
supersede rule (§1) mitigates _rapid_ clicking but not a single genuinely slow
task: it blocks until unwind.

**Invariant/tradeoff.** One queue is simple and prevents interleaved
`setActive`/transport mutation. README §2 flags this; the important nuance (not
in README) is the **deliberate bypass**: `deleteThreadInternal` calls
`switchThreadInternal(replacement.id, "delete")` at `:2737` _without_
re-enqueueing, precisely because re-entering the queue from inside a queued task
would deadlock. That pattern is correct but fragile — any future code that
enqueues from within a queued task will hang.

**Proposed seam.** Key the queue by `{projectId}` (or `{projectId, agentId}`)
with a small global cap, so cross-project work parallelizes while same-key work
stays serialized. Document the "never enqueue from inside the queue" invariant
and add an assertion for it.

**Regression test.** Two projects, project A activation stalls; assert project
B activation completes before A. Add a reentrancy guard test.

### F6 — Broadcast coalescing is the pressure valve, and it is renderer-visibility-keyed (P2)

**Mechanism.** `renderer-broadcaster.ts` coalesces only
`COALESCIBLE_WHEN_HIDDEN = {session-update, thread-tool-calls}` when the window
is hidden; `attention` (macOS Cmd+Tab) is broader than `visibility`. Tool-call
payloads are capped (500) and orphans evicted (`syncToolPayloads` `:639`,
`evictOrphanToolPayloads` `:648`).

**Scaling cost.** When the window is _visible_, every `session-update` from
every resident/background thread is forwarded immediately. With many live
**background** threads (F4), this is the actual backpressure point, since F4's
work is off the activation queue.

**Invariant/tradeoff.** Coalescing keyed on hidden-state is a UI-latency
optimization, not a throughput bound; there is no per-thread or global queue
depth limit on the renderer→renderer channel.

**Proposed seam / test.** Add a bounded coalescing window independent of
visibility (e.g. always coalesce non-active threads), and a test asserting the
number of IPC messages per second is bounded under a synthetic multi-thread
event storm (`renderer-coalescing.test.ts` is the harness).

### F7 — Slow-failure paths hold the queue for the full timeout (P1)

**Mechanism.** Permission requests settle after `PERMISSION_TIMEOUT_MS` =
120_000 (`permission-coordinator.ts:8`) or on cancel-for-session
(`:161`). Prompts settle after `ACP_PROMPT_TIMEOUT_MS` default 45min
(`prompt-scheduler.ts:5`). Both are swept on connection close (`abortAll`
`:69`, `cancelForSession` `:161`), but a wedged provider that neither errors nor
closes keeps `promptInFlight` true and the runtime alive indefinitely
(45 min default).

**Trigger.** Provider hang (auth loop, network stall) without transport error.

**Scaling cost.** A hung foreground prompt blocks subsequent prompts on that
thread (FIFO per thread) and keeps a runtime + transport rooted; if it is the
active-queue task, it blocks switching (F5).

**Proposed seam.** Require an explicit prompt deadline shorter than the
"legacy" 45min for foreground turns, or emit periodic progress and abort after
N seconds of no session-update. Expose "hung thread" state to the UI.

**Regression test.** `prompt-scheduler.test.ts` already covers queue drain on
abort (`:69`/`:98`); add a no-progress watchdog test.

---

## 3. Subagent connections (adjacent but distinct ownership)

`electron/subagents/subagent-manager.ts` maintains its own registries:
`tokens: Map`, `runs: Map`, `runsBySession: Map` (`:140–142`), plus an embedded
MCP HTTP server (`:306` close, `:328` start) and a per-run stdio proxy.

- Concurrency: `maxConcurrent` default 3, `maxDepth` 2, `runTimeoutMs` 10min
  (`subagent-config.ts`); enforced at `:212`/`:418`.
- **Per-run MCP endpoint + token are released after every run** — this is
  asserted in `subagent-manager.behavior.test.ts:181` ("releases the per-run MCP
  endpoint and token after every run"), and a timed-out prompt releases its slot
  even when cancel is ignored (`:205`). This is the _good_ counterpart to F2:
  subagent resources are leased per run.
- Auto-approve for headless sessions (`:278`→`:285`) resolves permissions with
  no UI surface, bypassing `PermissionCoordinator`'s 120s timer — correct, but it
  means subagent permission load is invisible on the main pending map.

Server-side hard limits exist: `REQUEST_TIMEOUT_MS = 30_000`,
`MAX_IN_FLIGHT_PER_ENDPOINT = 16` (`mcp-http-server.ts`). Net: subagent
lifetime is well-owned; the top-level provider connections (F1/F2) are not.

---

## 4. Audit of prior-report claims

| Claim                                                                                                            | Verdict                                 | Evidence                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| README §1: catalog warming spawns one process per selected agent; renderer persisted catalog does not prevent it | **Confirmed**                           | `agent-connection-manager.ts:433–541` (unconditional warm); `agent-panel.tsx:2163–2173` (fires on `selectedAgentKey`); `main.ts:2721` |
| README §2: create/switch/close/delete share one queue → head-of-line blocking                                    | **Confirmed, with nuance**              | `:2011`, `:2117`, `:2507`, `:2672`, `:2745`; supersede at `:2017`; deliberate non-enqueued nested switch at `:2737`                   |
| README: recommend a connection lease / eviction                                                                  | **Confirmed necessary**                 | `connection-lifecycle.ts` has no eviction; only `terminateAll` (`:239`) and `removeAgentInstance` (`agent-connection-manager.ts:412`) |
| MEASUREMENTS: cold-provider-thread 66.27ms / warm 4.30ms / resident-switches-10 68.73ms                          | **Accepted as cited** (not re-measured) | `docs/architecture/MEASUREMENTS.md`; captured 2026-10-15, darwin/arm64, 3 fresh processes; "observations, not promises"               |
| MEASUREMENTS: `catalog-eight-agents` 48.25ms, `catalog-repeat` 4.12ms                                            | **Accepted as cited**                   | same artifact                                                                                                                         |
| `AgentManager` is a separate class from `AgentConnectionManager` (implied by naming in some notes)               | **Corrected**                           | `electron/agent.ts:5` re-exports the same class under both names                                                                      |
| PRIMARY-VERIFICATION: monitor worker not built; `out/main/worker.ts` absent                                      | **Not re-verified here** (out of scope) | `docs/architecture/opencode/PRIMARY-VERIFICATION.md`; `electron/monitor/worker-client.ts:235`                                         |

No prior-report claim was found to be _wrong_; the additions are the
unconditional-probe detail (F1), the pinned-resident coupling (F3), the
intentional queue bypass (F5), and the subagent per-run lease contrast (§3).

---

## 5. Required runtime verification (owner: primary agent)

Static analysis cannot settle these; they need instrumented runs so numbers are
never invented:

1. **RSS vs. distinct agent instances touched.** Open/close threads across N
   agents, measure process count and RSS before/after closing all tabs. Expected
   (hypothesis): process count stays at N (F2).
2. **Catalog → process count.** Toggle 8 providers on, call
   `getModelCatalogs` repeatedly, count spawned children. Expected: up to 8
   retained (F1).
3. **Queue head-of-line.** Stall a `session/load` on project A (large
   transcript), start a switch on project B, measure B's completion. Expected:
   B waits up to the 10s phase timeout (F5).
4. **Background stream pressure.** Many concurrent background threads, window
   visible, count renderer IPC messages/sec (F6).

Requesting these rather than running them because parallel investigators are
active and benchmarks/Electron runs are heavyweight.

---

## 6. Files reviewed

Central: `electron/agent-connection-manager.ts` (full), `electron/agent.ts`,
`electron/connection-lifecycle.ts` (full), `electron/activation.ts`,
`electron/prompt-scheduler.ts`, `electron/permission-coordinator.ts`,
`electron/thread-session-registry.ts`, `electron/thread-snapshot-store.ts`,
`electron/renderer-broadcaster.ts`, `electron/main.ts` (agent/thread/tab IPC +
manager wiring), `electron/terminal-manager.ts`, `electron/child-process.ts`,
`electron/isolated-agent-task.ts`, `electron/agents/registry.ts`,
`electron/agent-instances.ts`.
Subagents: `electron/subagents/{subagent-manager,subagent-config,mcp-http-server,stdio-proxy}.ts`.
Renderer: `src/components/agent-panel.tsx`, `src/store/{agent-store,thread-store,model-catalog-store}.ts`, `src/lib/thread-actions.ts`, `src/lib/acp-session-reducer.ts`.
Tests/benches: `electron/{cancellable-activation,prompt-scheduler,permission-coordinator,agent-instances,push-state-snapshot,renderer-coalescing,architecture-costs.bench,resource-retention.bench}.test.ts`, `electron/subagents/subagent-manager.behavior.test.ts`, `src/store/*.behavior.test.ts`.
Docs/artifacts: `docs/architecture/{README,MEASUREMENTS,FILE-MAP,VALIDATION}.md`, `docs/architecture/opencode/{PRIMARY-VERIFICATION,renderer-terminals-and-monitoring,storage-and-workspaces}.md`, `docs/architecture/*.json`, `docs/performance/*.json` (referenced, not re-derived).

## 7. Gaps / not investigated

- No runtime measurement of any hypothesis (§5) — by design.
- `electron/monitor/*` internals (owned by PRIMARY-VERIFICATION).
- SQLite/compaction contention and worktree-creation lifetime (owned by
  `storage-and-workspaces.md`).
- Renderer render cost of the catalog store (`model-catalog-store.ts` consumers
  beyond `agent-panel.tsx`).
- Whether `session/load` transcript size is itself bounded (relates to F5 but is
  a storage concern).

---

## 8. Summary

Pipper has **three independent lifetime problems layered on one small set of
objects**: (1) provider transports that are never released (F2) and can be
_created for free_ by a metadata call (F1); (2) thread runtimes + pinned
snapshots that survive switching (F3), including detached background work that
escapes the queue entirely (F4); and (3) a single global activation queue (F5)
whose real risk is one genuinely slow task, softened by a supersede rule and a
correct-but-fragile reentrancy bypass. Subagent connections are the counterexample
that proves the fix is possible: they lease per run and release reliably (§3).
The smallest high-leverage change is a **connection lease keyed on resident
threads**, which is exactly what the prior README recommends; this report adds
the precise ownership graph it must be built on (`sessions ↔ lifecycle`),
separates catalog _read_ from catalog _probe_, and calls out the pinned-resident
coupling and the queue bypass that any refactor must preserve.

**Report:** `docs/architecture/opencode/connections-and-activation.md`
