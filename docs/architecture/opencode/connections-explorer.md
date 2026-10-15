# OpenCode explore subagent: connections

This is the preserved subagent report. Read [the primary review and evidence classifications](README.md) before treating individual claims as accepted findings.

# Connections / Activation — architecture exploration

Scope: `electron/connection-lifecycle.ts`, `electron/agent-connection-manager.ts`, `electron/subagents/subagent-manager.ts`, plus the cancellation primitives and tests they depend on (`electron/activation.ts`, `electron/cancellable-activation.test.ts`, `electron/subagents/subagent-manager.behavior.test.ts`, `electron/prompt-scheduler.ts`). Read-only; no commands that mutate state. I could not run any test, spawn a real ACP agent, or observe runtime behavior — all evidence below is code-read, with test-backed points marked.

A cross-cutting note on the cancellation model, so the findings read correctly. There is a real `AbortSignal` plumbed through the activation queue (`activation.ts`, `raceActivation`), but cancellation is purely **cooperative/local**: an aborted activation settles its own promise while the underlying ACP stdio request keeps running to completion or timeout detached. This is documented in `electron/activation.ts:7-13` and implemented in `raceActivation` (`electron/activation.ts:40-64`). So "does in-flight work stop?" is answered "no" by design for ACP requests.

---

## NEW findings

### NEW 1 — Subagent `session/new` has no timeout: it can hold a concurrency lease forever and ignores cancellation

- Exact source: `electron/subagents/subagent-manager.ts:468-471` (bare `await connection.agent.request(acp.methods.agent.session.new, …)` with no `requestWithTimeout`). The only timeout in the run wraps the _prompt_: `electron/subagents/subagent-manager.ts:482-492`. `runTimeoutMs` is referenced only there (default 10 min, `electron/subagents/subagent-config.ts:14`).
- Trigger: `spawn_subagent` → `runSubagent` acquires a slot at `:451`, spawns/acquires the connection at `:458` (bounded by initialize), attaches MCP at `:462`, then awaits `session/new`. If an agent accepts the initialize handshake but never answers `session/new`, the await never settles. A hung `session/new` causes a hang and nothing else — it is not a timeout/throw, so the `finally` at `:516-543` (which calls `releaseSlot()` at `:540`) never runs.
- Cost / ownership reasoning: `activeRuns` (`:143`) never decrements, so one provider that stalls in `session/new` permanently consumes one of `maxConcurrent` (default 3) subagent leases. Subsequent `acquireSlot()` callers push onto `slotWaiters` (`:546-557`), which is an unbounded array, and their MCP tool calls block indefinitely. Cancellation cannot break it: `cancelRun` (`:311-322`) only sends `session/cancel` when `run.connection && run.sessionId`; `run.sessionId` is null until `:472`, so a cancel arriving during a hung `session/new` is a no-op. `dispose()` (`:301-309`) sets `disposed` and calls `cancelRun`, which is likewise unable to interrupt a hung `session/new`.
- Evidence level: **code-read only** for the hang; the slot-release-on-prompt-timeout path is **test-backed** (`subagent-manager.behavior.test.ts:205-240` proves slots release when the _prompt_ times out, which is exactly the case that has a timeout — it does not cover `session/new`). I could not verify whether real agents ever stall in `session/new`.
- Safeguards already present: `acquireConnection` is bounded because `ConnectionLifecycle.spawnAndInitialize` bounds `agent/initialize` (`connection-lifecycle.ts:428-443`); the prompt has `requestWithTimeout` plus `cancelRun` in its timeout callback (`subagent-manager.ts:482-492`); the whole run body is in `try/finally` and releases the slot on any _other_ error.
- Meaningful regression check: a fake `SubagentConnection` whose `session/new` returns a never-resolving promise, with `maxConcurrent: 1`. Assert the run rejects within a bounded time and `activeRuns` returns to 0 (mirror `subagent-manager.behavior.test.ts:205-240`, substituting a hung `session/new` for a hung prompt). Currently this test would time out.

### NEW 2 — Abandoned-then-successful session establishment leaks the per-session MCP endpoint token

- Exact source: MCP token is created and registered in `sessionMcpServers` → `subagents.attachMcpServers` (`electron/agent-connection-manager.ts:1764-1786`; token mint + registration at `electron/subagents/subagent-manager.ts:219-221`). It is bound on success at `sessionLoad` `:1974` / `sessionNew` `:1906` / `sessionResume` `:2004`, and released on error via `attached.release()` (`:1902, :1970, :2000`, and `:538`).
- Trigger: a `switchThread`/`activateProject` is superseded mid `session/load`. `raceActivation` rejects the local promise (`electron/agent-connection-manager.ts:2361`, throw at `:2374`), the placeholder runtime is removed (`:2452`), but the detached `sessionLoad` promise keeps running (documented behavior). If it later _resolves_, `attached.bind(result.sessionId)` fires with no corresponding release. `releaseSessionMcp` is only called from `invalidateAgentSessions` `:1342`, `deleteThreadInternal` `:2688`, and `closeThreadSessionInternal` `:2758` — none of which run for a runtime that was removed while establishing. The token therefore stays in `SubagentManager.tokens` and `McpHttpServer.endpoints` (`subagent-manager.ts:140, :221`; `mcp-http-server.ts:91, :118-124`) until process dispose.
- Cost / ownership reasoning: each leaked entry is small (a UUID key, a token context, and an endpoint closure), so this is not a large-memory finding; the cost is unbounded accumulation across repeated rapid switches during session establishment, plus stale endpoints that remain routable against a session nobody owns. `releaseSessionMcp(sessionId)` keys off the session id (subagent-manager.ts:244-251), but the runtime that would call it was removed.
- Evidence level: **inference** (code-read path). The leak requires the abandoned `session/load` to resolve after the supersede; I could not observe a real agent doing that. The token lifecycle otherwise is **test-backed**: `subagent-manager.behavior.test.ts:181-203` asserts tokens/endpoints return to baseline across normal runs.
- Safeguards already present: release on error paths; `McpHttpServer.close()` clears all endpoints on dispose (`mcp-http-server.ts:126-132`); `SubagentManager.dispose()` clears tokens (`:306-307`).
- Meaningful regression check: start a `switchThread` against a fake `session/load` that never resolves, supersede it with another activation, then resolve the first load; assert `subagent.tokens.size` and `server.endpoints.size` return to their pre-switch baseline. (Needs a seam to inspect `tokens`/`endpoints`, as the behavior test already does at `subagent-manager.behavior.test.ts:174, :200-201`.)

### NEW 3 — The activation queue is an unbounded promise chain, and durable ops that ignore the signal are neither preempted nor coalesced

- Exact source: `enqueueThreadActivation` (`electron/agent-connection-manager.ts:2011-2036`) aborts only the single most recently enqueued controller (`:2017-2019`) and appends every task to a promise chain (`:2020-2027`). There is no queue array, no length cap, and no removal on completion. The comment at `:2014-2016` states durable operations receive the signal but ignore it; confirmed at the call sites: `createThread` `:2516`, `deleteThread` `:2673`, `closeThreadSession` `:2746` pass no signal to their internal bodies, while `switchThread` `:2118-2120` does.
- Trigger: rapid durable requests (create/delete/close, e.g. tab churn or phone-driven creates) queue behind each other and cannot be superseded. The installer's own docs already measure head-of-line blocking: `docs/architecture/MEASUREMENTS.md:44-52` ("background-create-blocks-switch"). A second, new detail: the replacement switch spawned _inside_ `deleteThreadInternal` is invoked with no signal — `this.switchThreadInternal(replacement.id, "delete")` at `electron/agent-connection-manager.ts:2737` — so even though delete's enclosing task has a signal, the nested switch cannot be superseded and runs to completion with its own phase timeouts (up to ~3 × `ACP_SWITCH_PHASE_TIMEOUT_MS`).
- Cost / ownership reasoning: superseded cancellable tasks are not removed; they are still invoked and immediately throw at `throwIfSuperseded` (`switchThreadInternal:2128`, `activateProjectInternal:2049`), so they self-clean quickly, but each retains its closure until its turn. Durable tasks run serially with no upper bound on the number queued; tail latency grows with the backlog. Each nested delete-switch is bounded internally by the 10s phase timeout (`ACP_SWITCH_PHASE_TIMEOUT_MS`, `connection-lifecycle.ts:22-25`), so this is latency retention, not an unbounded-memory ceiling.
- Evidence level: **code-read**; the head-of-line blocking magnitude is **test/measurement-backed** in the untracked performance docs, not in the main test suite.
- Safeguards already present: FIFO order is preserved (`cancellable-activation.test.ts:133-151`); the newest cancellable activation preempts the previous one (test-backed, `:75-131`); every await inside the durable bodies is timeout- or FS-bounded (see the timeout table below), so the chain cannot usually stall forever.
- Meaningful regression check: enqueue a durable `createThread` with an injected slow `initialize`, then a `switchThread`; assert the switch does not begin until create settles (documents current behavior) — and add a variant asserting the nested replacement switch from `deleteThread` observes the queue's abort signal once that is plumbed. Also assert `threadActivationQueue` has no cap by enqueuing N no-op activations and checking all resolve (or add a cap assertion if one is introduced).

---

## CONFIRMATIONS of already-known concerns

### CONFIRMATION 4 — Cancellation is cooperative; the `AbortSignal` stops _waiting_, not the ACP request; and the queue can't preempt durable ops

- Exact source: `electron/activation.ts:7-13` (explicit design note) and `electron/activation.ts:40-64` (`raceActivation` settles locally, handlers kept attached so the detached promise never surfaces as unhandled). Supersede checkpoints: `switchThreadInternal:2128`, `switchAgent/ensureConnection:2282, :2288`, `sessionLoad:2361`, `sessionResume:2391`, `sessionNew:2405`. Durable bodies deliberately ignore the signal (`:2014-2016`).
- Trigger: rapid thread switching while a `session/load` is in flight. The user-visible activation settles fast, but the old `session/load` continues on the wire until it resolves or hits its own 10s phase timeout (`sessionLoad` wraps the request in `requestWithTimeout`, `:1956-1964`).
- Cost / ownership reasoning: local promise retention is released at the supersede checkpoint, but the old request keeps a provider turn/session alive until completion. `requestWithTimeout` (`connection-lifecycle.ts:72-94`) rejects the caller but has no way to cancel the underlying request, so the "abandoned" work still consumes provider resources. This is exactly what the design note warns callers about ("treat an aborted phase like a phase timeout").
- Evidence level: **code-read** for the underlying request continuation; **test-backed** for the local settlement (`cancellable-activation.test.ts:41-104`).
- Safeguards: the `.finally` on the queue result clears `activationAbort` (`:2032-2034`); `raceActivation` removes its abort listener and keeps rejection handlers attached (`activation.ts:45-64`); thread-switch failure records a monitor switch record (`:2180-2188`).
- Regression check: an activation whose underlying promise is never resolved must still settle as `ActivationSupersededError` and the queue must proceed to the next task (`cancellable-activation.test.ts:76-104` already does this). Add an assertion that the abandoned promise's rejection is not reported as unhandled.

### CONFIRMATION 5 — Shared process ownership is one-process-per-`agentId`, no refcount; `closeThreadSession` is lease-safe but `getModelCatalogs` warms processes for every selected agent and never releases them

- Exact source: one `LiveConnection` per agent id in `ConnectionLifecycle.connections` (`connection-lifecycle.ts:177`), spawn dedup in `acquire` (`:211-236`); session close does not touch the process (`agent-connection-manager.ts:2759-2771`); only `lifecycle.close(agentId)` (`connection-lifecycle.ts:259-272`, via `removeAgentInstance` `:426`) or `terminateAll` (`:239-253`, on dispose `:1329`) evicts processes. Process exit invalidates every session for that agent (`invalidateAgentSessions:1332-1368`).
- Trigger: normal thread switching and tab close. Many threads for one agent share a single process; `closeThreadSession` closes only the ACP session, so it cannot evict a process another thread still uses — the safe behavior. The known cost is the opposite direction: `getModelCatalogs` (`:433-543`) awaits `acquireConnection` for every selected agent (`:452-460`), then probes a temporary `session/new` for agents with no catalog and closes it (`:510-533`). There is no main-process cache; the renderer calls it on every `selectedAgentKey` change (`src/components/agent-panel.tsx:2163-2173`) and the IPC handler forwards straight through (`electron/main.ts:2721`). Only the remote server caches it (`electron/remote-server.ts:1052-1071`, TTL `:208`).
- Cost / ownership reasoning: this matches the untracked performance report's known concern — `docs/performance/README.md:49` ("Provider connections remain cached, and model discovery warms selected providers") and `docs/architecture/MEASUREMENTS.md:54-62` (catalog discovery starts six extra processes; all nine remain cached after idle). Processes for agents that currently have zero open threads are retained until shutdown or account removal. `getModelCatalogs` itself is not enqueued on `threadActivationQueue`, so it does not block the activation queue directly, but it does compete for the shared `lifecycle.acquire` spawn future and creates/closes sessions on live processes.
- Evidence level: **measurement-backed** for process warming/retention (untracked docs, not the committed suite); **code-read** for the no-cache call path.
- Safeguards: catalog probing is wrapped in per-agent try/catch (`:453-460, :508-539`); the probe `session/new` and its `session/close` have timeouts (`:510-517, :529-533`); the MCP token from the probe is released in `finally` (`:538`).
- Regression check: call `getModelCatalogs` twice and assert `lifecycle.all()`/process count does not grow on the second call (persistent per-process catalog cache), and a variant asserting a catalog probe never leaves a session registered in `sessions` or a token in `SubagentManager.tokens`.

---

## Timeout coverage map (for the "which awaits can hang" question)

Timeouts present:

- `agent/initialize`: `connection-lifecycle.ts:428-443` (120s for npx, else 10s).
- `session/new`: `agent-connection-manager.ts:1890-1897`; `session/load`: `:1956-1964`; `session/resume`: `:1989-1997`; `session/close`: `:2761-2767`; `session/delete`: `:2691-2695`; `session/set_config_option`: `:3085-3093`; catalog-prone `session/new`/`close`: `:510-517, :529-533`.
- `session/prompt` (user threads): `prompt-scheduler.ts:4-8` (45 min default) with a local cancel handle and timeout-triggered `session/cancel` (`:105-113`).
- Subagent `session/prompt`: `subagent-manager.ts:482-492` (`runTimeoutMs`, default 10 min, `subagent-config.ts:14`).
- Antigravity first-use install: `waitForAntigravityInstall(ANTIGRAVITY_INSTALL_WAIT_MS=180_000)` (`connection-lifecycle.ts:280-293`, `agents/antigravity-official.ts:20, :297-301`).

Awaits without a timeout (candidates to hang):

- Subagent `session/new` — `subagent-manager.ts:468` (Finding 1).
- `attachMcpServers` → `ensureStarted()` → `server.start()` / `ensureStdioProxyScript` (`subagent-manager.ts:325-337`) — local HTTP listen/FS write, no timeout.
- Tail of `switchThreadCore`: `updateWorkspaceSelection` / `updateLaunchSelection` / `recordThreadSwitch` (`agent-connection-manager.ts:2495-2503`) and `readLaunchState` (`:2063`) are not signal- or timeout-guarded, so an activation can wait on the launch-state/disk write queues.
- `flushRuntimeSnapshot` in `closeThreadSessionInternal` (`:2773`) and `deletePersistedSnapshot` in `deleteThreadInternal` (`:2702`) are FS-bound with no timeout.

---

## Explicit gaps in what I could verify

- I did not run any test or agent; Findings 1 and 2 rest on code paths, not observed stalls/leaks.
- Whether a real ACP provider can stall indefinitely in `session/new`, or resolves an abandoned `session/load`, is unverified.
- Remote/phone surfaces reference the same manager methods but I found no direct remote call sites for `closeThreadSession`/`switchThread`/`deleteThread` in `electron/remote-server.ts` (they route through `remote-requests.ts`, which I inspected only by name); the exact remote sequences were not traced.
- `deleteThreadInternal` does not delete its `threadActivationGenerations` entry (`agent-connection-manager.ts:290, :2465`; only failure paths and `preserveSnapshotRuntimeAfterFailure:1081` remove it), so that map grows with distinct activated threads — I flag it as a minor, thread-bounded retention item rather than a confirmed leak.
- I deliberately did not read `.env`/credentials or any files outside the assigned sources plus the untracked performance docs that document the known concerns.
