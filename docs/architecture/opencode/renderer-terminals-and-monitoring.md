# Renderer, Terminals, and Monitoring — Independent Architecture Investigation

Independent OpenCode reviewer report against `490f89626a4c63b85a3723cf00be55288b74d192`.

Scope: renderer startup/render graph, terminal ownership and retention, and the monitoring
subsystem (renderer observers → IPC → main service → SQLite). Storage layout and workspace
lifecycle are covered separately by `storage-and-workspaces.md` and are referenced, not
duplicated. Primary-agent runtime verification lives in `PRIMARY-VERIFICATION.md`.

This document is source-analysis plus an audit of existing artifacts. All statements are tagged:

- **[CODE]** proven by reading the current source (path:line).
- **[MEASURED]** already produced by another artifact (cited).
- **[HYPOTHESIS]** plausible, not yet measured; a test is proposed.

No application code, tests, or config were changed. No new heavyweight build was run.

---

## 1. Highest-impact findings

| #   | Finding                                                                                                                                                                                         | Tag                                           | Impact axis                     | Priority |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------- | -------- |
| F1  | Monitor live snapshot is rebuilt and re-serialized on every 1 Hz tick **and** on many mutations, carrying up to ~1,620 ring entries (`300 ticks + 120 renderer + 600 acp + 600 bridge`)         | CODE                                          | Renderer + main CPU, IPC        | High     |
| F2  | `AgentPanel` subscribes to the **entire** agent store (`useAgentStore()` with no selector), so every streaming chunk re-renders a 2,906-line component                                          | CODE                                          | Renderer CPU during streaming   | High     |
| F3  | Renderer monitor observers scan the whole DOM periodically and on every mutation; any freeze ≥ 200 ms writes a SQLite incident on the **main thread regardless of recording**                   | CODE                                          | Renderer CPU + main-thread disk | High     |
| F4  | Built monitor worker fails to load → in-process fallback runs `app.getAppMetrics()` + `ps` sampling + SQLite writes on the main thread                                                          | MEASURED (`monitor-worker-verification.json`) | Main-thread CPU/IO              | High     |
| F5  | Every terminal the user ever activates stays mounted for the process lifetime; each retained terminal core caps scrollback at **1 MiB** and the store keeps another **200 k chars** per session | CODE                                          | Memory, scales with usage       | High     |
| F6  | `monitor_incidents` has **no per-kind cap** and is written for non-recording sessions; only pruned by 7-day timestamp sweep (1 % of ticks)                                                      | CODE                                          | Disk growth                     | Medium   |
| F7  | `src/lib/monitor-freeze-observer.ts` is dead code (duplicate of the observer used in `monitor-runtime-observer.ts`)                                                                             | CODE                                          | Maintenance/clarity             | Low      |
| F8  | `acp-entries` projection cache is a single module-global (not per-thread), so multi-thread streaming thrashes it                                                                                | CODE                                          | Renderer CPU                    | Medium   |
| F9  | ACP-update / bridge / diff high-frequency rows are ring-only unless recording (good), but those rings are still serialized every tick (feeds F1)                                                | CODE                                          | Renderer + main CPU             | Medium   |

---

## 2. Monitoring pipeline — confirmed structure

```
renderer observers (App.tsx:119-141)
  ├─ startMonitorFreezeObserver  → reportRendererFreeze  → IPC invoke
  └─ startMonitorRuntimeObserver → reportRendererTelemetry → IPC invoke
main.ts handlers (electron/main.ts:3006-3019)
  └─ monitorService.<report*>
electron/monitor/service.ts
  ├─ rings: ring(≤300) / rendererRing(≤120) / acpRing(≤600) / bridgeRing(≤600)
  ├─ tick() @ 1 Hz → worker.sample(...) → onBroadcast("monitor:tick") → broadcastLive()
  └─ SQLite via worker-client (or in-process fallback)
main.ts:1413-1450  monitor window (separate BrowserWindow) is the only "monitor:live" consumer
```

### F1 — `broadcastLive()` serializes the whole snapshot on every tick and mutation **[CODE]**

- `getLiveSnapshot()` copies the rings into fresh arrays every call: `recentTicks: [...this.ring]`,
  `[...this.rendererRing]`, `[...this.acpRing]`, `[...this.bridgeRing]`
  (`electron/monitor/service.ts:155-176`).
- `broadcastLive()` invokes it (`service.ts:607-609`) and is called from `tick()` (`:591`) **and**
  from `reportSwitch*`/`reportTab*`/`sessionStart`/`sessionStop` paths (`:244, :265, :394, :490,
:504, :527, :533, :539, :545`).
- The rings are capped at 300 / 120 / 600 / 600 (`service.ts:55-59`, `:455`, `:461`, `:440`), so a
  fully warmed snapshot can carry ~1,620 entries **plus** 300 process-sample ticks with per-process
  arrays. `recentTicks` alone embeds every process sample for up to 300 ticks.
- **Delivery note:** the object is built as an argument _before_ `onBroadcast` runs, and
  `broadcastToMonitor` early-returns when the monitor window is closed (`electron/main.ts:1447-1450`).
  So the **build/copy cost is paid every tick even when no monitor window is open**; the IPC
  serialize cost is only paid when the monitor window is open.

**Trigger / scaling:** fixed 1 Hz baseline, plus one full rebuild per switch/tab/session mutation.
Cost scales with the number of live ACP bridge/acp updates in the last window, i.e. with streaming
activity across _all_ open threads.

**Tradeoffs / invariants:** the devtools monitor window expects a self-contained snapshot; the rings
are intentionally small. The problem is re-materializing and re-sending them wholesale rather than
sending deltas or gating on a subscriber.

**Proposed seam:** a `MonitorLiveBus` that (a) keeps a monotonic revision and sends only deltas since
the last acknowledged revision, and (b) skips snapshot construction when there is no subscriber.
`pipelineTelemetry` already reports `queueDepth`/`queueCapacity` (`service.ts:171-174`), so a
subscriber/backpressure signal exists to build on.

**Regression test:** unit-test `getLiveSnapshot` call count per tick when no monitor window is
subscribed (assert 0 snapshot builds), and a byte-size assertion that a delta payload for 10 new
events is O(new events) not O(ring caps).

### F3 — Renderer observers scan the DOM continuously and write incidents unconditionally **[CODE]**

`src/lib/monitor-runtime-observer.ts`:

- A `MutationObserver` on `document.documentElement` with `{childList:true, subtree:true}` fires on
  **every** DOM mutation. Each observed record walks `parentElement` and counts nodes via
  `getElementsByTagName("*")`.
- Every `RUNTIME_SAMPLE_INTERVAL_MS = 5000` it emits telemetry, and to do so runs
  `document.querySelectorAll("[data-pipper-id]")`, then `countElementNodes` (`getElementsByTagName("*")`)
  per match, sorts, and slices to `MAX_DOM_ATTRIBUTIONS = 24`; it also takes a full
  `document.getElementsByTagName("*").length`. This is a periodic O(DOM) scan — during streaming the
  DOM churns every frame.
- `startMonitorFreezeObserver` (L430) runs an rAF loop **every frame**, a longtask
  `PerformanceObserver`, and a `setInterval(250)` scheduling `setTimeout(100)` (~4 timers/sec). It
  signals whenever `blockedMs >= 200` and the document is visible.

`electron/monitor/service.ts:397-436` → `reportRendererFreeze` calls `insertIncident("renderer_freeze", …)`
for any episode start ≥ 200 ms. `insertIncident` (`electron/monitor/db.ts:951`) is a synchronous
`DatabaseSync` INSERT on the main thread. **This path does not check `recordingSessionId`** — unlike
`reportAcpUpdate`/`reportBridgeEvent`/`reportDiffIngestion` which early-return when not recording
(`service.ts:449, :456, :462`).

**Consequences:** (a) on a busy renderer, freeze episodes are common and each one does a main-thread
disk write; (b) the DOM-attribution scans add renderer work proportional to DOM size every 5 s; (c)
the mutation observer adds a callback per mutation during streaming.

**Proposed seam:** gate incident insertion behind an explicit monitor-recording flag (matching the
other report paths), and move the periodic DOM census off the streaming hot path (e.g. run it only
when idle, or drop to `data-pipper-id`-scoped counting without the full `getElementsByTagName("*")`).

**Regression test:** with recording disabled, generate a synthetic 250 ms block and assert **zero**
`monitor_incidents` rows; assert the 5 s census does not call `getElementsByTagName("*")` over the
whole document.

### F4 — Worker isolation is not effective in the built app **[MEASURED]**

`monitor-worker-verification.json` (`builtWorkerTsReference:true`, `resolvedWorkerExists:false`,
`workerFailures:2`, `lastError:"Monitor worker exited with code 1"`) shows the built app falls back to
in-process execution. In fallback, `worker-client.ts` routes commands through `executeCommandInProcess`,
so **`app.getAppMetrics()` (via `mergeElectronMetrics`, `service.ts:611-634`) and SQLite
writes/pruning run on the calling main thread**. `PRIMARY-VERIFICATION.md` reaches the same
conclusion and corrects the earlier report's claim that sampling runs in a worker.

This report does not re-measure total CPU overhead; it confirms the routing. See §6 for the
verification the primary agent should run after a worker entry is emitted.

---

## 3. Renderer render graph and streaming cost

### F2 — Whole-store subscription in `AgentPanel` **[CODE]**

`src/components/agent-panel.tsx:669-687` destructures `useAgentStore()` with **no selector**:

```ts
} = useAgentStore();
```

Zustand re-renders the subscriber on **any** state change. The agent store holds the streaming slice
(`src/store/agent-store.ts:98-120`: `snapshot`, `slice`, `threadToolCalls`, `runningThreadIds`, …).
Every ACP update mutates that slice, so the entire 2,906-line `AgentPanel` re-renders per streaming
chunk. `global-tab-bar.tsx` and `workspace-control-panel.tsx` correctly use narrow selectors
(`global-tab-bar.tsx:89-92`, `workspace-control-panel.tsx:287-289`) — the panel is the outlier.

Mitigating context: the JSX is virtualized (`useVirtualizer`, `agent-panel.tsx:1156-1167`) and
streaming is isolated into `streamingMessage` (`allMessages` memo, `:1147-1154`), so settled rows do
not re-key. The cost is the component function body + memo recomputation, not full row remounts.
`"use no memo"` (`:666`) disables React Compiler memoization for this component, so nothing is
auto-memoized.

**Proposed seam:** replace the bare `useAgentStore()` with grouped selectors (one per concern:
snapshot fields, actions as a stable slice) or `useShallow`, keeping action references stable.
Actions never change identity in this store, so `useAgentStore.getState()` in handlers also works.

**Regression test:** a render-count test asserting `<AgentPanel>` does not re-render when only
`slice.streamingMessage` changes for a background thread, and does not re-render on unrelated
`threadToolCalls` churn.

### F8 — Global (non-per-thread) projection cache **[CODE]**

`src/lib/acp-entries.ts` keeps module-level mutable `lastEntries` / `lastBoundary` / `lastPrefixMessages`.
It caches the last projected thread only, so switching threads or streaming on two threads thrashes
the cache; `projectToolResultMessages` also iterates all tool calls per invocation. Called from
`agent-store` projection on updates.

**Proposed seam:** key the memo by `threadId` (small LRU) so alternating threads do not invalidate
each other.

### Startup / bundle coupling **[CODE]**

`src/App.tsx:24-30` lazy-loads `DiffView`, `TerminalSession`, `ProjectFileTree`, but `App.tsx:46`
**statically** imports `AdvancedShell`, which statically imports `TerminalSession`
(`advanced-shell.tsx:19`). Advanced mode is the non-default (`ui-mode-store.ts:23` default `"basic"`),
but `AdvancedShell` is in the graph regardless, partially defeating the `lazy(TerminalSession)`
intent flagged by the build's "ineffective dynamic import" warning. `MEASUREMENTS.md` and
`VALIDATION.md` already note the build warning; this is the source of it.

---

## 4. Terminal ownership and memory retention

### F5 — Terminals are mounted/retained for the life of the process **[CODE]**

- `getAllTerminalSessions` returns visible **and** stashed sessions from every workspace
  (`src/store/terminal-store.ts:135-139`).
- Both shells render a panel per session across all workspaces: `App.tsx:1010-1032` and
  `AdvancedShell` (`advanced-shell.tsx:854-871`, hidden with `invisible pointer-events-none` only).
- `TerminalSession` mounts the terminal core once `hasBeenActiveRef.current` flips and never
  unmounts it. Inactive panels keep the Ghostty core alive.
- Retention per live session:
  - Ghostty core scrollback: `GHOSTTY_SCROLLBACK_LIMIT_BYTES = 1024*1024` (`ghostty-core.ts`).
  - Store-side plain history: `MAX_HISTORY_CHARS = 200_000` (`terminal-store.ts:13`), i.e. ~400 KB
    UTF-16 for full-width content.
  - Recovery replay buffer: `RECOVERY_CHUNK_SIZE = 8_192` (`terminal-session.tsx`).

So each terminal the user has ever activated retains roughly 1 MiB (core) + up to ~0.4 MB (store
string) **for the rest of the session**, and the renderer keeps a mounted React tree + WASM core for
each. Cost scales linearly with the number of distinct terminals opened across workspaces over a
session — exactly the "many agents/worktrees" workload.

**Mitigating detail:** `App.tsx` marks inactive panels `inert` (`:1022`), and the store intentionally
keeps PTYs running for background workspaces (`terminal-store.ts:110-112`) — the retention is a
deliberate recovery feature, not an obvious leak. The question is whether the _core_ must stay
resident while hidden.

**Proposed seam:** an idle-eviction policy for terminal cores (keep the store history + PTY alive,
release the WASM core after N minutes hidden and re-hydrate on re-activation), or cap the number of
simultaneously-resident cores and swap the rest to the store-history path that already exists for
recovery.

**Regression test:** open K terminals across K workspaces, deactivate them all, and assert the number
of live `GhosttyCore` instances is bounded (e.g. ≤ resident cap) while PTYs remain and re-activation
replays from store history.

---

## 5. Persistence / disk (monitor + terminal)

### F6 — `monitor_incidents` growth **[CODE]**

- `insertIncident` (`electron/monitor/db.ts:951-961`) INSERTs with no dedupe or per-kind count cap.
- `pruneOldSamples` (`db.ts:1449-1458`) deletes incidents only by `timestamp < cutoff` (7 days) and is
  invoked probabilistically: `if (Math.random() < 0.01) worker.prune(...)` per tick (~once per 100 s)
  (`service.ts:592-594`).
- Freeze/mismatch/switch-failure incidents are written **without** a recording session
  (`service.ts:397, :465, :484, :517`), so a laggy renderer on a non-recording user accumulates rows.

**Proposed seam:** per-kind incident caps (or a rolling window) plus always-on pruning, and gate
incident kinds on the same recording flag used by the high-frequency streams where appropriate.

### Non-recording behavior is already correct for high-frequency streams **[CODE]**

`reportAcpUpdate`/`reportBridgeEvent`/`reportRendererTelemetry`/`reportDiffIngestion` push to their
ring but only write to SQLite when `recordingSessionId != null` (`service.ts:441-463`, `:449`). This is
a deliberate, documented tradeoff ("Avoid continuously growing the local database", `:447-448`). The
residual cost is the every-tick ring serialization (F1), not disk growth. Tables created:
`electron/monitor/db.ts:47-276` (`monitor_samples`, `monitor_renderer_samples`, `monitor_acp_updates`,
`monitor_bridge_events`, `monitor_diff_ingestions`, `monitor_incidents`, plus switch/tab/cache/click
tables), each with a `timestamp` index.

---

## 6. Audit of prior reports

- **`VALIDATION.md`** — consistent with this report: build passes with the "ineffective terminal
  dynamic-import" warning, which §3 traces to `App.tsx:46` + `advanced-shell.tsx:19`. Its "live
  Electron harness" scenario claims are not re-run here.
- **`MEASUREMENTS.md`** — scenario timings (cold-provider 66.27 ms, resident-switch ≈6.87 ms avg,
  etc.) are explicitly "observations, not promises". This report does not contradict them; it explains
  two mechanisms behind them: terminal re-mount/retention (F5) and whole-store panel re-render (F2).
- **`README.md`** — top-problem list (eager provider startup, global activation queue, synchronous
  Git/transcript, whole-history storage, count-not-byte caches) is corroborated for the renderer side.
  **Gap this report adds:** README does not mention (a) the every-tick monitor ring serialization,
  (b) terminal core retention scaling, or (c) whole-store `AgentPanel` subscription. A
  `weighted-lru-cache.ts` (entry + byte budgets) already exists as an _uncommitted_ fix for the
  byte-vs-count cache concern (`src/lib/highlight-cache.ts` uses it: `HIGHLIGHT_CACHE_MAX_BYTES = 8 MiB`,
  `maxEntries: 256`).
- **`PRIMARY-VERIFICATION.md` / `monitor-worker-verification.json`** — the worker-fallback finding (F4)
  is adopted from these; no independent reproduction was attempted.
- **`storage-and-workspaces.md`** — out of scope here; storage/workspace concerns are cross-referenced,
  not restated.

---

## 7. Runtime verification requested from the primary agent

These need a built app + instrumentation this reviewer did not run:

1. **Monitor snapshot cost** — instrument `getLiveSnapshot` to record entries-per-call and total
   serialized bytes per tick with N streaming threads; confirm the ~1,620-entry worst case and measure
   main-thread time. (Supports F1.)
2. **Panel render count** — count `AgentPanel` renders per second while a single thread streams at
   ~30 chunks/s, before/after replacing the whole-store subscription. (Supports F2.)
3. **Recording-off incident writes** — run with recording disabled, force a ≥200 ms block, assert zero
   `monitor_incidents` inserts. (Supports F3/F6.)
4. **Terminal residency** — open 10 terminals across workspaces, hide all, and report live
   `GhosttyCore` instance count and renderer heap. (Supports F5.)
5. **Post-fix worker build** — after emitting the monitor worker entry, assert `resolvedWorkerExists`
   and no fallback at startup.

---

## 8. Files reviewed

Renderer/startup: `src/main.tsx`, `src/App.tsx` (full), `src/components/advanced-shell.tsx` (full),
`global-tab-bar.tsx` (full), `terminal-session.tsx`, `agent-view.tsx`, `project-file-tree.tsx`,
`diff-ingestor.tsx`, `agent-panel.tsx` (structure + subscription/observer regions).

State/projection: `src/store/{agent-store,thread-store,terminal-store,agent-terminal-store,tool-payload-store,diff-store,worktree-store,model-catalog-store,ui-mode-store}.ts`,
`src/lib/{acp-session-reducer,acp-entries,session-retention,thread-queries,terminal-event-router,ghostty-core,monitor-runtime-observer,monitor-freeze-observer,monitor-tab-sync,highlight-cache,weighted-lru-cache}.ts`.

Main/electron: `electron/monitor/{service,worker,worker-client,db,platform-sampler,inventory,enabled,timeline}.ts`,
`electron/{renderer-broadcaster,window-visibility,terminal-manager}.ts`, `electron/preload.ts`,
`electron/main.ts` (monitor + broadcast regions).

Docs/artifacts: `docs/architecture/{README.md,MEASUREMENTS.md,VALIDATION.md,FILE-MAP.md}`,
`docs/architecture/opencode/{PRIMARY-VERIFICATION.md,monitor-worker-verification.json,storage-and-workspaces.md}`.

## 9. Gaps / not covered

- No independent measurement of main-thread CPU/IO, renderer heap, or IPC byte volume (source-only).
- `electron/agent-connection-manager.ts` (≈125 KB) reviewed only for the bridge/acp monitor hooks, not
  in full; other reviewers own it.
- Windows/Linux sampler paths and packaged-installer behavior not exercised.
- `module-map.json` / `component-measurements.json` / `workflow-measurements.json` were not exhaustively
  cross-checked; cited artifacts above are the ones actually read.
