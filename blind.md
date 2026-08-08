# Pipper Code (omni) — Reliability & Performance Audit

Audit of `pipper-code-alpha` v0.0.22 (Electron 47+ / React 19 / Vite / zustand / node:sqlite).
Phases: orientation → pattern scan → workflow tracing (startup/reconnect, tab+thread switching,
creation/close, concurrent actions, failure paths, shutdown) → hypothesis verification.
No production code was modified. All findings below carry `file:line` references, trigger
conditions, impact, root cause, evidence, a suggested fix, and a regression-test plan.

**Levels**: confidence = `Confirmed` (code path provably taken), `High-confidence`
(very strong code-path evidence, no runtime repro), `Candidate` (plausible, needs repro).
Severity = Critical / High / Medium / Low.

---

## Executive summary

The codebase is in unusually good shape for reliability: every child process has teardown
paths (kill escalation, exit promises), ACP session state is main-owned with generation
guards, queues are bounded, downloads/persistence have caps and atomic writes, and the
dev-only monitor is wired prod-safely. No Critical findings.

The real risk is **renderer state bookkeeping around thread switches and streaming**:

1. A "guard" in the composer compares a value to itself, so switching threads while
   attachments decode wipes the **new** thread's composer/edit (High, Confirmed).
2. `usage_update` carrying only `size` resets the token `used` counter to 0, corrupting
   the usage UI and `tokens_reported` telemetry mid-session (Medium–High, Confirmed logic).
3. Several `agent-panel` scroll/rAF paths write to the panel of the thread the user just
   switched _into_ after the switch (Medium, Confirmed).
4. Hot-path per-token re-serialization (stringify + Intl allocation per message per render)
   (Medium).
5. Misc lower-severity races/resource items in components (Low).

Main-process suspected races I chased and **cleared**: activation-generation "stale" path is
unreachable under the serialized activation queue; prompt queue is properly drained/kept alive
across connection loss (`closeConnection`/`invalidateAgentSessions` reject queued + cancel
in-flight prompts); no unbounded maps found; launcher-update, worktree, MCP HTTP, subagents,
terminal, analytics all bounded. Known-good list in §4.

---

## 1. Findings

### 1.1 [Data correctness · Medium · Confirmed-logic] `usage_update` with only `size` resets `used` to 0

**File**: `src/lib/acp-session-reducer.ts:281-287 , 315-324`

```ts
const used =
  typeof update.used === "number"
    ? update.used
    : typeof update.size === "number"
      ? 0                    // <-- size-only update → used = 0
      : (state.usage?.used ?? 0);
...
usage: { used: update.used ?? used, size, cost, rateLimit },
```

**Trigger**: any ACP agent emits `usage_update` with `size` (context window) but absent
`used` — e.g. session-start context-size announcements, or vendor rate-limit-tagged
updates that carry size. Claude's `_claude/rateLimit` meta arrives on the same event
(handled at lines 297-314) and this code path preserves rate-limit but zeroes tokens.

**User impact**: mid-session token counter resets to 0; main-side `tokens_reported`
(`electron/agent-connection-manager.ts:1900-1915`) reports 0 at turn end → usage
telemetry/cost under-reporting.

**Root cause**: the ternary inserts an explicit `0` for the size-only branch even though
`state.usage.used` is the correct fallback (the code intends "preserve last known value" —
comment on lines 294-296 says preserve).

**Evidence**: no test exercises size-only `usage_update` (test only covers `used+size`
at `acp-session-reducer.test.ts:305-328`).

**Suggested fix**: delete the `? 0 :` branch → `typeof state.usage?.used === "number"
? state.usage.used : 0`.

**Regression test**: `applySessionUpdate(createEmptySessionSlice({usage:{used:123,size:10_e6}}),
 {sessionUpdate:"usage_update", used: undefined, size: 20e6})` must keep `used===123`.

---

### 1.2 [State consistency / race · High · Confirmed] Thread-switch guard compares a value to itself

**File:** `src/components/agent-panel.tsx:1207 , 1275-1287`.

```ts
const operationThreadId = snapshot?.threadId;                    // the SAME captured value
...
if (snapshot?.threadId === operationThreadId) {                  // always true
  setInputValue(""); setAttachedFiles([]); setEditState(null);
  if (pendingTranscript && operationThreadId) useContinuationStore.getState().clearPending(operationThreadId);
}
```

**Trigger**: user attaches images / starts a `/continue` send, then switches thread while
`Promise.all(files.map(fileToPromptImage))` (line 1208-1215) is in flight. The captured
`snapshot` never changes inside the closure, so `operationThreadId` = the _old_ thread and
the comparison is tautologically true.

**Impact**: the send itself is correctly routed by `threadId: operationThreadId`, but after
the await the wipe clears the **new** thread's input, attachments, in-progress edit (replace),
and consumes the continuation chip; if the switch happened during an edit-replace, the
`setEditState(null)` also drops an in-flight edit of the old thread.

**Root cause**: stale-closure guard; should compare the _live_ store at execution time.

**Fix**: after the awaits, read `useAgentStore.getState().state?.threadId` and only wipe if
that equals `operationThreadId`.

**Regression test**: behavior test simulating attach + delayed decode + thread switch mid-
flight: assert composer of the arrived-at thread is not cleared.

---

### 1.3 [Perf · Medium] Whole-file `listFiles()` IPC on every draft keystroke

**File**: `src/components/agent-panel.tsx:1556-1583` — effect deps `[isDraftMode,
draft?.projectId, draftContent, snapshot?.projectId, activeProject?.id]`.

**Trigger**: typing in the draft composer changes `draftContent` → effect re-runs →
`window.omni.projects.listFiles()` (full tree walk) is re-issued and `setProjectFileItems`
re-populates ~every char, cancelling the in-flight previous call.

**Fix**: remove `draftContent` from deps; key on project/workspace identity only.

---

### 1.4 [UI/state race · Medium · Confirmed] Orphan rAF scroll fires on the thread switched into

**File**: `src/components/agent-panel.tsx:1022-1027` (non-streaming branch), cleanup at
995-1002 only cancels `scrollRafRef.current` (which the _streaming_ path stores).

**Trigger**: a settled update for thread A renders while the panel just switched to thread B;
the bare `requestAnimationFrame` runs post-unmount of A's effect and calls
`el.scrollTop = el.scrollHeight; autoScrollPinnedRef.current = true` on B's conversation —
jumping the user's scroll position into the new thread.

**Fix**: store the rAF id in the same ref (or cancel in the effect cleanup) for both branches.

---

### 1.5 [UI/behavior · Medium · Confirmed] Non-streaming updates yank the viewport to bottom

**File**: `src/components/agent-panel.tsx:1004-1053` — `shouldScroll = !isStreaming
|| autoScrollPinnedRef.current || distanceFromBottom <= 120 || allMessages.length === 0`.

Because the `autoScrollPinnedRef` override applies _only while streaming_, any settled change
(stream→settled merge, entry-list growth) with `isStreaming === false` ignores the pinned-up
reading position.

**Fix**: respect `autoScrollPinnedRef.current` in the false-streaming branch too.

---

### 1.6 [Perf · Medium] Per-token hot path: re-serialization + per-message Intl allocation

**File**: `src/components/agent-panel.tsx:447-469 , 802-815, 1693-1696, 1789`.

Each streamed token re-runs, for the whole overscanned list:

- `messages.map(stringifyMessageContent(...)).join("\n\n")` (line 1693) and again 1699,
- `extractGroupedMessageImages(messages)` twice,
- `new Intl.DateTimeFormat("en-US", …)` per user message per render (line 808).

**Fix** : memoize derived per-row text/images keyed by message structure identity; hoist one
`Intl.DateTimeFormat` instance to module scope.

---

### 1.7 [State consistency/async] Medium · Confirmed `threadToolCalls` wholesale wipe on `session-state` with `threadId: null`

**File**: `src/store/agent-store.ts:473-475, 476-489`.

```ts
threadToolCalls: payload.state.threadId
  ? { ...state.threadToolCalls, [payload.state.threadId]: payload.state.toolCalls }
  : {};
```

**Trigger**: main emits `pushState(null)` — happens on `invalidateAgentSessions`
(`electron/agent-connection-manager.ts:878-881`) when the _active_ session's agent exits or
restarts. Every thread's renderer-side `toolCalls` state is dropped at once, even though background
thread state lives on in main's slices; tool statuses for all threads show blank until each
is switched to (after which main re-sends `thread-tool-calls` on activation).
Low impact, but surprising and an easy fix — only clear per-agent entries.

---

### 1.8 [Low] `handleCopy` timer never cleared — `src/components/agent-panel.tsx:817-831`

`setTimeout(…, 2000)` fires `setCopiedMessageId` after unmount; keep id in ref, clear in
cleanup.

### 1.9 [Low] `thread-composer.tsx:201-204` rAF in `handleValueChange` untracked — mention-\*

states can be set after the composer swaps modes; store the frame id and cancel on teardown.

### 1.10 [Low] `src/components/global-tab-bar.tsx:243-254` rename updates only the

`open-tabs` cache, not the deterministic `thread-store` pages → stale titles in other
surfaces. Also `tabs.open` fire-and-forget has no `.catch` (:174-180, :275-277 — close has).

### 1.11 [Low] `subagent-composer.tsx:128-133` optimistic `setConfig` without delay —

IPC failure leaves diverged UI until next mount; revert in `.catch`.

### 1.12 [Low] `src/App.tsx:81-83` `monitor.isEnabled().then(...)` — unhandled

rejection; add `.catch`.

### 1.13 [Low] `src/components/agent-question.tsx:83-87` `sourceTitle` looks only in

unfiltered `useThreadStore.threads`; returns "Another thread" for legit titles missing from
paginated pages. Cosmetic.

### 1.14 [Low] `src/components/ambient-pixel-field.tsx:69-89` — full 20k-div grid rebuilt on

each ResizeObserver callback; active exactly while composing; cap cell count (~4k) or render
to canvas.

### 1.15 [Low] `project-file-tree.tsx:100` — `key={reloadKey}` remounts the whole tree on

every workspace/thread switch, dropping expansions and scroll each time; split the key.

### 1.16 [dev-tool · Low] `electron/monitor/service.ts:114` — `getRecordedSession` finds the

session via `listMonitorSessions(200)`; beyond 200 recorded sessions an old recording
resolves to `null` though its ticks exist. Bump limit or index by id.

---

## 2. Suspected items investigated and CLEARED (no report)

- **Generation "stale activation" throw** (`agent-connection-manager.ts:1579-1581`): the
  activation queue serializes switch/activate/create, so a generation bump for the same
  thread cannot interleave → effectively dead code; renderer-side `threadSwitchQueue`
  serializes too; cross-window duplicate activation for a cold thread re-enters
  "skip load if runtime exists" path already loaded — resolves to full snapshot on
  pushState. No user impact found.
- **Prompt liveness on connection loss**: `closeConnection`/`invalidateAgentSessions`
  (834-885) cancel in-flight prompts and reject queued ones; `drainPromptQueue` guard
  checks `sessions.get(runtime.threadId) === runtime` (1201) so stale `live` references
  are not reachable; prompt timeouts reject the rest of the queue (1192-1194).
- **Optimistic send on same thread while a turn is in flight** — queued serially.
- **`closeSession` deletes workspace root guard before closing session** (release happens on
  close path, guarded).
- **Usage counter drift from `applyTurnStop`** — only resets `plan`; usage preserved.

## 3. Areas NOT verified (needs runtime repro / manual test)

- Multi-`BrowserWindow` (two windows) concurrent switches to the same cold thread — theory
  safe, no runtime evidence.
- Real-world frequency of size-only `usage_update` across cursor/codex/claude/opencode/
  grok/gemini/copilot agents (bug is real when any hit it — believed yes, esp. Claude's
  rate-limit wrapper).
- `node-pty` raw passthrough channel latency under load; large paste (50k+ chars) through
  terminal-manager.
- Windows/macOS platform-specific `dependency-installer`/`registry` PATH behavior.
- Rate: `monitor` DB growth with long-lived sessions (prune runs only from within `tick`).

## 4. Known-good map (verified clean)

- Main: activation switch atomicity (queue+generation), session-resume/new fallback keeps
  `thread.agent_session_id` updated; close/delete/terminal hard teardown; MCP HTTP server
  (16 in-flight cap, 30s body timeout, 429 paths); subagent manager (slot cap, cancel
  cascade, run retention 50); handshake-probe (teardown + non-recursive temp); launcher-update
  (SHA-256 verified, 1GiB cap, atomic state writes, corrupt-state recovery, partial cleanup);
  worktree manager (owner-only seeding, path containment, cache TTL, branch-cleanup);
  open-tabs (MAX_HISTORY 100, serialized mutations); threads pagination; db legacy
  constraint rebuild guarded by migration flag.
- **Renderer**: acp-session-reducer trim (2000/500), pending-thread forwarding filter in
  `applyBridgeEvent` (447-457) so background threads don't clobber the view, tab mismatch
  monitor, freeze observer cleanup, diff-store seen-set, zustand stores with bounded lists.

## 5. Suggested regression-test plan

- Unit (`vitest`): size-only usage_update (fix 1), reducer no-op identity for null updates;
  composer wipe-with-switch behavior test (fix 2); tab rename cache-sync test.
- Behavior: attach image → switch mid-decode → assert new thread composer intact; settle
  turn while scrolled-up → assert no viewport jump (1.5); draft typing → assert single
  `listFiles` IPC (1.3).
