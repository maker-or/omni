# Diff Performance: Default Prevention and Code Optimization

## Recommendation

Diffs should not be rendered or fully processed by default. The application should show diffs only after the user explicitly selects a **Show diffs** action.

This is an important prevention layer because many users do not need to inspect every change immediately. It avoids spending renderer CPU and memory on a feature that may never be viewed.

However, hiding the diff UI alone is not sufficient. The current `DiffIngestor` runs at a high level in the application and continues processing tool-call changes even when the diff panel is hidden or another tab is active. The expensive ingestion work must also be deferred.

## Current performance problem

The current flow is:

```text
ACP tool-call update
  -> threadToolCalls changes
  -> DiffIngestor runs
  -> complete tool-call collections are scanned
  -> tool calls are JSON serialized and fingerprinted
  -> diffs are extracted and stored
  -> diff rendering and paint work are scheduled
```

`DiffIngestor` can re-run when the tool-call map changes. In `diff-store.ts`, `toolCallVersion()` serializes the contents of each tool call to calculate a version, including tool calls that have not changed.

This creates repeated work during:

- Streaming updates
- Tab switches
- Background-thread updates
- Multiple concurrent agent runs
- Large conversations with many previous tool calls

The result is unnecessary serialization, diff extraction, React/store updates, DOM growth, and expensive paint work.

## Proposed default behavior

### When diffs are closed

Maintain only lightweight metadata:

- Number of threads with changes
- Number of changed files, when already known cheaply
- Whether new changes are available
- Which threads have pending diff updates

Do not perform full tool-call serialization, diff extraction, or diff rendering while the panel is closed.

The UI can show a small indicator such as:

```text
Changes available · Show diffs
```

### When the user opens diffs

Process the latest tool-call snapshot on demand. The first load should be asynchronous and incremental so that opening the panel does not cause another long renderer freeze.

Recommended behavior:

1. Prioritize the active thread.
2. Process its latest state in small batches.
3. Render the first available result quickly.
4. Process background threads afterward at a lower priority.
5. Show progress or a loading state while remaining files are prepared.

### When diffs are open

Continue processing updates, but apply batching and incremental change detection. Only changed tool calls should be parsed again.

## Why this should materially help

The performance investigation found that diff processing was a major source of renderer pressure:

- The normal session processed approximately 19,445 diff ingestions.
- It serialized approximately 33.4 GB of diff data.
- One thread accounted for roughly 15,891 ingestions and 32 GB of serialized data.
- The renderer repeatedly consumed 100–120% of one CPU core.
- The renderer DOM grew above 100,000 nodes during the long session.
- The low-battery session experienced post-paint delays up to approximately 7.75 seconds.

Users who never open the diff panel should not pay this cost. Deferring diff work should reduce background CPU, memory, DOM, and paint pressure and should substantially reduce the number of freezes users experience.

The exact improvement must be measured. Hiding the panel without stopping `DiffIngestor` will only reduce part of the cost and will leave the repeated serialization problem in place.

## Code optimization plan

### 1. Add an explicit diff visibility state

Create a shared state such as:

```ts
type DiffMode = "closed" | "loading" | "open";
```

`DiffIngestor` should read this state and skip full ingestion while the mode is `closed`.

### 2. Separate metadata from full diff ingestion

When the panel is closed, update only cheap counters and pending-thread metadata. Avoid passing complete tool-call payloads through the diff pipeline.

### 3. Use incremental tool-call versions

Avoid calling `JSON.stringify()` on every tool call during every update.

Preferred options, in order:

- Add a stable revision number when a tool call changes.
- Preserve object identity for unchanged tool calls.
- Cache fingerprints using `WeakMap` where appropriate.
- Serialize only a tool call whose revision or identity changed.

### 4. Coalesce streaming updates

Multiple updates arriving in the same short interval should produce one ingestion. Keep the newest state and discard intermediate states that will never be displayed.

Use a frame or short time budget, for example one ingestion per animation frame or every 50–100 ms, depending on the active workload.

### 5. Prioritize the active thread

The active thread should receive immediate processing. Background threads should be processed less frequently or when their turn completes.

This prevents background streams from competing with typing, tab switching, scrolling, and other user-visible work.

### 6. Move heavy parsing away from the renderer

If incremental processing is still expensive, move diff extraction and fingerprinting into a worker. The renderer should receive compact file-level updates rather than repeatedly traversing large ACP payloads.

### 7. Bound retained diff state

Add limits for:

- Maximum retained diff files per thread
- Maximum diff text size
- Maximum number of retained historical tool calls
- Maximum number of rendered lines or files at once

Older content should be compacted, virtualized, or loaded on demand.

### 8. Debounce expensive diff rendering

When one file is being edited through many streamed chunks, avoid reparsing and rerendering the entire file for every chunk. Render the newest available version after a short debounce interval.

## Suggested architecture

```text
Tool-call update
  -> Cheap pending-change metadata
  -> Is diff panel open?
       | no
       |   -> Stop full diff ingestion
       |   -> Update badge/counters only
       |
       | yes
           -> Coalesce updates
           -> Process changed tool calls only
           -> Prioritize active thread
           -> Render incrementally
```

## Validation plan

Run the same workload under four conditions:

1. Normal environment, diffs closed
2. Normal environment, diffs open
3. Low-battery environment, diffs closed
4. Low-battery environment, diffs open

Compare:

- Renderer CPU usage
- Renderer RSS memory
- DOM node count
- Diff-ingestion count
- Serialized UTF-16 bytes
- Long-task count and duration
- Next-frame delay
- Post-paint delay
- Renderer-freeze count and duration
- Tab-switch latency

The expected result is that the closed-diff cases remain responsive even when agent streams are active, while the open-diff cases remain bounded by incremental processing and backpressure.

## Success criteria

Initial targets should be:

- No renderer freeze longer than 1 second during normal interaction
- Post-paint delay below 100 ms for normal updates
- No sustained renderer usage above 80% of one core
- No multi-gigabyte diff serialization bursts
- Stable DOM size during long sessions
- Renderer memory should not continuously increase across completed turns
- Opening diffs should produce an asynchronous, recoverable load rather than blocking the application

## Final decision

Make diffs opt-in by default and gate the full diff pipeline behind the user action. This will reduce the amount of unnecessary work users experience immediately.

At the same time, implement incremental fingerprints, update coalescing, active-thread prioritization, and bounded rendering. Default deferral prevents unnecessary work; code optimization ensures that users who choose to view diffs still receive a responsive experience.
