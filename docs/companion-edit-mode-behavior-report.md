# Companion View and Edit Mode Behavior Report

## Understanding and Scope

This report maps the behavior of `src/components/companion-view.tsx` and the edit-mode flow it controls. The companion view is not an isolated chat panel. It is the side window for an ephemeral editor agent session, and it coordinates with the main-window `PipperOverlay` through `pipper:*` IPC broadcasts.

The important behavior surface is therefore:

- The companion window lifecycle.
- The editor session lifecycle.
- Pipper edit mode and overlay visibility.
- Component targeting through `[data-pipper-id]`.
- Overlay comment capture and auto-send into the companion editor agent.
- Streaming/editing/completion states.
- Accept/reject side effects.
- Model selection in the companion.
- Cross-window broadcasts and cleanup behavior.

Primary files reviewed:

- `src/components/companion-view.tsx`
- `src/components/pipper-overlay.tsx`
- `src/store/pipper-store.ts`
- `@/components/ui/input-message.tsx`
- `@/components/ui/thinking-indicator.tsx`
- `@/components/ui/pipper-beam.tsx`
- `src/components/ui/switch.tsx`
- `src/App.tsx`
- `electron/main.ts`
- `electron/agent.ts`
- `electron/preload.ts`
- `electron/companion-state.ts`
- `src/electron.d.ts`
- `contracts/agent.ts`

## Mental Model

`CompanionView` is an edit-mode companion window. On mount it activates a separate, in-memory editor agent session and tells the main window to enter Pipper edit mode. The main window overlay lets the user click any element with `data-pipper-id`, write a component-scoped comment, and broadcast that comment to the companion. The companion then sends a prompt formatted as:

```text
[Component: <pipperId>]
<comment>
```

The editor runtime works against the active workspace path. When the editor agent finishes, the main window reloads so generated code changes can show up in the UI. The companion then exposes Accept and Reject. Accept commits the workspace changes and updates `patch.md`; Reject restores the backup and reloads the main window.

This means behavior is split across two windows:

- Companion window: chat, model choice, accept/reject, overlay toggle.
- Main window: element selection, highlight, comment popup, processing beam, page reloads.

## State Sources and Observable Outputs

### Companion local state

- `inputValue`: controlled text in the companion composer.
- `isModelDropdownOpen`: opens/closes companion model dropdown.
- `modelSearch`: filters companion model rows.
- `isProcessingAccept`: hides streaming message, hides accept/reject actions, disables input, and shows commit status.
- `activePipperIdRef`: set when overlay comment arrives and cleared on manual send or streaming finish, but currently not read for visible behavior.
- `prevStreamingRef`: detects streaming-to-idle transition.

### Editor snapshot fields used by companion

- `messages`: rendered as filtered conversation.
- `streamingMessage`: rendered while streaming unless accept processing is active.
- `isStreaming`: blocks manual send in handler, hides actions, shows thinking indicator, and drives post-stream cleanup.
- `models`: drives companion model selector and dropdown disabled state.
- `model`: drives current model label, provider icon, selected row, and title cost string.

Snapshot fields currently not visibly used:

- `projectId`, `threadId`, `sessionFile`, `sessionId`, `sessionName`, `cwd`.
- `thinkingLevel`.
- `isCompacting`, `isRetrying`.
- `autoCompactionEnabled`, `autoRetryEnabled`.
- `messageEntryRefs`.
- `queue`.
- `commands`.
- `stats`.
- `status`, `workingMessage`, `workingVisible`, `hiddenThinkingLabel`.
- `title`, `editorText`.

### Pipper store state

- `editMode`: controls whether `PipperOverlay` renders in the main window.
- `overlayVisible`: controls whether overlay is active and drives the companion switch.
- `processingId`: controls overlay beaming and `PipperBeam` highlights.
- `pendingComment`: exists in store but is not used by companion or overlay behavior.

### Electron/runtime state

- `companionWindow`: singleton companion BrowserWindow.
- Persisted companion bounds in `companion-state.json`.
- `editorRecord`: in-memory AgentManager project runtime for visual editor.
- `editorPendingMutation`: analytics record for companion/editor mutation duration.
- Active workspace path from `getActivePath()`.
- Active project id from `getActiveProjectId()`.

## Component Behavior Map

### 1. Companion window entry

Entry point:

- `App` checks `?stage=companion`.
- If matched, it renders `CompanionView` instead of the main app shell.

Window creation:

- Clicking "Open Companion" in the main app calls `window.omni.companion.open()`.
- Main process creates or focuses a singleton companion window.
- Window size defaults to `400 x 640`, with minimum `320 x 480`.
- Saved bounds are restored from `companion-state.json`.
- Companion is parented to the main window when available.
- Bounds are persisted on move and resize.
- Closing companion calls `endCompanionSession()`.

Open side effect:

- `companion:open` also activates the currently active project in the normal agent manager if an active project id exists.

Close side effects:

- `companion:close` calls `endCompanionSession()` and closes the window.
- Window `closed` event also calls `endCompanionSession()`.
- `endCompanionSession()` broadcasts `editMode: false` and `processingId: null`.
- It also disposes the editor session through `AgentManager.disposeEditor()`.

### 2. Editor session hook

Hook: `useEditorSession()`.

Activation behavior:

- On mount, subscribes to `window.omni.editor.onEvent`.
- It only handles `payload.type === "snapshot"`; other editor bridge events are ignored.
- Calls `window.omni.editor.activate()`.
- Fetches initial state through `window.omni.editor.getState()`.
- Stores snapshot and sets `isActivated` true.

Cleanup behavior:

- Unsubscribes editor events.
- Calls `window.omni.editor.dispose()`.
- Calls `window.omni.pipper.exitEditMode()`.
- Calls `window.omni.pipper.setProcessing(null)`.

Send behavior:

- `sendPrompt(message)` ignores empty trimmed messages.
- Otherwise calls `window.omni.editor.sendPrompt({ message })`.

Runtime details:

- `editor:activate` creates an in-memory synthetic project named `Omni Editor`.
- The editor project path is the active workspace path.
- Editor events are sent to the companion over `editor:event`.
- On editor `agent_end`, runtime completes analytics and reloads the main window.
- A settled editor snapshot is pushed on the next tick after `agent_end`.

### 3. Companion mount effects

On mount:

- Calls `window.omni.pipper.enterEditMode()`.
- Focuses the companion composer after 120ms.

Broadcast sync:

- Subscribes to `pipper:onStateChanged`.
- Applies payload to `usePipperStore.syncFromBroadcast`.

Overlay comment subscription:

- Subscribes to `pipper:onCommentAdded`.
- When a comment arrives:
  - Sets `activePipperIdRef.current` to the target id.
  - Sends an editor prompt with `[Component: id]` annotation.

Streaming-finish cleanup:

- Tracks previous streaming state.
- When previous state was streaming and current state is not:
  - Calls `pipper:setProcessing(null)`.
  - If `overlayVisible` is true, calls `pipper:enterEditMode()` again.
  - Clears `activePipperIdRef.current`.

Scroll behavior:

- On `snapshot.messages` or `snapshot.streamingMessage` change, scrolls the bottom ref into view with smooth behavior.

Model dropdown outside click:

- When model dropdown is open, document `mousedown` closes it if target is outside `modelDropdownRef`.

### 4. Companion empty state

Condition:

- `isEmpty` is true when there are no visible active messages and no visible streaming message.

Behavior:

- Renders `AmbientPixelField`.
- Message area shows centered "Edit Mode".
- Pointer events are disabled for the empty message content.

Empty-state input:

- Composer is still present and focused.
- Placeholder is `start here` unless accept processing is active.

### 5. Companion title bar and overlay switch

Element:

- Header with drag region.
- `Switch` labeled `Overlay`.

Behavior:

- Switch checked state is `overlayVisible`.
- Toggle calls `setOverlayVisible(!overlayVisible)` from Pipper store.
- Pipper store calls `window.omni.pipper.setOverlayVisible(visible)` and then updates local state.
- Main process broadcasts `{ overlayVisible }` to all windows.

Switch internal behavior:

- Pointer hover changes track/thumb styling.
- Pointer drag has a 2px dead zone.
- Dragging past midpoint toggles checked state.
- Click toggles unless a drag already did.
- Base UI switch also triggers `onToggle`, guarded by `didDrag`.

Overlay-visible reaction:

- Main-window overlay unmounts when `overlayVisible` false.
- Companion remains open when overlay is hidden.
- Hiding overlay clears main-window highlight, popup, comment text, and escape armed state.

### 6. Companion message list

Active message filtering:

- Starts from `snapshot.messages`.
- Keeps only user and assistant messages.
- Removes internal commit prompts that include:
  - `Commit all completed changes to Git with a clear, descriptive commit message`

Message keys:

- Uses `message.id` or `toolCallId` if available.
- Falls back to `role-index`.

User message parsing:

- If text matches:

```text
[Component: <componentId>]
<text>
```

- Companion displays a small uppercase component id chip.
- It hides the annotation prefix and only shows annotation body as the user text.
- Non-annotated user messages show full text.

Assistant messages:

- Render through `Streamdown` in static mode.
- Empty text messages are skipped.

Streaming message:

- If `isStreaming` and `!isProcessingAccept`, companion renders `snapshot.streamingMessage`.
- Streaming text is rendered through `Streamdown` in streaming mode.

Thinking indicator:

- If streaming but no visible streaming message and not accept-processing, shows `ThinkingIndicator`.

Notably absent:

- There is no virtualization in companion.
- There are no per-message copy/edit/regenerate actions.
- Tool call traces are not rendered as a trace deck.
- Tool result messages are filtered out.
- Queue/state/status messages are not rendered.

### 7. Companion composer

Component:

- Shared `InputMessage`.

Controlled props:

- `value=inputValue`.
- `onValueChange=setInputValue`.
- `onSend=handleSend`.
- Placeholder is `Committing...` when accepting, otherwise `start here`.
- Disabled only when `isProcessingAccept` is true.
- No `isStreaming` prop is passed, so it does not morph into a stop button during editor streaming.
- No files props are passed, so file attach and drag/drop behavior are disabled.

Manual send behavior:

- Trims text.
- If empty, streaming, or accept processing, returns without side effects.
- Otherwise:
  - Clears input.
  - Clears `activePipperIdRef`.
  - Calls `pipper:setProcessing(null)`.
  - Sends prompt as raw text.

Observable mismatch:

- While editor is streaming, the composer is not visually disabled and the send button can appear enabled if text exists.
- Clicking send during streaming invokes `handleSend`, which returns without sending. This is a silent no-op.

### 8. Companion model selector

Button behavior:

- Renders inside composer right slot.
- Disabled when `models.length === 0`.
- Shows provider mark when selected model provider exists.
- Shows current model name or `No model`.
- Tooltip/title includes model name and formatted cost when model exists.
- Click toggles dropdown.

Dropdown behavior:

- Renders above the composer at bottom-right.
- Search input auto-focuses.
- Escape inside search closes dropdown.
- Outside click closes dropdown.
- Search filters by model name, model id, or formatted provider name.
- Rows show provider icon, model name, provider name, formatted cost, and selected check.
- Clicking a row calls `window.omni.editor.setModel`.
- On success, closes dropdown and clears search.
- On failure, dropdown stays open.
- Empty filtered list shows `No matching models`.

Cost formatting:

- If no cost or non-finite cost values, label is `Cost unavailable`.
- Input/output prices are shown as `$x/M in` and `$y/M out`.
- Values >= 1 use two decimals; values below 1 use three decimals.

### 9. Accept and reject action area

Visibility:

- Action bar renders only when `activeMessages.length > 0`, not streaming, and not processing accept.

Reject:

- Calls `window.omni.pipper.rejectChanges()`.
- Logs errors but does not stop the close sequence.
- Calls `pipper:exitEditMode`.
- Calls `companion:close`.

Reject runtime side effects:

- Restores workspace from backup.
- Reloads main window.
- Captures `mutation_rejected`.
- Captures `rollback_executed` success/failure.

Accept:

- Sets `isProcessingAccept` true.
- Calls `pipper:acceptChanges("Accepted visual customization")`.
- On success:
  - Calls `pipper:exitEditMode`.
  - Calls `companion:close`.
- On failure:
  - Logs error.
  - Keeps companion open.
  - Resets `isProcessingAccept` false.

Accept runtime side effects:

- Runs `git status --porcelain` in active workspace.
- Builds `filesChanged` excluding `patch.md`.
- If no changed files exist, returns with no commit.
- Prepends a JSON entry to `patch.md` with:
  - `change_id`
  - `files_changed`
  - `intent`
- Runs `git add -A && git commit -m 'Pipper Visual Edit Accept'`.
- Reads `git rev-parse HEAD`.
- Updates installation metadata:
  - `customized_head_commit`
  - `last_healthy_at`
- Backs up active workspace.
- Captures `mutation_accepted`.
- On error, captures `mutation_completed` with outcome error and throws.

Processing UI:

- While `isProcessingAccept`, action bar is hidden.
- Composer is disabled.
- A status row shows:
  - `Committing changes & updating patch.md...`
- Streaming message is suppressed during accept processing.

### 10. Main-window Pipper overlay

Render condition:

- `editMode && overlayVisible`.

Capture layer:

- Fixed full-screen layer at z-index 9990.
- Cursor is `crosshair` normally and `wait` while processing id exists.
- Captures mouse move, click, and mouse leave.

Target resolution:

- Temporarily sets overlay pointer-events to none.
- Calls `document.elementFromPoint(x, y)`.
- Uses closest ancestor with `[data-pipper-id]`.
- Reads `data-pipper-id` as the target id.

Hover behavior:

- If popup is open or a processing beam exists, hover does nothing.
- Otherwise, moving over a pipper element sets highlight rect from `getBoundingClientRect()`.
- Moving off target clears highlight.
- Mouse leaving overlay clears highlight unless popup/beaming.

Click behavior:

- If popup is open or beaming, click does nothing.
- Otherwise, clicking a target:
  - Locks highlight to clicked element.
  - Opens comment popup.
  - Positions popup below element, clamped to bottom and horizontal window bounds.
  - Clears previous comment text.
  - Captures `component_mutation_requested` analytics with source `overlay`.

Comment popup:

- Renders at z-index 9992.
- Uses `InputMessage` with min 1 row and max 4 rows.
- Left slot shows `@ <pipperId>`.
- Submitting empty text does nothing.
- Submitting non-empty text:
  - Calls `pipper:setProcessing(pipperId)`.
  - Calls `pipper:addComment(pipperId, trimmedText)`.
  - Closes popup.
  - Clears comment text.
  - Keeps highlight locked to the clicked element.

Processing highlight:

- When `processingId` exists, overlay uses a line `BorderBeam`.
- Shows label `Editing <id>...`.
- Cursor changes to wait.
- Hover/click targeting is blocked.

Escape behavior:

- If popup is open, first Escape closes popup and clears comment text.
- If no popup:
  - First Escape arms an exit timer for 1500ms.
  - Second Escape before timer expires:
    - Clears highlight.
    - Calls store `exitEditMode()`.
    - Calls `pipper:setProcessing(null)`.
    - Calls `companion:close`.
- If second Escape does not happen in time, armed state resets.

Unmount/visibility cleanup:

- When edit mode exits or overlay is hidden:
  - Clears highlight.
  - Clears popup.
  - Clears comment text.
  - Clears escape armed state.
  - Clears escape timer.

### 11. Pipper store and PipperBeam

Pipper store:

- `enterEditMode()` calls IPC then sets local `editMode: true` and `overlayVisible: true`.
- `exitEditMode()` calls IPC then sets local `editMode: false` and `processingId: null`.
- `setOverlayVisible()` calls IPC then sets local visibility.
- `syncFromBroadcast()` merges any defined `processingId`, `editMode`, and `overlayVisible` fields.

Broadcast behavior:

- Main process broadcasts pipper state to main, companion, and launch windows.
- The companion and main app both listen and sync to the same store shape.

PipperBeam:

- Components can wrap themselves with `PipperBeam(pipperId)`.
- If `processingId === pipperId`, it draws an inner `BorderBeam`.
- If no `pipperId`, children render unchanged.
- It also adds `data-pipper-id` to the wrapper.

## Cross-Component Reaction Chains

### Opening edit mode

1. User clicks Open Companion in main app.
2. Main process creates/focuses companion window.
3. Main process activates current project runtime.
4. Companion route renders `CompanionView`.
5. `useEditorSession` subscribes to editor events and activates in-memory editor runtime.
6. Companion mount effect calls `pipper:enterEditMode`.
7. Main process broadcasts `{ editMode: true, overlayVisible: true }`.
8. Main app `PipperOverlay` renders and starts capturing targets.
9. Companion overlay switch is checked.

### Overlay component comment

1. User hovers a `[data-pipper-id]` element in main window.
2. Overlay computes highlight rect.
3. User clicks target.
4. Popup opens at clamped location.
5. Analytics records component mutation requested.
6. User writes comment and sends.
7. Overlay calls `pipper:setProcessing(pipperId)`.
8. Main process broadcasts processing id.
9. Overlay switches to beaming/wait state.
10. Overlay calls `pipper:addComment`.
11. Main process broadcasts comment.
12. Companion receives comment and auto-sends `[Component: id]\ntext`.
13. Editor runtime starts mutation analytics and prompts.
14. Companion renders annotated user message with component chip.
15. Streaming assistant response appears.
16. Editor `agent_end` reloads main window.
17. Companion detects streaming finished and clears processing id.
18. If overlay is still visible, companion re-enters edit mode.

### Manual companion prompt

1. User types directly in companion composer.
2. Send is accepted only if text is non-empty, not streaming, and not accepting.
3. Companion clears input and processing id.
4. Sends raw prompt to editor runtime.
5. Runtime analytics source is `companion_prompt`.
6. Response streams in companion.
7. On `agent_end`, main window reloads.
8. Accept/reject bar appears after streaming completes.

### Accepting changes

1. Action bar visible after at least one active message and no streaming.
2. User clicks Accept.
3. Companion enters accept-processing state.
4. Main process writes/updates `patch.md`.
5. Main process commits all changed files.
6. Installation metadata is updated.
7. Workspace backup is refreshed.
8. Companion exits edit mode and closes.
9. Closing companion disposes editor and broadcasts edit mode false/processing null again.

### Rejecting changes

1. User clicks Reject.
2. Main process restores workspace backup and reloads main window.
3. Companion exits edit mode.
4. Companion closes.
5. Closing companion disposes editor and clears processing state.

## Guards and Edge Cases

Confirmed guards:

- Editor activation fails during update busy state.
- Pipper enter edit mode fails during update busy state.
- Manual companion send ignores empty text.
- Manual companion send ignores attempts during streaming.
- Manual companion send ignores attempts during accept processing.
- Overlay cannot open a new popup while a popup is open.
- Overlay cannot target while processing id exists.
- Overlay comment submit ignores empty text.
- Companion model selector disables when model list is empty.
- Model dropdown closes on outside click and Escape in search.
- Accept action hides while streaming.
- Reject action hides while streaming.
- Actions hide during accept processing.
- Companion cleanup exits edit mode and clears processing.

Blind spots and likely bugs:

1. Companion send is a silent no-op during streaming.
   - The composer is not disabled while `isStreaming`.
   - `InputMessage` is not given `isStreaming`, so it still shows a send button rather than stop.
   - `handleSend` returns early when streaming, with no visual explanation.

2. Editor bridge events other than snapshots are ignored by `useEditorSession`.
   - Notifications, status, working-message, working-visible, title, and editor-text events are emitted by the runtime.
   - Companion does not display or toast them.

3. `isActivated` is set by `useEditorSession` but never used.
   - There is no explicit activating/loading state.
   - If activation fails, the companion can stay in edit UI with no snapshot.

4. `activePipperIdRef` is written but not used for behavior.
   - It is set on overlay comment and cleared later.
   - It does not drive highlight, actions, labels, or send routing.

5. Reject closes even when rollback fails.
   - `handleReject` catches/logs `rejectChanges` errors, then exits edit mode and closes anyway.
   - User may lose visibility into a failed restore.

6. Accept with no changed files closes as success.
   - `acceptChanges` returns early when no changed files exist.
   - Companion still exits edit mode and closes.
   - No user-facing "nothing changed" state.

7. Accept commit command stages everything.
   - Runtime runs `git add -A && git commit`.
   - This can include unrelated dirty files in the active workspace.

8. Accept excludes `patch.md` from `files_changed`, but still commits it.
   - The `files_changed` JSON omits `patch.md`.
   - `git add -A` includes `patch.md` in the commit.

9. Overlay highlight geometry can become stale.
   - Popup/beaming highlight uses the rect captured at click time.
   - It does not update on scroll, resize, layout shift, or main-window reload.

10. Overlay target selection can select broad ancestors.
    - It uses closest `[data-pipper-id]`.
    - If nested pipper ids are missing or wrappers are broad, user may annotate a larger region than intended.

11. Overlay hidden state leaves edit mode true.
    - Toggling Overlay off only sets `overlayVisible: false`.
    - Edit mode remains true, and companion remains in edit flow.

12. Pipper store optimistic local updates can briefly diverge from broadcast.
    - Store methods set local state after IPC resolves.
    - Broadcast from main process also updates all windows.
    - Failures are not surfaced in UI.

13. `pendingComment` exists but is unused.
    - No current flow stores or displays a pending unsent comment.

14. Companion message list has no virtualization.
    - Long editor sessions can grow DOM/render cost.

15. Internal commit prompt filter is substring-based.
    - A normal user prompt containing the commit instruction text would be hidden.

16. Component annotation parsing is strict.
    - It only recognizes annotation at the very start with exactly `[Component: ...]\n`.
    - Extra whitespace or alternate line endings may fail to parse.

17. Editor has no abort/stop control.
    - The editor runtime supports abort via extension binding, but companion UI does not expose stop.

18. Model selection has no pending guard.
    - Rapid repeated model clicks can call `editor:setModel` concurrently.

19. Overlay comment popup does not show send failure.
    - If `addComment` fails, it logs an error.
    - Popup still closes and highlight remains locked after `setProcessing`.

20. Theme sync affects companion but is not visible in CompanionView code.
    - ThemeProvider reads current main theme when `stage=companion`.
    - Companion receives theme changes through broadcast.

## Suggested Behavioral Test Matrix

Minimum scenarios to measure:

- Open companion with active project and without active project.
- Open companion while update is busy.
- Close companion through window close, companion close IPC, Accept, Reject, and Escape double-tap.
- Toggle overlay on/off while empty, while popup open, and while processing.
- Hover selectable/non-selectable regions in main window.
- Click nested `data-pipper-id` targets.
- Submit overlay comment with empty text and non-empty text.
- `pipper:setProcessing` succeeds but `pipper:addComment` fails.
- Main window reloads while overlay highlight is locked.
- Editor prompt from overlay comment, including annotation rendering.
- Manual companion prompt with no annotation.
- Attempt manual send while streaming.
- Editor streaming with no streamingMessage, then with streamingMessage, then completion.
- Editor activation failure.
- Editor notification/status events.
- Model dropdown: empty model list, search no match, set success, set failure, rapid clicks.
- Accept with no changed files.
- Accept with changed files only from agent.
- Accept with unrelated dirty files already present.
- Accept commit failure.
- Reject success.
- Reject restore failure.
- Bounds persistence across companion close/reopen.

