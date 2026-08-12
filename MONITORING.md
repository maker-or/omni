# Omni — Runtime Insights & Performance Monitoring

> **Local runtime diagnostics shipped with the product.** This is the operating
> contract for the local observability layer. It sends nothing to PostHog / OTLP
> and is designed to answer an incident question with evidence rather than a
> generic health score.

## What the monitor must answer

The useful unit is an incident window, not a dashboard snapshot. For any
freeze, slow switch, or dropped ACP connection, the monitor should answer:

- Which process and ACP agent owned the work, and which chat threads were
  streaming inside it?
- Was the process using one core or several, and what percentage of the whole
  machine did that represent? (Process CPU is reported as `% of one core` and
  may exceed 100%; machine CPU is normalized by logical core count.)
- How many OS threads existed, how many were busy/runnable, blocked, or
  sleeping, and how did that change during the preceding seconds?
- Was the renderer blocked at the same time, and for how long?
- Did the transport close before the child exited, or did the child exit, and
  what were the last resource samples before the event?

If a view cannot answer one of those questions, it is missing an important
piece of the diagnostic surface.

## Implemented surface

The current implementation is wired into the Electron main process and the
developer monitor window:

- A one-second sampler tracks the main process, renderer, Electron children,
  ACP agents, and PTYs. Linux reads `/proc` directly; macOS uses `ps`; other
  platforms use the generic process reader.
- Samples include process CPU, machine-normalized CPU, RSS, total OS threads,
  busy/idle threads, and runnable/blocked/sleeping state counts.
- ACP process rows carry all chat-thread IDs and streaming-thread IDs hosted by
  that process. Rows are keyed by PID and role, so equal labels do not merge
  unrelated processes.
- Recording persists samples in SQLite. Existing databases are upgraded with
  additive monitor columns on startup, so the monitor does not silently lose
  old recordings after this schema change.
- Live view shows machine CPU, memory, OS-thread pressure, active ACP sessions,
  per-process core-vs-machine CPU, and process trends.
- Recorded sessions show duration, sample count, peak CPU, peak memory, peak
  busy OS threads, incident count, and per-process ACP/OS-thread context.
- Renderer freezes and tab-highlight mismatches are persisted as incidents;
  mismatch detection has a timer so a mismatch is reported even when no new
  React state arrives. Connection and switch incidents include the recent
  sample ring.
- Renderer diagnostics now emit bounded freeze episodes rather than persisting
  every overlapping rAF/timer/Long Task signal. Each episode carries an
  observer id, signal source, monotonic timing, visibility/focus state, active
  ACP context, and a small process/renderer context window.
- A low-frequency renderer telemetry stream records JS heap values when the
  Chromium runtime exposes them, DOM node count, visibility/focus, active
  thread context, Long Task totals, GC pause totals when supported, and
  diff-ingestion counters. These samples are persisted separately from
  incident payloads so incident history does not duplicate a large time-series
  window.
- Diff ingestion reports serialized payload volume, extraction/change counts,
  and elapsed time. The instrumentation also avoids serializing each tool call
  twice while calculating its version fingerprint.

The monitor is still intentionally a diagnostic sampler, not a profiler. It
does not identify individual JavaScript functions or provide kernel-level
off-CPU stacks. Those require a separate profiling capture and should only be
added if these measurements narrow the incident first.

## Goal

Stop speculating about hangs and resource usage. Build a dev tool that records,
at fine granularity, what the application and every ACP agent process it spawns
are doing (CPU, memory, threads), plus how healthy the renderer's main thread and
each ACP transport are.

Two ways it is used:

1. **Record a real working session, then review it.** A developer starts a
   recording, works normally for however long (10 min, 30 min, 2 hours -- not a
   fixed duration), and stops it. Afterwards they can replay the session and
   answer: "during this window, how many threads ran, what was each thread's
   occupancy / CPU, how many were active vs idle?"
2. **Live monitoring while working.** When something looks off mid-work ("why is
   this thread at 90% while there's plenty of idle capacity -- why isn't it using
   the cores?") the developer opens the live view and inspects it in real time,
   including the seconds right before a freeze or a lost ACP connection.

Both modes read the same underlying sample stream; recording is just the stream
saved to disk for later review, live view is the same stream shown as it happens.

## Why this is needed

The two symptoms reported -- UI freezing while backend ACP work continues, and ACP
connections being lost -- currently have **no diagnostic data** behind them.

Key finding from exploration: this codebase has **zero OS-level instrumentation
today**. The only "insights" are product analytics:

- `electron/analytics.ts` / `analytics-schema.ts` -- PostHog events
  (`turn_completed`, `tool_call_finished`, `turn_duration_ms`, `connect_duration_ms`).
  These measure turn/tool wall-clock durations, not CPU / memory / threads.
- `electron/telemetry.ts` -- OTLP **logs + traces** only (`desktop.error`). No metrics,
  no per-process resource stats.
- No call to `webContents.getProcessMemoryInfo()`, no `/proc` reader, no `ps` sampler,
  no `process.resourceUsage()` anywhere. Confirmed by search.

Consequence: after a freeze or a dropped ACP session, there is no evidence to explain
it -- the developer can only guess. This tool closes that gap on the dev machine.

## Two meanings of "threads" (shapes the design)

The desire for "number of threads, active threads, idle threads" spans **two
distinct concepts**. The monitoring design must track both, labeled separately:

1. **ACP session threads** (the product's chat "threads", persisted in SQLite via
   `electron/threads.ts`). Busy vs idle is already computable: a thread's session is
   `active` while `isStreaming` (`AgentConnectionManager.getRunningThreadIds()`), and
   `idle` otherwise. This is the _product_ meaning of running vs idle.
2. **OS threads inside each process**. A frozen renderer or a hung agent shows up as
   one or more CPU-bound / blocked OS threads, not as ACP-session activity. This is
   the _runtime_ meaning and is what actually explains hangs.

An agent going "inactive but alive" between turns, a busy-looping tool, or a GC storm
are all OS-thread phenomena that produce no product event -- and are exactly the cases
that end in a frozen UI or a lost connection. So the sampler must record per-process
OS thread state and correlate it back to the ACP session thread it belongs to.

## Current process inventory (what "consuming what" must cover)

The main process supervises (or spawns) every one of these. All are process children
with real PIDs, so they are individually sampleable:

- **Electron main process** itself.
- **Renderer** (the React UI). Its own RSS and renderer-main-thread health.
- **Primary ACP agent** -- one resident `LiveConnection` per agent
  (`connections` map in `electron/agent-connection-manager.ts`), each carrying
  `.process` (a `ChildProcess`) whose `pid` is available. Spawn command resolved in
  `electron/agents/registry.ts`.
- **Subagent sessions** (`electron/subagents/subagent-manager.ts`) -- additional ACP
  child processes beyond the primary, spawned via `acquireConnection`.
- **Agent-driven terminals** (`electron/terminal-manager.ts`, `node-pty` in
  `main.ts`) -- commands the agent shells out to.
- **Worktree dependency installs** (`main.ts` install helpers) -- short-lived children.

Each sampling row must join a PID to its agent id, role, and the complete set of
chat-thread IDs hosted by that process (including the streaming subset), so a
CPU spike is attributable without pretending one OS process equals one chat
thread.

## Proposed layered design

### Layer 1 -- Process sampler (main process)

A sampling sensor at a fixed cadence (default ~1s, `unref()`d so it never holds the
app open), deliberately cheap:

- Enumerates the current inventory of supervised PIDs.
- For each PID reads: CPU percent (delta of cumulative user+system time / wall delta),
  memory working set / resident set, total thread count, and finer per-thread run
  state (busy vs sleeping), to expose OS busy/idle threads.
- Maintains a resolvable `pid -> { agent / session / role }` registry so every sampled
  metric is attributable to the exact agent / chat thread that consumed it.
- Per-platform readers: Linux `/proc/<pid>/stat` + `/proc/<pid>/task`, macOS
  `task_threads`/`ps -M`, Windows shell/'tasklist' helper. (Backends chosen in an
  agreed spike; see Open Questions.)
- Keeps sampling cost off the path: no synchronous reads in the renderer, no work on
  the IPC handler that would itself block.

### Layer 2 — Renderer responsiveness (freeze detection)

UI freezes live in the renderer, not the ACP child. Two instruments:

- **Long Task observer** (`PerformanceObserver("longtask")`) to record each blocking
  slice and its duration.
- **Frame-budget / event-loop monitor** (rAF delta + `setInterval` drift) to measure
  how many milliseconds of real "frozen" time occur (`blocked_ms`), instead of just
  counting tasks.

These capture the exact symptom reported: UI frozen while the backend keeps working.
A freeze event is recorded together with the concurrent ACP activity (which agent,
which session, streaming or not) so cause and correlation.

### Layer 3 — ACP connection watchdog

The moment a connection matters is the moment it breaks, and today that is not
observed (`connection.closed` and `child.on("exit")` only clean up). The watchdog
wraps the connection lifecycle to record, at any drop:

- cause (exit code / signal / unhandled error),
- the agent + session + stream state at that instant,
- uptime,
- a snapshot of the agent's CPU / memory / threads for the seconds immediately
  before the drop (from Layer 1's ring).

That answers "our client, a crash, or a hang" for every lost connection.

### Layer 4 — Durable store

- In-memory **ring buffer** in main, pushed to the renderer over live IPC for the
  live view.
- **Time-series persistence** (an extension of the existing `electron/db.ts`
  SQLite) for per-agent min/mean/max CPU + memory and the exact event log (freeze,
  connection loss), so any incident is reconstructable after the fact. This is the
  "durable" part.
- Everything stays **on the local machine**. No cloud summaries, no PostHog / OTLP
  export, and no telemetry shipping. This is a diagnostic store, not product
  analytics.

### Layer 5 — Dev console (renderer UI)

A local diagnostic surface shipped with the product that consumes the ring and
store:

- **Live view** during work: per-process gauges (CPU / memory / threads) with the
  agent / session / role label for each, plus a time-series sparkline per
  supervised process -- the "what's consuming what, right now" question.
- **Session recorder** controls (start / stop), and a recorded-session viewer that
  replays any past window: how many threads ran, each thread's occupancy over
  time, active vs idle split.
- A freeze / long-task log and an ACP disconnect history, each with one-click
  incident snapshot (sample + surrounding metrics) for postmortem.

## Fixed product issues and follow-ups

The runtime monitor captures freezes, tab mismatches, connection losses, and
slow/failed switches. The product fixes below are now implemented; the
remaining instrumentation bullets are follow-ups for deeper diagnosis.

Broken behaviors surfaced during planning. In each case the failure is silent --
nothing today records _how_ or _how much_ the UI is stuck or why a diff is
missing. The dev tool must turn each from intuition into a measured
counter/timer so these edge cases become reproducible.

### Diff pipeline -- "stuck, not rendering complete info"

Data flow: `Agent.state.toolCalls ->` `DiffIngestor ->` `diffStore ->` `DiffView`.

- In-flight edit content is rendered as partial evidence and updated as the
  tool completes.
- Diff state is retained per thread, so switching tabs no longer wipes the
  previous thread's files.
- The main process emits a full tool-call watermark for background threads, so
  their diffs are ingested before the tab is selected.
- Diff extraction accepts nested diff, file_edit, snake_case, and related
  content shapes. Unsupported shapes remain candidates for a diagnostic counter.

### Global tab switching — stuck / frozen only with multiple running threads

Flow: `handleTabChange -> selectThread -> agent.switchThread`.

Switch protection now includes a timeout around each ACP Load/Resume/New phase,
a renderer timeout so the serialized switch queue cannot remain wedged forever,
and authoritative session-state recovery that can move the renderer back to the
actual active thread while an older switch request is pending.

Instrumentation that turns these into data (consumes Layer 2 + Layer 3 stores):

- `switch_duration_ms` per switch, and per-phase { Load, Resume, New } timing, so
  a slow agent appears as an explicit stall instead of an unspecific freeze.
- `switch_queue_wedged` recorded whenever a switch has been pending above a
  threshold, along with the agent + phase + round-trip count, so the wedged queue
  is caught at the moment it stops the tab strip.
- A per-switch round-trip counter and a `connection-loss` correlation flag
  (wrapper the watchdog of Layer 3) so "our client," a spike in agents, and a
  hung transport path separate from each other on the panel.

### Active-tab highlight desync — tab on B while actually working in A

Before the fix, the highlighted tab was drawn from **three independent state
sources** with a fixed precedence (`global-tab-bar.tsx:333`):

```
selectedThreadId = requestedThreadId ?? activeThreadId ?? snapshotThreadId ?? ""
  1. requestedThreadId   -- optimistic switch target (workspace-view-store)
  2. activeThreadId      -- persisted open-tabs / launch-state
  3. snapshotThreadId    -- the real active agent thread
```

The historical root cause was that the two "pending" concepts could diverge and
the highest-precedence value could go stale and never recover:

- `requestedThreadId` was set optimistically by `selectThread` and was only ever
  cleared when `snapshotThreadId === requestedThreadId`
  (`global-tab-bar.tsx:179-181`), or on switch error / draft-start. Every
  way the _real_ active thread can move (a main-initiated activation: worktree
  switch, launch restore via `activateProjectWorktree`, etc.) did **not** clear
  it, so it could stay pinned at the abandoned tab.
- While a switch is pending (`pendingThreadTarget` in the renderer agent store),
  the reducer **dropped every event for any non-target thread** at the modeled
  `session-update` and `session-state` gates (~`agent-store.ts:416-422/449-451`).
  If the pending switch to B never settled, A's own events -- the ones that
  would re-sync the snapshot back to A -- were discarded, so the snapshot could
  not correct the mismatch.
- The persisted `activeThreadId` (#2) is only rewritten by `recordThreadSwitch`
  on the IPC `agent.switchThread` path; main-initiated activations called
  `switchThread` directly and never updated it, so it could likewise lag the
  real active thread.

The resulting failure was `requestedThreadId == B` outranking
`snapshotThreadId == A`, so the tab highlighted B while the real active thread --
where main routes `sendPrompt` and the snapshot tracks -- was A.

The tab highlight fix now uses the renderer's pending target only while the
agent store agrees that the switch is pending, gives authoritative snapshots
precedence, and records every successful activation in persisted tab history.

Follow-up instrumentation:

- An `active-tab-mismatch` detector: whenever `requestedThreadId` persists
  non-null and `!= snapshotThreadId` beyond a threshold (~1.5s), record
  `tab_highlight_mispaint { shown, real, agent, duration_ms }` into the durable
  store, turning the one-off look into a measured, reproducible count.
- A future `switch-pending-drop` counter counting events discarded by the
  pending-thread gate, so "tab highlight wrong" correlates with actual dropped
  state events.
- Aggregate by max duration to rank which tab transitions actually misrender.

### Close-all tabs — stale agent content after the last tab is removed

Closing the final thread tab now clears the main-process active thread before
the tabs update is broadcast. The renderer receives an empty session state,
stops reopening the closed thread from its live snapshot, and clears the active
diff projection and retained thread diffs. The workspace can still show an
empty composer or an existing terminal tab, but it no longer shows the closed
thread's chat or changes.

## Remaining limitations

1. Windows has only the generic process reader and currently reports one OS
   thread. Add a native/helper reader if Windows incidents become a priority.
2. Linux CPU accounting assumes the usual 100 clock ticks/second. Make that
   configurable if the app is deployed on a system with a different tick rate.
3. The current store retains seven days of non-recorded samples and keeps
   recorded sessions until explicitly cleaned up. Add a visible delete/export
   action once the first real incident recordings have been collected.
4. The sampler is intentionally coarse at one second. A short pre-incident
   high-resolution burst would improve evidence for sub-second freezes without
   making the normal path expensive.

## Proposed milestones

- **M1 Core sampler**: complete for the current macOS/Linux paths.
- **M2 Durable store + ring**: complete, including additive schema upgrades.
- **M3 Renderer freeze + incident capture**: complete for renderer freezes,
  tab mismatches, ACP exits, and slow/failed switches.
- **M4 Dev console**: complete for live view, recording, and evidence-oriented
  recorded-session review. The next useful increment is export/delete and a
  high-resolution incident burst, not another aggregate card.

## Open communication

Design decision: the sampler and store live in the **main process**, far
from the renderer's critical path, with the renderer only ever receiving pushed
subscription snapshots. Everything is **local and never exported** -- no cloud
shipping and no PostHog / OTLP export.
