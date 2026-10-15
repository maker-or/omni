# OpenCode explore subagent: renderer

This is the preserved subagent report. Read [the primary review and evidence classifications](README.md) before treating individual claims as accepted findings.

I have completed the read-only exploration. Below is my findings report. Note upfront an important discrepancy: **the four claims (a)-(d) as phrased do not appear in `docs/architecture/opencode/renderer-terminals-and-monitoring.md` (nor anywhere in the repo)**. A case-insensitive search for "need not thrash", "not allocations", "rendered commit", "full-document scan", "background slice", "per-thread store" returned zero matches. In fact, the document argues related-but-different points (F2/F5/F8), and for (a) it asserts the _opposite_ mechanism. I therefore verified the underlying technical questions against source and mapped each to the closest doc text.

---

# Verdicts on (a)-(d)

### (a) "background streaming need not thrash the active projection" — PARTIALLY SUPPORTED

- There is **no separate background/thread store slice**. `AgentState` holds a single active `state`/`snapshot`/`slice` (`src/store/agent-store.ts:98-120`), while background thread state lives only in shared top-level keys: `threadToolCalls: Record<string, …>` (`:110`) and `runningThreadIds` (`:108`).
- However, **background session-updates are explicitly dropped before touching the active projection**: `case "session-update"` returns `{}` when `payload.threadId !== state.state?.threadId` (`agent-store.ts:584-587`), and `stop` does the same (`:612-616`). So active-thread text about a background thread does _not_ rebuild the active projection. This partially supports the claim.
- But **every chunk still touches a shared structure via `set`**: `applyBridgeEvent` results feed `set((s) => withSnapshot(patch))` (`:795-799`) with **no early-return when `patch` is empty**, even though an `ignored` flag is computed (`:797`). Zustand 5's `setState` runs `Object.assign({}, state, nextState)` and notifies listeners unconditionally for any object patch (`node_modules/zustand/vanilla.js:8-11`); the default identity selector in `useStore` returns the whole new state object via `useSyncExternalStore` (`node_modules/zustand/react.js:7-15`). Since `AgentPanel` uses a bare `useAgentStore()` (`src/components/agent-panel.tsx:687`) with `"use no memo"` (`:666`), an ignored background chunk still produces a store notification and a rerender.
- Background `thread-tool-calls` for a non-displayed thread returns a freshly-built `threadToolCalls` object (`agent-store.ts:494-506`), and `running-threads`/`subagent-runs` replace shared arrays (`:490-492`, `:523-525`).
- The doc's F8 ("global projection cache … multi-thread streaming thrashes it") is only **partially** borne out: because background session-updates never reach `projectChatMessages`, the single-global prefix cache (`src/lib/acp-entries.ts:151-153`) is mainly reset by thread switches / re-targeted `session-state`, not by background text chunks.

### (b) "terminal caps are not allocations and explicit close exists" — SUPPORTED (with a caveat that hidden cores are not evicted)

- Caps are **retention/display limits over in-memory buffers, not preallocations**:
  - Ghostty core scrollback: `GHOSTTY_SCROLLBACK_LIMIT_BYTES = 1024*1024`, passed to `GhosttyCore.load({ scrollbackLimit })` (`src/lib/ghostty-core.ts:4,9-12`).
  - Store plain history: `MAX_HISTORY_CHARS = 200_000` with `appendBoundedTerminalHistory` trimming by slicing (`src/store/terminal-store.ts:13,92-99`).
  - ACP terminal output: default `outputByteLimit = 1024*1024` with `truncateOutput` binary-search trim (`electron/terminal-manager.ts:88,53-76`).
- **Explicit user-triggered close/dispose exists**: `closeSession` kills the PTY via `window.omni.terminal.kill(id)` (`terminal-store.ts:194-203`), plus `closeWorkspace` (`:237-258`), `clearSessions` (`:222-235`); ACP `TerminalManager.release`/`releaseSession`/`killAll` delete the instance and SIGTERM→SIGKILL (`terminal-manager.ts:143-163,186-203,216-221`). These are invoked on session/connection close and quit (`electron/agent-connection-manager.ts:1328,1341-1342,2687-2688,3210`).
- **Caveat**: there is no idle/hidden eviction — `TerminalSession` keeps the core mounted after first activation (`src/components/terminal-session.tsx:85-101`), and both shells map all sessions (`src/App.tsx:1010-1032`, `src/components/advanced-shell.tsx:854-871`), so hidden terminals retain their buffers. That matches doc F5, and is _not_ contradicted by this claim.

### (c) "mutation counting is not necessarily a full-document scan each mutation" — SUPPORTED

- The `MutationObserver` callback maintains an **incremental integer**: `current.mutationCount += 1` per observed record (`src/lib/monitor-runtime-observer.ts:341-359`, specifically `:358`).
- It does _not_ scan the whole document per mutation. Added/removed node counting calls `countElementNodes` on the added/removed node only (`:350-357`), which runs `getElementsByTagName("*")` on that node's subtree (`:183-186`) — proportional to the changed subtree, and only for records whose target resolves to a known attribution id (`:343`).
- The full-document scan `document.getElementsByTagName("*").length` (`:412`) and `document.querySelectorAll("[data-pipper-id]")` (`:204`) run only on the 5 s `emit` (`:422`).

### (d) "React notifications do not prove a rendered commit per chunk" — PARTIALLY SUPPORTED (as a caution, not as an implemented guarantee)

- **No store-level batching/throttling exists.** Each IPC event invokes `set` synchronously (`agent-store.ts:795-799`); preload forwards each `agent:event` straight to the callback with no queue/rAF (`electron/preload.ts:480-484`).
- Zustand 5 uses `useSyncExternalStore` with `Object.is` snapshot comparison (`node_modules/zustand/react.js:7-15`), so components with stable selectors bail out, while a no-selector subscriber (`agent-panel.tsx:687`) rerenders on every notify — including ignored chunks (see (a)).
- React 19 automatic batching can coalesce multiple `set` calls within one synchronous task, but separate IPC tasks generally each commit; so notification count can exceed commit count in principle, but **nothing in source enforces coalescing**.
- The monitor does coalesce _accounting_: `recordRendererEvent` schedules a single rAF per pending window and increments `paintCount` once (`monitor-runtime-observer.ts:295-313`), keeping `maxEventsPerSecond` separate from `paintCount`. That distinguishes event/notify metrics from paint — but it is instrumentation, not render coalescing. The doc itself (F2, §7 item 2) asks to _measure_ panel renders; it does not claim batching.

---

# NEW FINDINGS

### N1. Ignored/background bridge events still emit a full store notification and rerender the no-selector `AgentPanel`

- **Source:** `src/store/agent-store.ts:795-799` (`set` called unconditionally; `ignored` computed but unused), with empty patches produced at `:585-587`, `:527-537`, `:696-702`; subscriber at `src/components/agent-panel.tsx:687` with `"use no memo"` at `:666`.
- **Trigger:** any inbound `agent:event` whose `applyBridgeEvent` returns `{}` — background-thread `session-update`/`stop`, events during a pending thread switch, `notification`, `terminal-output`, unknown types.
- **Cost/ownership reasoning:** Zustand 5 creates a new state object on every object patch and notifies all listeners (`node_modules/zustand/vanilla.js:8-11`); the identity selector returns that new object, so `useSyncExternalStore` sees a changed snapshot and React rerenders the subscriber. This is extra work paid per background chunk even though no state value changed, and it is not the agent store's actual data flow.
- **Evidence level:** code-read only (including the vendored zustand source); no runtime measurement.
- **Safeguards present:** the `ignored` flag exists (would make a cheap guard possible); other subscribers use narrow selectors (`global-tab-bar.tsx:89-92`, `workspace-control-panel.tsx:287-289`) and bail out; projection is memoized (`agent-store.ts:350-387`) and rows are virtualized (`agent-panel.tsx:1156-1167`).
- **Regression check:** drive N background-thread `session-update`s that `applyBridgeEvent` ignores; spy on `useAgentStore.subscribe` callback invocations (or an `AgentPanel` render counter) and assert it does not increase once an `if (ignored) return` guard is in place.

### N2. Per-active-chunk projection/copy/accounting costs in agent-store + acp-entries

- **Source:** `agent-store.ts:578-607` (session-update), `:718-727` `withSnapshot` → `toPanelSnapshot` (`:389-451`) → `projectPanelMessages` (`:359-387`) → `projectChatMessages` (`acp-entries.ts:161-213`) + `projectToolResultMessages` (`:218-263`); also `estimateJsonBytes(payload)` per event (`agent-store.ts:769`) and `syncToolPayloadIds(threadId, Object.keys(nextSlice.toolCalls))` per chunk (`:590`).
- **Trigger:** one streamed text/thought chunk for the active thread.
- **Cost reasoning:** per chunk the reducer copies the entries array (`acp-session-reducer.ts:132` `entries.slice()`); the projection re-derives from the boundary and re-materializes the prefix (`acp-entries.ts:176` spreads `lastPrefixMessages`, `:211` `messages.slice(0,-1)`); `projectToolResultMessages` iterates **all** tool calls every call (`:218-220`); `estimateJsonBytes` recursively walks the payload allocating `Object.entries` arrays (`session-retention.ts:26-58`); `Object.keys` is O(toolCalls). This scales with history/tool count, not just chunk size.
- **Evidence level:** code-read only.
- **Safeguards present:** prefix cache (`acp-entries.ts:168-177,209-211`), WeakMap caches for parts/runs/user/tool-result (`:39,78,81,215`), projection identity memo (`agent-store.ts:350-387`), `trimSessionSlice` fast path (`acp-session-reducer.ts:46-53`), streaming isolated to `streamingMessage` (`agent-panel.tsx:1133-1154`), virtualization.
- **Regression check:** with a fixed 1,000-entry history and K tool calls, assert per-chunk work (e.g., invoked `projectToolResultMessages` iterations) is bounded and does not grow with total tool count when tool state is unchanged; preserve full fidelity (no tail truncation).

### N3. `terminal-store.appendHistory` re-copies/re-trims a ~200 k-char buffer on every PTY chunk, and two listeners fire per chunk

- **Source:** `terminal-store.ts:286-304` (`appendHistory`), `:92-99` (`appendBoundedTerminalHistory`), `:29-90` (`stripTerminalControls`), `:142-163` (`updateTerminalSession`), global listener `:328-334`; second per-session listener `terminal-session.tsx:270-285` via `src/lib/terminal-event-router.ts:22-66`.
- **Trigger:** every PTY data chunk, for both visible and stashed terminals.
- **Cost reasoning:** once history is at `MAX_HISTORY_CHARS`, each chunk performs `history + text`, then `combined.indexOf("\n", target)` and `combined.slice(...)` over ~200 k chars; `stripTerminalControls` adds an O(chunk) state-machine pass; `updateTerminalSession` copies the bucket array; a new state object notifies all store subscribers. Terminal output thus pays a per-chunk cost proportional to the retained cap, not the chunk size.
- **Evidence level:** code-read only.
- **Safeguards present:** `tabsRevision` changes only for tab metadata (`:114-115,189,217,233,255,281,314,324,351`), so `App.tsx:67` and `advanced-shell.tsx:513` (primitive selectors) do not recompute `terminalSessions` on output; `TerminalInner` writes via the shared router, not the store (`terminal-session.tsx:274-285`); history is deliberately plain recovery text (`:230-231`).
- **Regression check:** append many chunks past the cap and assert the retained string stays bounded and that a single append does not do work proportional to the full cap (e.g., assert trim uses a windowed slice); verify recovered history is still byte-equivalent for the retained window (do not reduce fidelity).

### N4. Monitor worker boundary clones payloads per tick/per write; fallback runs sampling + SQLite on the main thread; pipeline is always-on

- **Source:** `worker-client.ts:63-97` (`collectProcessTick`), `:317-397` (`request`/`postMessage`, structured clone in and out), `:339-349` (`postWrite`, `MAX_QUEUED_WRITES=256` at `:27`), `:99-215` (`executeCommandInProcess`), `:414-442` (crash failover); `service.ts:578-598` (`tick`), `:151-153` (`isEnabled` always true), `:438-444` (`reportRendererTelemetry` always rings), `:397-436` (`reportRendererFreeze` always inserts).
- **Trigger:** 1 Hz tick plus per-write monitor events; in a build where the worker entry is missing, `request` routes through `executeCommandInProcess`.
- **Cost reasoning:** each `sample` structured-clones `descriptors` into the worker and the `MonitorSampleTick` back; each write clones telemetry/acp/bridge payloads. In fallback, `app.getAppMetrics()` (`service.ts:611-634`) + `samplePid`/`ps` sampling + synchronous `DatabaseSync` inserts run on the calling (main) thread. Backpressure exists only for writes (`droppedWrites`), not for `sample` (guarded instead by `sampling` at `service.ts:579`).
- **Evidence level:** code-read only. The doc's F4 MEASURED "built worker fails to load" was **not independently reproduced here** (no build/run performed) — I only confirmed the fallback routing path exists.
- **Safeguards present:** `MAX_QUEUED_WRITES` + `droppedWrites` + health counters (`worker-client.ts:27,304-316,339-349`); `sampling` re-entrancy guard (`service.ts:579`); `broadcastToMonitor` early-returns when no monitor window exists (`electron/main.ts:1447-1451`), though the snapshot is still built first (`service.ts:607-609`).
- **Regression check:** assert `sample`/`postWrite` respect backpressure and that `pipelineTelemetry.queueDepth` grows then drops; verify worker-vs-fallback mode is surfaced. Do **not** disable always-on diagnostics.

### N5. Renderer DOM census is O(DOM) every 5 s and freeze observer runs an rAF loop + timers continuously

- **Source:** `monitor-runtime-observer.ts:199-232` (`collectDomAttributions`), `:412` (full-document count), `:422` (5 s interval), `:430-567` (`startMonitorFreezeObserver`: rAF loop `:540-547`, `setInterval(250)`+`setTimeout(100)` `:550-559`, longtask observer `:526-538`); enabled from `App.tsx:119-136`.
- **Trigger:** every 5 s; every animation frame; every 250 ms.
- **Cost reasoning:** each 5 s emit runs `querySelectorAll("[data-pipper-id]")` plus `getElementsByTagName("*")` per match and a full-document `getElementsByTagName("*").length`, then sorts and slices — cost proportional to DOM size, which grows during streaming. The freeze observer adds continuous rAF/timer work.
- **Evidence level:** code-read only, plus test-backed existence of `src/lib/monitor-freeze-visibility.test.ts` (visibility-gating behavior).
- **Safeguards present:** mutation counts are incremental (`:358`); only attribution-tagged records counted (`:343`); `MAX_DOM_ATTRIBUTIONS=24` limits payload (`:229-231`); visibility gate suppresses background timer/rAF false positives (`:490`); episode quiet-coalescing (`:494,513`); longtask stays on in background by intent.
- **Regression check:** with a large synthetic DOM, assert the 5 s census does not call whole-document `getElementsByTagName("*")` on the mutation hot path, and that the number of `monitor_incidents` writes is bounded; preserve always-on diagnostic intent (do not gate the whole observer off).

---

# CONFIRMATIONS (doc claims matching source)

- **F1** — `getLiveSnapshot` copies all four rings every call (`service.ts:155-176`); `broadcastLive` is called from `tick` (`:591`) and many mutation paths (`:244,265,394,490,504,527,533,539,545`); rings capped 300/120/600/600 (`:55-59,440,455,461`); snapshot built before `onBroadcast` early-returns with no monitor window (`main.ts:1447-1451`).
- **F2** — bare `useAgentStore()` at `agent-panel.tsx:687` with `"use no memo"` at `:666`; streaming slice in `agent-store.ts:98-120`; virtualization/streaming isolation at `agent-panel.tsx:1147-1167`. (N1 adds the ignored-event notification nuance.)
- **F3** — MutationObserver on `document.documentElement` with `subtree:true` (`monitor-runtime-observer.ts:341-362`); 5 s census (`:204,412,422`); freeze observer rAF+timers (`:540-559`); `reportRendererFreeze` has **no recording gate** (`service.ts:397-436`) unlike `reportAcpUpdate`/`reportBridgeEvent`/`reportDiffIngestion` (`:449,456,462`); `insertIncident` is a synchronous `DatabaseSync` insert with `JSON.stringify` (`db.ts:951-972`).
- **F5** — `getAllTerminalSessions` returns visible + stashed (`terminal-store.ts:135-139`); both shells map all sessions (`App.tsx:1010-1032` with `inert` at `:1022`; `advanced-shell.tsx:854-871`); core mounts once and stays (`terminal-session.tsx:85-101`); caps 1 MiB core (`ghostty-core.ts:4`) + 200 k chars store (`terminal-store.ts:13`) + 8 KiB replay chunk (`terminal-session.tsx:15`).
- **F6** — `insertIncident` has no per-kind cap (`db.ts:951-972`); `pruneOldSamples` deletes only by 7-day timestamp and is invoked probabilistically (`db.ts:1449-1458`, `service.ts:592-594`); incidents written without a recording session (`service.ts:397,465,484,517`).
- **F7** — `src/lib/monitor-freeze-observer.ts` exists but a repo-wide `rg` found **no import of it** (dead code); it lacks the visibility gate the live observer has.
- **F8** — projection globals are module-level and not per-thread (`acp-entries.ts:151-153`); `projectToolResultMessages` iterates all tool calls (`:218-220`). Confirm with the (a) nuance that background chunks are filtered before projection.
- **F9** — ACP/bridge high-frequency rows are ring-only unless recording (`service.ts:453-463`).

---

# Could not verify / honesty notes

- Claims (a)-(d) are **not textually present** in the doc (or any repo doc); the doc's F-items differ. I verified the underlying mechanics, not a literal document assertion.
- **F4** (built monitor worker fails; fallback on main thread) is adopted by the doc as MEASURED; I confirmed only the fallback _routing_ in `worker-client.ts` and did **not** build or run the app, so I cannot confirm the missing-artifact measurement.
- No ms/MB/fps/render-rate numbers are claimed anywhere above; all cost statements are qualitative source reasoning.
- `AgentPanel`'s re-render-per-notify conclusion rests on the vendored Zustand 5 implementation (`vanilla.js:8-11`, `react.js:7-15`) plus the no-selector subscription; I did not run a render-count test.
