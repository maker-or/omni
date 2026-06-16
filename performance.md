# Performance Plan for Faster Global Tab Switching, Session Loading, and Conversation Rendering

## Summary

The goal is to make the agent feel instant when switching among a small working set of threads spread across a small working set of projects, without changing the UX model. Global tabs remain global, but they will represent only the persisted open-thread set, not the full thread universe. Performance work is split across three layers with separate responsibilities:

- `TanStack Query` manages cached thread/project metadata, open-tab metadata, paginated dropdown data, and MRU-based prefetch.
- `Zustand` remains responsible for active runtime/session state, bridge events, streaming state, and imperative switch orchestration.
- `TanStack Virtual` is used only for the active conversation viewport, not for tabs or the full app shell.

This plan is optimized for the actual usage pattern established in this thread:

- users switch among at most `3` projects in a working set
- users keep at most `3-5` active threads per project
- global top tabs must contain only explicitly opened threads
- app restart must restore exactly the open tabs that existed on last close
- prefetch priority is based on most-recent thread-switch history

## What We Are Trying to Achieve

1. Make top-tab rendering independent from the full thread database.
2. Make app launch restore only the open working set, not all threads.
3. Make cross-project thread switching fast by warming the likely next project/thread working set.
4. Make dropdown thread browsing fast with paginated fetch plus MRU prefetch.
5. Make long conversations cheap to render and cheap to keep mounted while streaming.
6. Keep current UX semantics:
   - global tabs stay global
   - selecting a thread can jump projects
   - only opened threads appear in top tabs
   - closed tabs stay closed after restart

## Current Context and Constraints

Current implementation shape, already confirmed from the repo:

- [src/components/agent-panel.tsx](/Users/harshithpasupuleti/code/omni/src/components/agent-panel.tsx) is the main bottleneck surface. It currently owns:
  - top tabs
  - project dropdown
  - thread pane
  - conversation grouping/rendering
  - composer
  - scroll logic
  - message actions
- `useThreadStore.loadThreads()` currently loads the full global thread list and the top tabs map that entire list.
- `useThreadStore.loadProjectThreads(projectId)` already supports paginated project-local loading.
- `useAgentStore.switchThread()` already serializes and de-races thread switching with `threadSwitchQueue`, `latestThreadSwitchId`, and `pendingThreadTarget`.
- `AgentManager.switchThread()` in the main process is the actual expensive switch path because it may:
  - activate another project runtime
  - switch agent sessions
  - create a new session if the thread has no `session_file`
- Conversation data shown in the main panel comes from the live agent runtime snapshot, not primarily from the local `messages` table.
- `launch-state.json` persists last active project/thread, but there is no first-class persisted “open tabs” model yet.

## Architecture Decision

### 1. Keep global tabs, but reduce them to a persisted open-thread working set

Global tabs must not be derived from all threads in storage.

Implement a new persisted “open tabs” model with:

- `openThreadIds: string[]` in visual tab order
- `activeThreadId: string | null`
- `threadSwitchHistory: string[]` or a timestamped recency model sufficient to derive MRU projects/threads
- optional `lastOpenedAt` / `lastActivatedAt` metadata if useful for restoration and prefetch

Behavior:

- opening/selecting a thread from any surface adds it to the open-tab set if not already open
- closing a tab removes it from the open-tab set immediately
- app restart restores only the persisted open-tab set, in the same order
- if `5` tabs were open, restart shows `5`
- if `2` of those were closed before quitting, restart shows only the remaining `3`

This open-tab state becomes the sole source of truth for the top tab bar.

### 2. Use TanStack Query for thread/project metadata and prefetch, not live runtime state

TanStack Query is the correct tool for:

- open-tab thread metadata hydration
- project thread pages for dropdown browsing
- MRU project prefetch
- MRU thread page prefetch within those projects
- thread summary cache reuse across UI surfaces

TanStack Query is not the primary tool for:

- active agent runtime snapshot
- streaming conversation state
- bridge events
- in-flight switch orchestration

Those stay in Zustand and the existing agent bridge path.

### 3. Use TanStack Virtual only for the active conversation list

TanStack Virtual should be applied only to the conversation viewport.

It must support:

- dynamic row heights
- streaming assistant messages
- tool/result rows
- trace deck expansion/collapse
- scroll-to-bottom behavior on stream append
- fast thread switches where the active transcript swaps out

It must not be used for:

- global tabs in v1
- dropdown project list in v1
- thread pane in v1

## Implementation Changes

### A. Persistent Open-Tabs Model

Add a persisted open-tab state store in the Electron layer. This should live alongside `launch-state.json` or in a new persisted state file, and it should be loaded during startup before the renderer mounts the main tab UI.

Required state:

- ordered `openThreadIds`
- `activeThreadId`
- MRU switch history sufficient to rank:
  - most recent projects by thread-switch history
  - most recent threads within each project by thread-switch history

Required behaviors:

- `openThread(threadId)`
- `closeThread(threadId)`
- `setActiveThread(threadId)`
- `restoreOpenTabs()`
- `recordThreadSwitch(threadId)`

Switch-history ranking rules:

- “recent projects” are derived from actual thread switch history, not alphabetical order and not project list order
- “recent threads within project” are also derived from switch history first, then fall back to `last_used_at`

Renderer impact:

- top tabs render only from open-tab metadata
- the full `loadThreads()` global fetch is removed from the top-tab rendering path
- tabs must not depend on full-thread-list availability

### B. TanStack Query Integration

Introduce a `QueryClient` at app root and move metadata-fetch concerns from ad hoc Zustand fetching into query-backed hooks.

Create query domains:

1. `open-tab metadata`

- Query key: `["open-tabs"]`
- Returns ordered open-tab thread summaries for top-tab rendering
- Each summary contains only fields needed for the tab UI:
  - `id`
  - `project_id`
  - `title`
  - `last_used_at`
  - `created_at`
  - `session_file`
  - project display metadata needed by tab icon/title

2. `project thread pages`

- Query key: `["project-threads", projectId, pageSize, cursorOrOffset]`
- Used by dropdown thread browsing
- Source of truth for per-project paginated thread lists

3. `project recent threads`

- Query key: `["project-recent-threads", projectId]`
- Eagerly fetches the `3-5` most recent threads for MRU-prefetched projects
- Can be implemented as first page of project threads if sorting guarantees are aligned

4. `recent projects`

- Query key: `["recent-projects"]`
- Derived from persisted thread-switch history
- Returns top `3` projects by actual recent switching

Cache policy defaults:

- open-tab metadata: long `staleTime`, long cache lifetime, update manually after open/close/rename/delete
- project thread pages: moderate `staleTime`, page cache retained while app is open
- recent-project and recent-thread caches: eagerly prefetched after switch and on launch restoration
- no polling and no automatic refetch-on-focus for these UI-critical lists

Mutation/update policy:

- thread open/close/rename/delete should update query cache directly or invalidate only the minimal keys
- avoid broad invalidation of all thread queries
- cross-surface consistency matters more than generic refetch correctness

Important non-goal:

- do not move the live conversation stream into Query cache

### C. MRU-Based Prefetch Strategy

Prefetch is based on actual switch behavior, not project list order.

At launch:

- restore open tabs
- derive top `3` recent projects from thread-switch history
- prefetch recent-thread data for those `3` projects
- within each prefetched project, eagerly fetch the top `3-5` most recent threads

After each successful thread switch:

- record the switch into history
- update the recent project ranking
- prefetch metadata for:
  - the currently active project
  - the next `2` recent projects
- within each of those projects, keep `3-5` most recent threads warm

When the dropdown opens:

- do not block on fetch if prefetched data is already present
- show cached first page immediately
- continue paginated fetching for deeper pages only on explicit user action such as hover/load-more/select

This is a metadata optimization only. It makes lists and thread availability feel instant, but it does not replace runtime/session warming.

### D. Runtime and Session Warming

Keep runtime/session switching separate from query caching.

Introduce a warm-runtime policy in the main process:

- retain up to `3` warm project runtimes keyed by project id
- the active project runtime is always warm
- the next `2` most recently switched-to projects are also kept warm when possible
- eviction policy: LRU by actual thread/project switch recency

Behavior:

- same-project thread switch should avoid project activation cost
- cross-project switch should check whether destination runtime is warm before cold activation
- if warm, switch should reduce to session attach/swap where possible
- if cold, switch still proceeds, but the renderer should already have instant tab metadata and conversation shell state available

Do not over-warm per-thread sessions in v1 unless the underlying agent runtime supports it safely. The guaranteed warming level is project runtime plus recent thread metadata, not arbitrary concurrent session pinning.

### E. Renderer Refactor for Lower Rerender Cost

Refactor [src/components/agent-panel.tsx](/Users/harshithpasupuleti/code/omni/src/components/agent-panel.tsx) into separate memoized subtrees.

Required splits:

- `GlobalThreadTabs`
- `ProjectThreadDropdown`
- `ConversationPane`
- `Composer`
- `ModelControls` if needed

Rules:

- conversation subtree must not rerender because dropdown hover state changes
- top tabs must not rerender because composer text changes
- settled message rows must not rerender because unrelated UI state changes
- active switch state should be limited to the minimal subtree that needs it

Message handling:

- keep message grouping logic out of the monolithic panel component
- avoid rebuilding grouped transcript arrays unnecessarily for every unrelated state update
- treat the currently streaming assistant message as a special live row or live group

### F. TanStack Virtual for Conversation Rendering

Apply virtualization only to the active conversation list.

Virtualization requirements:

- stable keys per grouped message block, not array indices
- dynamic measurement for assistant rows, tool rows, and expanded traces
- append-aware scroll behavior for streaming
- immediate bottom snap on thread switch
- preserve usability when transcript is short; virtualization must not regress small chats

Rendering policy:

- historical settled messages are memoized and measured once unless their content changes
- the current streaming assistant row is allowed to re-measure frequently
- trace-heavy assistant rows should render collapsed by default if that is already consistent with existing UX

Expected gains:

- much lower DOM node count for long transcripts
- lower reconciliation cost during stream updates
- lower scroll jank when switching back to long-running threads

### G. API and Interface Changes

Introduce or extend the following public interfaces/contracts:

1. Open tab persistence API exposed through preload

- `tabs:listOpen()`
- `tabs:open(threadId)`
- `tabs:close(threadId)`
- `tabs:setActive(threadId)`
- `tabs:getActive()`
- `tabs:onChanged(...)`

2. Thread summary shape for metadata-driven UI

- compact thread summary type for tab/dropdown queries
- includes project display metadata needed by renderer without requiring a separate full project lookup in every render

3. Query hooks

- `useOpenTabsQuery()`
- `useProjectThreadsQuery(projectId, page)`
- `useRecentProjectsQuery()`
- `usePrefetchRecentProjects()`

4. Runtime warming service contract in main process

- explicit manager methods for warm/cold project runtime handling
- internal LRU policy, not exposed as user-facing UI

These additions should not replace `window.omni.agent.*` for live switching. They supplement it.

## What Performance Gains We Expect by Using What and Where

### 1. Open-tab persistence + metadata-only global tabs

Used for:

- top-tab rendering
- app restoration

Gain:

- removes the need to fetch/render the full thread universe for tabs
- app launch and top-tab rendering scale with “open threads” instead of “all threads”
- directly improves perceived startup speed and tab-bar responsiveness

Expected impact:

- large improvement when users have many historical threads but only a small active working set

### 2. TanStack Query for metadata caching and prefetch

Used for:

- open-tab summaries
- project thread pages
- recent project/thread prefetch

Gain:

- immediate cache hits for dropdown opening and tab metadata reuse
- avoids duplicate fetches across hover/open/switch flows
- reduces unnecessary rerenders in consumers when query boundaries are designed correctly
- gives explicit cache lifetime and prefetch control

Expected impact:

- medium to large improvement in dropdown responsiveness
- medium improvement in perceived speed after app launch and after thread switches

### 3. Warm project runtimes

Used for:

- same-project and cross-project thread switches

Gain:

- reduces cold activation cost for the small recent-project working set
- makes cross-project switching much closer to same-project switching in common cases

Expected impact:

- large improvement for users bouncing among `2-3` active projects

### 4. TanStack Virtual for conversation

Used for:

- active transcript rendering only

Gain:

- lowers render cost for long transcripts
- reduces DOM size and streaming repaint cost
- makes revisiting long threads less expensive

Expected impact:

- medium to large improvement for long chats
- small impact for short chats

### 5. Component split + memoization

Used for:

- all agent panel UI

Gain:

- prevents unrelated state changes from causing full conversation/tree rerenders
- reduces CPU churn during typing, hovering, and switching

Expected impact:

- broad medium improvement across all interaction flows
- especially noticeable during active streaming and dropdown interaction

## Detailed Build Order

Implement in this order to reduce risk and keep each step measurable.

1. Introduce persisted open-tab state and remove top tabs’ dependency on global `loadThreads()`.
2. Add TanStack Query and migrate metadata-fetch flows:
   - open tabs
   - project thread pages
   - recent projects / recent threads
3. Add MRU thread-switch history and prefetch pipeline.
4. Add warm project runtime cache in the main process.
5. Refactor `agent-panel` into memoized subcomponents.
6. Add TanStack Virtual to `ConversationPane`.
7. Tune cache times, prefetch counts, and runtime warm-set size using local measurements.

## Test Plan

### Functional scenarios

1. Open `5` threads across `5` projects, restart app, confirm exactly `5` tabs restore in the same order.
2. Close `2` of those tabs, restart app, confirm only the remaining `3` restore.
3. Select a thread from dropdown that is not currently open, confirm it becomes an open persisted tab.
4. Switch repeatedly among threads from `3` projects, confirm recent projects and recent threads are prefetched according to switch history.
5. Rename or delete an open thread, confirm top-tab metadata updates immediately and query caches stay consistent.
6. Delete the active thread, confirm fallback active tab behavior remains correct and persisted tab state updates.

### Performance scenarios

1. Large historical dataset, small open-tab set:
   - confirm startup and top-tab render do not depend on full historical thread count.
2. Rapid same-project tab switching:
   - confirm no redundant project activation or full-list refetches.
3. Rapid cross-project tab switching among recent projects:
   - confirm warm-runtime path is used after first activation.
4. Dropdown open on a recent project:
   - confirm first `3-5` recent threads appear from cache without waiting for network/IPC fetch.
5. Long transcript thread switch:
   - confirm conversation pane mounts quickly and scroll behavior remains stable with virtualization.
6. Active streaming thread:
   - confirm no scroll-jank, message duplication, or stale snapshot flashes during and after switch.

### Regression scenarios

1. Pending thread switch races:
   - confirm `pendingThreadTarget` and queued switch logic still prevents stale snapshot adoption.
2. Cold runtime project:
   - confirm switch still works correctly when destination project is not warm.
3. Thread without `session_file`:
   - confirm new session creation still binds correctly and open-tab metadata updates.
4. Missing session file on disk:
   - confirm current fallback behavior remains intact.
5. Empty open-tab set on launch:
   - confirm app starts cleanly and first selected/opened thread becomes the first tab.

## Assumptions and Defaults

- Global top tabs remain global and must contain only explicitly opened threads.
- Selecting a thread from dropdown automatically opens and persists a tab.
- There is no hard cap on open tabs in v1.
- Prefetch target is top `3` recent projects by actual thread-switch history.
- Within each recent project, eager thread prefetch count is `3-5`, implemented initially as `5`.
- Warm runtime cache size is `3` projects, LRU-based.
- Live conversation state stays in Zustand/agent bridge, not TanStack Query.
- TanStack Virtual is applied only to the active conversation list.
- The existing project-local pagination API remains valid and is reused rather than replaced.
- `loadThreads()` is removed from the main top-tab path; historical/global thread listing can still exist elsewhere if needed, but not as a dependency of the primary agent panel.
