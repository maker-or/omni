# Agent Panel Behavior Report

## Understanding and Scope

The target is not just a visual component inventory. The goal is a behavior map for the current `AgentView`, specifically the agent panel: every visible element, state input, local state, runtime snapshot field, data transformation, side effect, guard, and cross-component reaction that can change what the user sees or what the panel does.

In this codebase, `src/components/agent-view.tsx` only re-exports `AgentPanel`, so the agent-view behavior is effectively `src/components/agent-panel.tsx` plus the shared UI components, Zustand stores, query hooks, and Electron/agent runtime APIs it depends on.

Primary files reviewed:

- `src/components/agent-panel.tsx`
- `src/components/agent-view.tsx`
- `src/store/agent-store.ts`
- `src/store/thread-store.ts`
- `src/store/project-store.ts`
- `src/lib/thread-queries.ts`
- `src/lib/agent-message-images.ts`
- `src/lib/agent-commands.ts`
- `src/lib/message-utils.ts`
- `@/components/ui/input-message.tsx`
- `@/components/ui/chat-message.tsx`
- `@/components/ui/assistant-trace-deck.tsx`
- `@/components/ui/thinking-steps.tsx`
- `@/components/ui/context-window-ring.tsx`
- `src/components/ui/tabs.tsx`
- `@/components/ui/dropdown.tsx`
- `@/components/ui/menu-item.tsx`
- `src/components/ambient-pixel-field.tsx`
- `electron/agent.ts`
- `electron/main.ts`
- `electron/open-tabs.ts`
- `contracts/agent.ts`

## Mental Model

`AgentPanel` is a controlled UI shell around a mutable agent runtime. Its behavior is driven by four classes of state:

1. Runtime snapshot state from `useAgentStore`: messages, streaming status, queue, model, thinking level, stats, UI requests, busy flags, and entry refs.
2. Thread/project state from stores and React Query: active project, open tabs, recent project history, thread pages, and project thread lists.
3. Local UI state inside `AgentPanel`: input text, attachments, edit mode, tab selection optimism, dropdowns, rename state, preview modal, copying state, model search, abort/submission flags.
4. Shared component state: tab hover/focus/rename behavior, composer auto-grow/drag/drop/send/stop behavior, trace deck open state, context ring tooltip state, thumbnail loading state.

The key behavioral principle is that many visible changes are not caused by direct clicks on the element that changes. For example, selecting a thread changes the active tab immediately, disables the composer while the old snapshot is still displayed, mutates persisted open tabs, triggers the agent runtime to switch, refreshes the active project, then only later replaces messages when the accepted snapshot arrives.

## State Sources and Observable Outputs

### Agent snapshot fields used by the panel

- `threadId`: drives selected tab value, open tab persistence, thread-switch completion, `isSwitchingThread`, empty state subject, send/replace target.
- `projectId`: used to resolve the current project name shown in the empty state.
- `messages`: source of the visible conversation after filtering/grouping.
- `messageEntryRefs`: enables user-message edit and regenerate target lookup.
- `streamingMessage`: appended to `messages` only while `isStreaming` is true.
- `isStreaming`: changes send button to stop, shows streaming behavior toggle, hides regenerate, disables editing, blocks current-thread deletion, updates markdown rendering, opens trace deck, changes scroll behavior.
- `isCompacting` and `isRetrying`: disable assistant regenerate.
- `queue.steering` and `queue.followUp`: render the queue banner above the composer.
- `commands`: merged with built-in slash commands and drives slash menu.
- `models` and `model`: drive model selector, provider mark, dropdown rows, selected check, and disabled state.
- `thinkingLevel`: renders the reasoning cycle button when non-null.
- `stats`, `stats.contextUsage`, `stats.cost`: render context ring and cost.
- `autoCompactionEnabled`: appears in context tooltip only when true.
- `uiRequest`: renders modal dialog through the store, not in the snapshot object.
- `status`, `workingMessage`, `workingVisible`, `hiddenThinkingLabel`, `title`, `editorText`: stored and updated by `AgentStore`, but currently not visibly rendered by `AgentPanel`.

### Local panel state

- `inputValue`: controlled composer text, slash matching, send payload, edit body.
- `attachedFiles`: controlled composer file previews and image payload conversion.
- `isSubmitting`: disables composer and edit/regenerate paths while a send or replace call is in flight.
- `isAborting`: disables the stop action while abort is in flight.
- `streamingBehavior`: toggles between `followUp` and `steer`; only sent when the current snapshot is streaming.
- `selectedCommandIndex`: keyboard selection within slash command matches.
- `editState`: marks edit mode and stores target entry id plus retained images.
- `previewImage`: opens full-screen image modal.
- `isDropdownOpen`: opens project/thread dropdown and closes model dropdown.
- `isModelDropdownOpen`: opens model dropdown and resets model search.
- `modelSearch`: filters visible models.
- `mountTime`: freezes thread recency labels relative to panel mount.
- `hoveredProjectId`: drives thread pane project and thread prefetching.
- `requestedThreadId`: tracks an in-progress thread switch for cleanup.
- `editingThreadId`, `editingThreadTitle`, `editingThreadOriginalTitle`: inline tab rename state.
- `activeTabId`: optimistic selected tab value, separate from snapshot thread id.
- `threadPaneStyle`: fixed-position portal coordinates for the thread pane.
- `copiedMessageId`: copy icon swaps to check for two seconds.

## Component Behavior Map

### 1. Root agent panel

Element: `<section data-pipper-id="agent-panel">`.

Behavior:

- Provides the root flex column and allows dropdown/portal overflow.
- Mount effect calls `connect()`, which subscribes to the agent event bridge and fetches the initial runtime snapshot.
- Mount effect loads `window.omni.projects.list()` into `projectsList`.
- Reacts to `activeProject.id` changes from `App` by calling `refresh()`.
- Wraps the conversation area in controlled `Tabs` with value `threadId`.

State reactions:

- When `uiRequest` exists, a blocking modal renders above the panel.
- When `previewImage` exists, a full-screen image preview renders at z-index 4000.
- When the snapshot thread changes, the panel sets `activeTabId` and persists the thread as an open tab.

### 2. UI request dialog

Element: conditional `UiRequestDialog`.

Kinds:

- `select`: title, optional message, vertical list of option buttons. Clicking an option responds with that string.
- `confirm`: title, message, `No` returns `false`, `Yes` returns `true`.
- `input`: title, textarea with optional placeholder/prefill, `Cancel` returns `undefined`, `Submit` returns trimmed text or `undefined`.

Data flow:

- Runtime emits `ui-request`.
- `AgentStore` stores it as `uiRequest`.
- Dialog response calls `respondToUiRequest({ requestId, value })`.
- Store clears the request after response; runtime also emits `ui-response`.

Notable behavior:

- Input dialog resets local text whenever the request object changes.
- The dialog itself has no click-outside or Escape close behavior.

### 3. Image preview modal

Trigger:

- Clicking any message attachment thumbnail sets `previewImage`.

Behavior:

- Renders a fixed, full-screen dark backdrop.
- Displays the base64 image as an `img` with object containment.
- Clicking anywhere on the backdrop, including the image itself because the image does not stop propagation, closes the modal.

### 4. Thread tabs

Elements: `thread-tabs-container`, `thread-tabs`, `TabItem`.

Data and sorting:

- Uses `useOpenTabsQuery()`, whose `fetchOpenTabs` reads persisted open tab ids and filters out deleted/missing threads.
- Renders open tabs sorted by `created_at` ascending.
- The active value comes from `activeTabId || snapshot.threadId`.

Selection behavior:

- Clicking or keyboard-activating a tab calls `handleSelectThread(id)`.
- `activeTabId` changes immediately, before the agent runtime switch completes.
- `window.omni.tabs.open(id)` persists the tab and broadcasts open-tab state.
- If the selected id is already the snapshot thread id, no runtime switch occurs.
- Otherwise `requestedThreadId` is set, `switchThread(id)` is called, and `loadActiveProject()` runs afterward.

Switching state:

- `isSwitchingThread` is true when `activeTabId` differs from `snapshot.threadId`.
- While switching, the message scroll region has `aria-busy=true`.
- The composer is disabled through `InputMessage`.
- Old snapshot messages can remain visible under the optimistic new active tab until the matching snapshot arrives.

Error behavior:

- If `AgentStore.error` exists and `snapshot.threadId` still exists, `activeTabId` reverts to `snapshot.threadId`.
- `requestedThreadId` clears when the matching snapshot arrives or when an error is set.

Close behavior:

- Close button is visible on selected tabs and on hover for unselected tabs.
- Closing a tab calls `window.omni.tabs.close(id)` and invalidates open tabs.
- If the closed tab was active, fallback selection is:
  1. `nextState.activeThreadId` if it remains in the sorted thread list.
  2. The thread at the same sorted index.
  3. The previous sorted thread.
  4. The last remaining sorted thread.
  5. No active tab.
- If no fallback exists, `window.omni.tabs.setActive(null)` persists no active tab.

Rename behavior:

- Double-click starts rename with current title.
- The input auto-focuses and selects the whole title.
- Blur commits unless blur was caused by Enter/Escape bookkeeping.
- Enter attempts commit; if commit returns false, the input refocuses and reselects.
- Escape cancels and blurs.
- Empty title or unchanged title cancels rename without calling the backend.
- Successful rename updates `thread-store`, updates open tab query data, and exits edit mode.
- If the edited thread disappears from `openThreads`, edit mode is canceled.

Shared tab component behavior:

- `TabsList` maintains tab order, proximity hover index, focus index, and an optimistic selected indicator.
- Arrow focus auto-activates because `activateOnFocus` is enabled.
- Active, hover, and focus backgrounds animate based on measured tab rects.

### 5. Add-thread button, project dropdown, and thread pane

Elements: `add-thread-button`, `project-dropdown`, `thread-pane`.

Button behavior:

- Click toggles project dropdown.
- Opening the dropdown sets `hoveredProjectId` to the active project id, or the first project id.
- Opening project dropdown closes model dropdown.
- Closing project dropdown clears `hoveredProjectId`.
- The button receives an active visual state while dropdown is open.

Project dropdown behavior:

- Renders every project as a `MenuItem`.
- The active project is checked, but selecting a project item does not switch the active project. It only changes `hoveredProjectId` so the side thread pane shows that project's threads.
- Hover, focus, or keyboard selection all set `hoveredProjectId`.
- `Add Project` closes dropdown and calls `window.omni.launch.show("add")`.

Thread pane behavior:

- Rendered through `createPortal(document.body)`.
- Positioned fixed at the right edge of the project list plus 8px.
- Position updates on dropdown open, project hover, window resize, and any scroll event.
- Outside-click closing ignores clicks inside the thread pane.
- Shows threads for `hoveredProjectId` from a merge of React Query first page and Zustand loaded pages.
- Row click closes dropdown and selects the thread.
- Delete button calls delete behavior unless this row is the current snapshot thread while streaming.
- `Load more` uses `loadProjectThreads(hoveredProjectId)` and disables while thread loading is active.
- `Create new thread` closes dropdown and calls `handleCreateThread()`.

Create thread behavior:

- Chooses `hoveredProjectId` or active project id.
- Builds a provisional title from project name and current store count.
- Calls `agent.createThread(projectId, title, snapshot.threadId)`.
- Adds the returned thread to local thread store.
- Selects the new thread.
- Backend may override the provisional title with `buildNextThreadTitle`.

Delete thread behavior:

- Current streaming thread deletion is blocked in UI and in handler.
- Other threads show a native `window.confirm`.
- On confirm, calls `threadStore.deleteThread`, closes dropdown, invalidates open tabs, invalidates a `["threads", project_id]` query key, then selects persisted active tab if any.
- Backend deletion removes session file, removes DB row, and may switch runtime to another thread in the same project.

### 6. Empty state

Element: `empty-state`.

Condition:

- Rendered only when `allMessages.length === 0`.

Behavior:

- Ambient pixel background renders only when there are zero visible messages.
- Empty state text uses `projectsList.find(snapshot.projectId) || activeProject`.
- If no project is known, subject is `your project`.
- Input area background is transparent in the empty state, `surface-1` otherwise.

Ambient field behavior:

- Uses `ResizeObserver` to compute grid rows/columns.
- Pixel opacity is deterministic per coordinate for a given component seed.
- Two blurred glow layers animate when `animated=true`.
- Mask gradient fades pixels toward the top.

### 7. Message list and virtualization

Element: `messages-list`.

Data transformation:

- Starts from `snapshot.messages`.
- Keeps only `role === "user"` and `role === "assistant"`.
- Appends `snapshot.streamingMessage` only when `isStreaming` is true and streaming message exists.
- Groups consecutive messages with the same visible role into one `GroupedMessageEntry`.
- Each group tracks first original message index and whether any message in the group is streaming.

Virtualizer behavior:

- Uses `@tanstack/react-virtual`.
- Count is `allMessages.length`.
- Estimate size is 96px for user groups, 180px for assistant groups.
- Overscan is 6.
- Virtual rows are absolutely positioned by `translateY(virtualRow.start)`.
- Attachment image load calls `conversationVirtualizer.measure()`.

Scroll behavior:

- Computes a `latestConversationScrollKey` from thread id, message group count, streaming/settled state, latest role, and latest visible text length.
- If not streaming, scroll jumps instantly to bottom.
- If streaming, scroll follows only if the user is within 120px of the bottom or there are no messages.
- Streaming follow uses a requestAnimationFrame spring with stiffness 0.12.
- Any in-flight scroll animation is canceled on key changes/unmount.

Thinking indicator:

- If `isStreaming` is true but `streamingMessage` is absent, a standalone `ThinkingIndicator` appears just below the virtualized content.
- Once a streaming message exists, the indicator is replaced by the streaming message content/trace.

### 8. Chat message behavior

`ChatMessage` receives `from`, `time`, `actions`, and children.

Behavior:

- User messages align right and use accent bubble styling.
- Assistant messages align left and render text without a bubble background.
- Message container animates in with framer-motion.
- Actions and user time are hidden until message hover or focus-within.
- `ChatMessage` only displays time for user messages; assistant `time` is passed by the panel but ignored by the component's `showTime` guard.

Action behavior:

- User group actions: copy and edit.
- Assistant group actions: copy and regenerate, except regenerate is hidden while that group is streaming.
- Copy writes combined visible text to clipboard, flips icon to check for two seconds, then resets if no newer copy happened.
- User edit is disabled if the group is streaming, if submitting, or if `messageEntryRefs[originalIndex]` is missing.
- Edit populates composer with group text, clears new attached files, stores retained images, and focuses the composer.
- Regenerate is disabled while submitting, compacting, or retrying.
- Regenerate walks backward from the assistant group's original index to find the nearest user message, then calls `replacePrompt` with that user's entry id, text, and extracted images.

Image behavior:

- Extracted image parts render as 96px thumbnails below message body.
- Clicking a thumbnail opens the full-screen preview modal.
- The preview modal uses the same base64 data and MIME type.

### 9. Message body and assistant trace behavior

`MessageBody` behavior:

- `assistant` messages split content array parts into trace parts (`thinking`, `toolCall`) and text parts.
- Trace parts render through `AssistantTraceDeck`.
- Text parts render through `MarkdownRenderer`; settled messages are memoized by markdown content.
- Plain user text and fallback content render whitespace-preserved.
- `toolResult` body rendering exists in `MessageBody`, but `AgentPanel` filters toolResult messages out of `allMessages`, so this branch is not reached from the current message list.

Trace deck behavior:

- Open state initializes from `isStreaming`.
- Any `isStreaming` change forces `open` to the current streaming value, so a user-collapsed trace will reopen when streaming becomes true.
- Thinking parts become active only if they are the last trace part during streaming.
- Tool-call result lookup searches `activeMessages` for `role === "toolResult"` and matching `toolCallId`.
- Last unresolved tool call during streaming is active and shows nested `ThinkingIndicator`.
- Tool call labels/descriptions are converted into friendlier copy:
  - `bash` commands are classified as searched/read/inspected/build/git/etc.
  - read/grep/search names become "Gathered context".
  - write/replace/edit names become "Updated files".
- Search/web/globe tools extract up to five unique source domains from result URLs.
- Screenshot/image/layout tools extract data URLs or image paths for previews.
- File/read/grep/write/replace tools expose up to ten trimmed result lines in details.
- Bash result renders as a monospace block.
- Error result renders red error text and changes result summary.

### 10. Composer and input area

Elements: `input-area`, queue banner, edit banner, slash menu, `InputMessage`.

Queue banner:

- Renders if either `snapshot.queue.steering.length` or `snapshot.queue.followUp.length` is non-zero.
- `steering` entries appear under "Steering"; `followUp` entries appear under "Next".
- Each queue item is line-clamped with full text in `title`.

Edit banner:

- Renders when `editState` exists.
- Shows retained image count.
- Cancel clears edit state, input text, and new attached files.

Composer disabled state:

- Disabled when switching thread, submitting, or editing while streaming.
- In disabled state, `InputMessage` applies opacity and pointer-events none to the whole composer surface.

Send behavior:

- `InputMessage` submits on Enter without Shift unless slash-menu handling prevented default.
- Send button and key send are enabled by `InputMessage` only when not disabled and either trimmed text or current files exist.
- Parent `handleSend` additionally allows edit sends with retained images, but the child component cannot trigger retained-image-only sends because it does not know about `editState.images`.
- Empty send with no files and no retained images returns immediately.
- `/abort` with no args calls `abort()` and clears input.
- `/compact` calls `compact(customInstructions)` and clears input.
- Normal send converts attached files to prompt images, then:
  - If editing and `operationThreadId` exists, calls `replacePrompt`.
  - Otherwise calls `sendPrompt`.
- `streamingBehavior` is included only when current snapshot is streaming.
- After successful send/replace on the same thread, input, attachments, and edit state clear.
- Streaming behavior resets to `followUp` after send/replace.
- `isSubmitting` resets in `finally`.

Stop behavior:

- While `isStreaming`, `InputMessage` swaps send icon to stop icon.
- Clicking stop calls `handleAbort`, guarded by `isAborting`.
- `handleAbort` calls runtime abort and resets `isAborting` afterward.

InputMessage internal behavior:

- Textarea auto-grows from 1 to 8 rows and then scrolls.
- Container click focuses textarea unless target is interactive.
- Hover, focus-visible, and drag-over recolor the edge shadow with precedence drag > focus > hover.
- File drag-over only activates for drags containing `Files`.
- Dropping files filters by `accept`, dedupes by name/size/lastModified, truncates to `maxFiles`, and calls parent `onFilesChange`.
- File picker can temporarily override accept for one invocation and resets accept in a microtask.
- Attached files show animated preview tiles with remove buttons.

### 11. Slash command behavior

Data:

- Built-ins are always `compact` and `abort`.
- Runtime commands are appended after built-ins unless their name duplicates a built-in.
- Matching is active only when trimmed-start input begins with `/`.
- Query is the first token after `/`.
- Matches are sorted so prefix matches come before substring matches.

Menu behavior:

- `AgentSlashCommandMenu` renders only when matches exist.
- Shows at most 8 commands.
- Uses reduced-motion-aware enter/exit animation.
- ArrowUp and ArrowDown cycle `selectedCommandIndex`.
- Tab or Enter with a bare command token applies the selected command as `/${name} `.
- Escape resets selected index to 0.

### 12. Attachments and image validation

Allowed prompt image MIME types:

- `image/png`
- `image/jpeg`
- `image/gif`
- `image/webp`

Panel validation:

- `partitionValidImageFiles` rejects unsupported MIME types, files over 10 MiB, and more than 5 images for that validation call.
- Rejection shows a toast titled "Attachment rejected".
- `fileToPromptImage` validates again and converts accepted files to base64.
- Edit mode preserves existing message images and sends them alongside new images.

Extraction:

- Message images are read from array content parts with `type === "image"`, string `data`, and string `mimeType`.
- Image ids are deterministic from content index, MIME type, and the first 16 data chars.

### 13. Streaming-specific behavior

When `snapshot.isStreaming` is true:

- `streamingMessage` may be appended to messages.
- Standalone `ThinkingIndicator` appears if there is not yet a streaming message.
- Composer action button becomes stop.
- Streaming behavior toggle appears with label `Next` or `Steer`.
- User edit buttons are disabled.
- Assistant regenerate buttons are hidden for streaming groups.
- Current active thread delete button is disabled in thread pane.
- `sendPrompt` includes `streamingBehavior` only if user sends while streaming.
- Trace deck opens and the last unresolved thinking/tool step is active.
- Scroll follows only if user is near the bottom.

### 14. Model selector and thinking level

Thinking level:

- Button renders only when `snapshot.thinkingLevel` is neither `undefined` nor `null`.
- Click calls `cycleThinkingLevel()`, then store refreshes snapshot.
- There is no local pending/disabled state while the cycle request is in flight.

Model selector:

- Button disabled when `models.length === 0`.
- Button shows provider icon if `snapshot.model.provider` exists and model name or "No model".
- Opening model dropdown closes project dropdown.
- Opening model dropdown resets search to empty.
- Search filters by model display name, model id, or formatted provider name.
- Escape in search input closes dropdown.
- Clicking a model calls `setModel({ provider, modelId })`.
- Dropdown closes only if `setModel` returns true.
- Selected row is highlighted and shows a check icon.
- Empty filtered results show "No matching models".

Provider mark behavior:

- Provider string is mapped by substring to icon kind: codex, copilot/github, anthropic/claude, groq, xai/grok, openrouter, opencode, kimi/moonshot, openai, or generic.
- Provider label is formatted by splitting on whitespace, underscore, and hyphen, then capitalizing words.

### 15. Stats bar and context ring

Stats bar:

- Renders only when `snapshot.stats` exists.
- Context ring renders if stats has valid context usage or model has a positive context window fallback.
- Cost text renders only when `snapshot.stats.cost > 0`.

Context ring behavior:

- Known usage: label is rounded whole percent, fill color is foreground under/equal 70%, amber over 70%, destructive over 90%.
- Unknown usage: label is `?`, ring animates to 75% offset at 50% opacity, tooltip says usage updates after next model response.
- Tooltip opens after Radix delay and remains mounted only while animating open/closed.
- Tooltip details can include context tokens/window, model name, auto-compaction status, session tokens, and session cost.

### 16. Store and runtime behavior

AgentStore:

- `connect()` unsubscribes any previous bridge listener, subscribes to `agent:event`, toasts notifications, applies bridge events, then fetches initial state.
- Keeps only the latest 200 bridge events.
- During a pending thread switch, non-snapshot events are ignored for visible state, but still appended to `events`.
- During a pending thread switch, snapshot events for the wrong thread are ignored.
- The matching snapshot clears `pendingThreadTarget`.
- `switchThread()` serializes switches with a queue and uses `latestThreadSwitchId` so older switch completions cannot overwrite newer selections.
- `setModel`, `cycleThinkingLevel`, `createThread`, and similar methods refresh snapshot after the IPC action.
- `sendPrompt`, `replacePrompt`, `abort`, and `compact` call IPC actions directly; prompt/compact streaming updates arrive through bridge snapshots.

Runtime:

- Session events update queue and session title, emit bridge events, and push snapshots.
- `agent_end` completes mutation analytics and pushes an additional settled snapshot on the next tick.
- Snapshot resolution exposes active project/thread only if that project is currently active.
- `sendPrompt` switches thread first if needed, creates a thread if no active thread exists, touches thread recency, starts analytics, calls session prompt asynchronously, then pushes snapshot.
- Prompt failure emits error notification and attempts fallback model cycle.
- `replacePrompt` refuses while streaming, compacting, or retrying; rewinds branch before the target user message and re-sends.
- `compact` starts asynchronously and emits notification on failure.
- `requestUi` supports timeout resolution, but timeout currently resolves the pending promise without emitting a `ui-response` bridge event.

Thread and query layer:

- Open tabs are persisted through launch state and broadcast over `tabs:changed`.
- `useOpenTabsQuery` briefly writes broadcast state with stale `openThreads`, then invalidates to fetch actual thread rows.
- Project thread queries fetch the first page through React Query.
- Zustand `loadProjectThreads` also fetches pages with offset, stores page loading/hasMore state, and merges pages into `threads`.
- `useMergedProjectThreads` merges query threads and store threads by id, then sorts by `last_used_at` and `created_at` descending.

## Cross-Component Reaction Chains

### Selecting a tab

Trigger: click/focus-activate tab.

Chain:

1. `TabItem` sets optimistic tab index for animation.
2. `Tabs` calls panel `handleSelectThread`.
3. `activeTabId` changes immediately.
4. Persisted open tabs mutate through `tabs.open`.
5. Open tabs query invalidates.
6. If the selected thread is not the current snapshot thread, `requestedThreadId` is set.
7. `AgentStore.switchThread` sets `pendingThreadTarget` and queues the IPC switch.
8. While pending, composer disables and scroll area has `aria-busy`.
9. Wrong-thread bridge events are ignored.
10. Matching snapshot clears pending target and replaces messages/model/project state.
11. `loadActiveProject()` refreshes app-level active project.

### Starting an edit

Trigger: user message edit action.

Chain:

1. Message group must not be streaming/submitting and must have an entry ref.
2. Composer value becomes the grouped message text.
3. New attachments are cleared.
4. `editState` stores target entry id and retained images.
5. Edit banner appears.
6. Composer focuses.
7. Send routes through `replacePrompt`.
8. Runtime rewinds branch and sends a new prompt.
9. On success in same thread, edit mode clears.

### Sending during streaming

Trigger: send while snapshot is streaming.

Chain:

1. Streaming behavior toggle is visible.
2. User chooses `Next`/`Steer` by toggling local state.
3. Send passes `streamingBehavior` only because `isStreaming` is true.
4. Runtime session receives prompt with steering/follow-up semantic.
5. Queue banner can update through runtime `queue_update`.
6. Local streaming behavior resets to `followUp`.

### Opening project dropdown while model dropdown is open

Trigger: add-thread button.

Chain:

1. Project dropdown opens.
2. `hoveredProjectId` initialized.
3. `isModelDropdownOpen` set false.
4. Thread pane positioning effect runs.
5. Hovered project thread fetching starts if not already loaded.

### Opening model dropdown while project dropdown is open

Trigger: model selector button.

Chain:

1. Project dropdown closes.
2. Model dropdown toggles.
3. If opening, model search resets.
4. Outside click handler later closes if click lands outside model dropdown root.

## Guards and Edge Cases

Confirmed guards:

- Empty normal send is ignored.
- `/abort` only special-cases no-arg exact command.
- `/compact` accepts optional instructions.
- Current streaming thread cannot be deleted from the pane.
- User edit disabled while streaming, submitting, or missing entry ref.
- Assistant regenerate disabled while submitting, compacting, or retrying.
- Model selector disabled when no models exist.
- Thread project dropdown resets hovered project when closed.
- Hovered project id is repaired if the project list changes and no longer contains it.
- Store prevents stale thread switch snapshots/events from mutating visible state.
- Thread store prevents duplicate page loads while a project page is already loading.

Blind spots and likely bugs:

1. Retained-image-only edit is supported by parent `handleSend`, but not triggerable from `InputMessage`.
   - Parent allows `!trimmed && !files.length && editState.images.length`.
   - Child `canSend` only checks text or current files, not retained images.
   - Result: editing a message down to only retained images leaves the send button disabled and Enter does nothing.

2. Total image cap does not include retained edit images.
   - New files are capped at 5.
   - Retained images are appended later.
   - A replace can send 5 retained plus 5 new images.

3. Unsupported dragged files are silently ignored before panel validation.
   - `InputMessage` filters by accept before calling `onFilesChange`.
   - The panel toast only sees files that passed the child accept filter.

4. Thread pane "Load more" can remain visible after store pages are exhausted.
   - `hoveredThreadsHasMore` is `hoveredProjectThreadsQuery.data?.hasMore || hoveredThreadPage?.hasMore`.
   - The React Query first-page `hasMore` can stay true while the Zustand paged store has already loaded all pages.
   - Clicking load more may become a no-op but the button can remain.

5. UI request timeout can leave a stale dialog.
   - Runtime timeout resolves pending UI internally but does not emit `ui-response`.
   - Store only clears UI on response or explicit `respondToUiRequest`.

6. Consecutive same-role grouping can make edit targeting ambiguous.
   - A group combines multiple user messages but edit uses the first group's `originalIndex` entry ref while composer text combines all grouped messages.

7. `MessageBody` has a `toolResult` display branch that is unreachable in the current panel list because `allMessages` filters out tool results.

8. Trace deck marks missing tool results as complete after streaming ends.
   - There is no distinct "missing result" or error state when a settled tool call lacks a result.

9. Copy feedback assumes clipboard success.
   - `navigator.clipboard.writeText` is not awaited/caught, so failures still show copied state.

10. Thread recency labels are frozen to panel mount time.
    - `mountTime` is stable, so labels do not naturally age during a long-running app session.

11. Thread pane positioning has no viewport collision handling.
    - The portal always opens to the right of the project list and can go off-screen in narrow layouts.

12. Active tab can point to the requested thread while old messages remain visible.
    - This is intentional optimism, but any measurement system should treat `isSwitchingThread` as an important intermediate state.

13. Model and thinking-level actions have no local pending guard.
    - Rapid repeated clicks can issue concurrent cycle/set requests.

14. Scroll follow key can miss trace/tool-result-only changes.
    - The key uses visible text length; tool-call/result changes that do not change `stringifyMessageContent(lastMessage).length` may not retrigger follow-to-bottom.

15. Snapshot fields `status`, `workingMessage`, `workingVisible`, `hiddenThinkingLabel`, `title`, and `editorText` are maintained but not visibly represented in `AgentPanel`.

## Suggested Behavioral Test Matrix

Minimum scenarios to measure for this component:

- Initial mount with no snapshot, null project, and then snapshot arrival.
- Empty thread vs non-empty thread.
- Thread switch success, slow switch, wrong-thread event during switch, and switch failure.
- Closing active tab with next, previous, one remaining, and no remaining tabs.
- Rename commit success, empty title, unchanged title, backend failure, and Escape cancel.
- Open project dropdown, hover each project, load first page, load more, create thread, delete current streaming thread, delete inactive thread.
- Streaming start with no streaming message, streaming message arrival, trace part arrival, tool result arrival, stream end.
- User scroll near bottom vs far from bottom during streaming.
- User edit with text only, image only, retained images, retained plus new images, edit while runtime becomes busy.
- Slash command keyboard: prefix match, substring match, no match, command list shrink while selected index is high.
- File picker and drag/drop: valid images, unsupported MIME, >10 MiB, duplicate file, more than five images.
- `/abort`, `/compact`, normal send, send while streaming with `Next`, send while streaming with `Steer`.
- Abort during streaming and repeated abort click.
- Model dropdown with empty models, search no results, successful set, failed set, Escape close.
- Thinking level cycling under rapid clicks.
- Context ring unknown usage, low usage, amber threshold, destructive threshold, cost zero/non-zero.
- UI request select, confirm, input submit, input cancel, and timeout.
