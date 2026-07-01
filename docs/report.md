# Blind Spots Investigation Report

**Date:** 2026-06-26  
**Scope:** Companion edit mode, Pipper overlay, agent panel, runtime/stores, terminal, update flow, and Electron shell

Open and partially-addressed blind spots verified against the current codebase. Initial pass covered companion and agent panel; a second pass searched `electron/`, `src/store/`, `src/App.tsx`, `src/lib/thread-queries.ts`, and terminal components for similar failure modes.

For each item: **status**, **what the code actually does**, **user-visible impact**, and **recommended direction** if we choose to fix it.

---

## Summary

| Area                      | Open | Partially addressed |
| ------------------------- | ---- | ------------------- |
| Companion / overlay       | 12   | 1                   |
| Agent panel               | 8    | 4                   |
| Runtime / stores / IPC    | 10   | 1                   |
| Terminal                  | 2    | 0                   |
| Electron shell / security | 2    | 0                   |

---

## Companion and edit mode

### 1. `isActivated` set but never used; no activation loading state

**Status:** **Confirmed**

**Code:** `useEditorSession` sets `isActivated` after `editor.activate()` + `getState()`, but `CompanionView` destructures only `{ snapshot, sendPrompt, abort }`.

**Failure path:** Activation errors are `console.error` only. The UI still mounts edit mode (via separate effect calling `pipper.enterEditMode`), shows empty “Edit Mode” state, and enables the composer with no snapshot-backed model list.

**Impact:** User can interact with a broken editor session with no loading spinner or error banner.

**Recommendation:** Use `isActivated` (or explicit `activationError` / `isActivating`) to gate the composer and show a retry surface.

---

### 2. `activePipperIdRef` written but not used for behavior

**Status:** **Confirmed**

**Writers:**

- Set on `pipper:onCommentAdded`.
- Cleared on manual send and when streaming finishes.

**Readers:** None. Highlight/beam is driven by `processingId` in the pipper store (main window overlay), not this ref.

**Impact:** Dead state; misleading for future contributors who might assume it routes overlay ↔ companion targeting.

**Recommendation:** Remove the ref or wire it to companion UI (e.g. “Editing `@button-id`” chip, or re-send annotation on manual follow-up).

---

### 3. Accept with no changed files closes as success

**Status:** **Confirmed**

**Runtime (`electron/main.ts`):** `acceptChanges` returns early when `filesChanged.length === 0` — no throw, no user message.

**Companion:** `handleAccept` always calls `exitEditMode` and `companion.close` after awaited `acceptChanges`, regardless of whether anything was committed.

**Impact:** User clicks Accept, companion closes, but git workspace may be unchanged. No “nothing to commit” feedback.

**Recommendation:** Return a structured result from `acceptChanges` (e.g. `{ committed: boolean, filesChanged: string[] }`) and branch companion UI accordingly.

---

### 4. Accept excludes `patch.md` from `files_changed` but still commits it

**Status:** **Confirmed** (by design, but easy to misread)

**Code:** `files_changed` JSON omits `patch.md` via `isPatchMetadataFile` filter. `filesToCommit` explicitly adds `"patch.md"` for staging/commit.

**Impact:** Audit trail in `patch.md` understates what was committed; metadata file is still in the git commit.

**Recommendation:** Either include `patch.md` in `files_changed` with a `metadata: true` flag, or document that `files_changed` is “application files only.”

---

### 5. Overlay highlight geometry can become stale

**Status:** **Partially addressed**

**Current `src/components/pipper-overlay.tsx`:** When popup is open or `processingId` is set, a `requestAnimationFrame` loop re-queries `getPipperElementById(lockedPipperId)`, updates highlight rect, and repositions the popup via `getPopupPosition`.

**Still stale when:**

- Target element is removed from DOM (highlight cleared only when element missing).
- **Hover** highlight (pre-click) still uses instantaneous `getBoundingClientRect` on mousemove — fine for hover, not locked.
- Main window **full reload** during beam: element may not exist until reload completes; brief wrong/missing highlight possible.

**Recommendation:** Keep rAF loop; add reload listener or clear `processingId` on `webContents` reload start if mismatches are observed in testing.

---

### 6. Overlay target selection can select broad ancestors

**Status:** **Confirmed**

**Code:** `elementFromPoint` → `closest("[data-pipper-id]")`.

**Risk factors:**

- Missing `data-pipper-id` on inner interactive elements causes selection of wrapper parents.
- Broad wrappers (layout containers) annotated with pipper ids dominate hit targets.
- No z-index / area heuristic to prefer smallest qualifying target.

**Recommendation:** Prefer smallest bounding rect among chain of `[data-pipper-id]` ancestors, or require ids on leaf interactive nodes per `AGENT.md` convention.

---

### 7. Overlay hidden leaves `editMode` true

**Status:** **Confirmed** (intentional but confusing)

**Code:** `setOverlayVisible(false)` only broadcasts `{ overlayVisible: false }`. `pipper:enterEditMode` sets both `editMode: true` and `overlayVisible: true`, but hiding overlay does not call `exitEditMode`.

**Companion:** Stays in edit flow; accept/reject still available; overlay switch unchecked.

**Main window:** `PipperOverlay` unmounts when `!overlayVisible`, clearing popup/highlight local state.

**Impact:** User may think they “left” overlay mode while companion still shows Accept/Reject and editor session remains active.

**Recommendation:** UX copy on the switch (“Hide overlay” vs “Exit edit mode”); or optionally couple overlay off with a softer “pause targeting” vs full exit.

---

### 8. Pipper store optimistic local updates can diverge from broadcast

**Status:** **Confirmed**

**Pattern:** Store methods `await` IPC then `set` local state. Main process **also** broadcasts `pipper:stateChanged` to all windows, which call `syncFromBroadcast`.

**Ordering:** Depending on timing, a window may briefly show stale state or double-apply. IPC failures in `enterEditMode` / `setOverlayVisible` throw before local `set`, but there is **no user-facing error** in companion or main app.

**`syncFromBroadcast`:** Only merges `processingId`, `editMode`, `overlayVisible` — not `pendingComment`.

**Recommendation:** Treat broadcast as source of truth (optimistic update only after broadcast echo), or surface IPC errors via toast.

---

### 9. `pendingComment` exists but is unused

**Status:** **Confirmed**

**Code:** `pipper-store.ts` defines `pendingComment` and `setPendingComment`; no reads in companion, overlay, or main app source.

**Impact:** Dead API surface; suggests an unfinished “draft comment before send” flow.

**Recommendation:** Remove or implement (e.g. persist popup draft across accidental dismiss).

---

### 10. Companion message list has no virtualization

**Status:** **Confirmed**

**Code:** Simple `.map` over `activeMessages` in a scrollable `flex-col` container. No `@tanstack/react-virtual` (contrast with `AgentPanel`).

**Impact:** Long visual-edit sessions with many round-trips increase DOM size and scroll cost.

**Recommendation:** Low priority unless sessions routinely exceed ~50 messages; then port agent panel virtualizer pattern.

---

### 11. Internal commit prompt filter is substring-based

**Status:** **Confirmed**

**Code:** `isInternalCommitPrompt` hides user messages whose stringified content **includes** the exact commit-instruction substring.

**Impact:** Legitimate user message containing that phrase would be hidden from companion history.

**Recommendation:** Tag internal prompts with a machine-readable prefix or metadata flag at send time instead of substring filtering.

---

### 12. Component annotation parsing is strict

**Status:** **Confirmed**

**Code:** `parseComponentAnnotation` requires `^\[Component:\s*(.+?)\]\n([\s\S]+)$` at the **start** of the body.

**Fails for:** Leading whitespace, `\r\n` line endings, extra blank lines before annotation, lowercase variant, missing newline after bracket line.

**Impact:** Overlay sends correct format today; manual paste or future clients may not get the component chip UI.

**Recommendation:** Trim/normalize line endings before match; or parse annotation as a structured message field in IPC.

---

### 13. Model selection has no pending guard

**Status:** **Confirmed**

**Code:** `handleSelectModel` calls `editor.setModel` on every click with no in-flight lock.

**Impact:** Rapid clicks can issue concurrent model changes; last success wins; dropdown may close on first success while later requests still run.

**Recommendation:** Disable model rows while `isSettingModel` promise is pending (same pattern as `isStopping`).

---

### 14. Overlay comment popup does not show send failure

**Status:** **Confirmed**

**Code (`pipper-overlay.tsx` onSend):**

1. `setProcessing` errors swallowed (`catch { /* noop */ }`).
2. `addComment` errors logged only.
3. Popup **always** closes; highlight locked to stale `elementRect` from popup state.

**Impact:** User sees beam/processing state but companion may never receive the comment; no toast.

**Recommendation:** On `addComment` failure: keep popup open, clear `processingId`, toast error. Do not call `setProcessing` before confirmed `addComment` success, or roll back processing on failure.

---

### 15. `editorText` stored on snapshot but not rendered

**Status:** **Confirmed**

**Code:** `applyEditorBridgeEvent` patches `editorText` from `editor-text` bridge events into the companion snapshot, but `getEditorStatusItems` and the message list do not display it.

**Impact:** Runtime may maintain editor draft text invisible to the user.

**Recommendation:** Surface in a collapsible draft area, or stop patching if unused.

---

## Agent panel

### 16. Total image cap edge cases with retained edit images

**Status:** **Partially addressed**

**Mitigations in place:**

- `maxFiles={Math.max(0, MAX_AGENT_IMAGES - (editState?.images.length ?? 0))}` caps **new** attachments.
- `partitionValidImageFiles(files, editState?.images.length ?? 0)` counts retained toward limit when validating.
- `handleSend` rejects if `retained + newImages > MAX_AGENT_IMAGES` with toast.

**Remaining edge:** Race or manual store manipulation could theoretically bypass UI caps; runtime does not enforce image count server-side in this review.

**Recommendation:** Consider single validation path in `handleSend` only (already mostly there).

---

### 17. Unsupported dragged files silently ignored before panel validation

**Status:** **Confirmed**

**Code:** `InputMessage.addFiles` skips files failing `matchesAccept` with `continue` — no callback for rejects. Parent `handleFilesChange` / `partitionValidImageFiles` only sees accepted files.

**Impact:** Dragging PDFs or HEIC images produces no toast (picker path same).

**Recommendation:** Optional `onFilesRejected` callback from `InputMessage`, or pass rejected list to parent for toast.

---

### 18. Thread pane “Load more” edge cases

**Status:** **Partially addressed**

**Current logic:**

```1133:1135:src/components/agent-panel.tsx
const hoveredThreadsHasMore = hoveredThreadPage
  ? hoveredThreadPage.hasMore
  : Boolean(hoveredProjectThreadsQuery.data?.hasMore);
```

When Zustand page state exists, React Query’s stale `hasMore` is ignored.

**Remaining edges:**

- Before first `loadProjectThreads`, button visibility follows React Query first page only.
- On load **failure**, `thread-store` sets `hasMore: true` (retry-friendly) but button can enable repeated no-ops if `shouldLoad` is false while `isLoading` stuck false.
- `loadProjectThreads` no-ops when `!shouldLoad` without user feedback.

**Recommendation:** Toast on load failure; set `hasMore` false only when API returns `hasMore: false`, not on error.

---

### 19. UI request dialog can stay stale during thread switch

**Status:** **Partially addressed**

**Runtime (`electron/agent.ts`):** Timeout emits `ui-response` and resolves the pending promise. Agent panel also calls `respondToUiRequest` client-side after `timeoutMs + 250`.

**Remaining bug:** While `pendingThreadTarget` is set, `applyBridgeEvent` **drops all non-snapshot events**, including `ui-response`:

```68:70:src/store/agent-store.ts
if (pendingThreadTarget && payload.type !== "snapshot") {
  return { ...state, events };
}
```

**Impact:** If a UI request is open during thread switch, timeout/response may be ignored and dialog can remain until manual dismiss.

**Recommendation:** Always apply `ui-request` / `ui-response` regardless of pending thread target.

---

### 20. Consecutive same-role grouping makes edit targeting ambiguous

**Status:** **Confirmed**

**Code:** `GroupedMessageEntry` stores `originalIndex` from the **first** message in a consecutive same-role run. Edit uses `messageEntryRefs[originalIndex]` but composer text is **joined** from all messages in the group (`bodyText`).

**Impact:** Editing a merged user group replaces only the first user entry’s branch position while showing combined text — likely wrong target for multi-message groups.

**Recommendation:** Disable edit when `messages.length > 1` in group, or split groups for edit/regenerate actions.

---

### 21. `MessageBody` `toolResult` branch unreachable from panel list

**Status:** **Confirmed**

**Code:** `allMessages` filters to `user` | `assistant` only. `MessageBody` `toolResult` branch exists but groups never have `role === "toolResult"`.

**Note:** Tool results are consumed inside `AssistantTraceDeck` via `activeMessages` (unfiltered `snapshot.messages`).

**Recommendation:** Remove dead branch or route tool-only messages through a debug view.

---

### 22. Trace deck marks missing tool results as complete after streaming ends

**Status:** **Confirmed**

**Code (`assistant-trace-deck.tsx`):**

```250:255:@/components/ui/assistant-trace-deck.tsx
let status: "active" | "complete" | "pending" = "complete";
if (isPartStreaming) status = "active";
else if (!resultMsg && !isStreaming) status = "complete";
```

When streaming ends and `resultMsg` is absent, status stays **`complete`**, not error/pending.

**Impact:** Failed or dropped tool results look successful in the trace UI.

**Recommendation:** Add `"error"` or `"missing"` status when `!isStreaming && !resultMsg`.

---

### 23. Copy feedback assumes clipboard success

**Status:** **Confirmed**

**Code:** `navigator.clipboard.writeText(text)` is not awaited; checkmark shows unconditionally.

**Impact:** Denied clipboard permissions still show “copied” for 2 seconds.

**Recommendation:** `await` + try/catch; only set `copiedMessageId` on success.

---

### 24. Thread recency labels frozen to panel mount time

**Status:** **Confirmed**

**Code:** `const [mountTime] = useState(() => Date.now())` used for “Recently opened” / “N days ago” in thread pane.

**Impact:** Labels do not age during a long-lived app session without remounting `AgentPanel`.

**Recommendation:** Use `Date.now()` at render time with memoized per-thread computed labels, or refresh on interval / focus.

---

### 25. Thread pane positioning has no viewport collision handling

**Status:** **Confirmed**

**Code:** Fixed position at `projectListRef.right + 8px`, top aligned to list. No check against `window.innerWidth` / `innerHeight`.

**Impact:** Narrow viewports or right-aligned layouts can clip the pane off-screen.

**Recommendation:** Flip pane to left of dropdown or clamp max-width/left offset.

---

### 26. Active tab can point to requested thread while old messages remain visible

**Status:** **Confirmed intentional**

**Code:** `isSwitchingThread = activeTabId && activeTabId !== snapshotThreadId`; composer disabled; `aria-busy` on scroll region; messages not cleared until matching snapshot arrives.

**Impact:** Correct optimistic UX; any telemetry measuring “current thread content” must key off `isSwitchingThread`.

**Recommendation:** Document for analytics/tests only.

---

### 27. Model and thinking-level actions have no local pending guard

**Status:** **Confirmed**

**Code:** `cycleThinkingLevel()` and `setModel()` invoked directly on click without disabling buttons during IPC.

**Impact:** Concurrent requests; ambiguous final model/level if responses reorder.

**Recommendation:** Shared `isRuntimeActionPending` guard on footer controls.

---

### 28. Scroll follow key can miss trace/tool-result-only changes

**Status:** **Confirmed**

**Code:** `latestConversationScrollKey` includes `stringifyMessageContent(lastMessage).length` but not tool-call ids, thinking parts, or trace structure.

**Impact:** During streaming, trace deck can expand without triggering follow-to-bottom if visible text length unchanged.

**Recommendation:** Add hash of trace part count, last tool call id, or `streamingMessage` content array length.

---

### 29. `editorText` not rendered in agent panel

**Status:** **Partially addressed**

**Now rendered** via `getRuntimeStatusItems` in stats bar: `title` (if ≠ session name), `workingMessage`, `status` map, `hiddenThinkingLabel`, compacting/retrying, auto-compaction/retry flags.

**Still not rendered:** `editorText` (agent panel composer is separate from snapshot editor text).

**Recommendation:** Clarify whether `editorText` is legacy; remove from snapshot or bind to a read-only debug strip.

---

## Runtime, stores, and IPC

### 30. Agent store `error` is never shown to the user

**Status:** **Confirmed**

**Code:** `agent-store` sets `error` on `connect`, `refresh`, and `switchThread` failure. `AgentPanel` reads `error` only to revert `activeTabId` and clear `requestedThreadId` — no banner, toast, or inline message.

**Impact:** Failed thread switches or connect failures look like a brief tab flicker with no explanation.

**Recommendation:** Render `error` in the panel (dismissible banner above composer) and clear on successful snapshot arrival.

---

### 31. Agent panel `handleSend` has no `catch` — IPC failures are silent

**Status:** **Confirmed**

**Code:** `handleSend` uses `try/finally` with `setIsSubmitting` but no `catch`. `fileToPromptImage`, `sendPrompt`, `replacePrompt`, `abort`, and `compact` rejections propagate uncaught. Input is only cleared on success.

**Impact:** Send, compact, and abort failures feel like a no-op; user may resend duplicates.

**Recommendation:** `catch` with toast; preserve input/attachments on failure (already the default when clear is skipped).

---

### 32. `handleRegenerate` has no error handling

**Status:** **Confirmed**

**Code:** `handleRegenerate` awaits `replacePrompt(...)` with no try/catch or toast.

**Impact:** Regenerate click fails silently.

**Recommendation:** Mirror `handleSend` error surfacing.

---

### 33. `handleCreateThread` can throw; `addThread` skews pagination offset

**Status:** **Confirmed**

**Code:** `handleCreateThread` has no try/catch around `agent-store.createThread` (IPC throw propagates). On success it calls `addThread(thread)`, which increments `pagesByProject[projectId].nextOffset` even though the thread was created out-of-band, not loaded via a page fetch.

**Impact:** Uncaught rejection on create failure; inflated `nextOffset` can cause “Load more” to skip or duplicate threads.

**Recommendation:** try/catch with toast; use `thread-store.createThread` path or bump offset only when inserting into a paged list correctly.

---

### 34. `deletedThreadIds` is written but never read

**Status:** **Confirmed**

**Code:** `thread-store.deleteThread` appends to `deletedThreadIds` with comment “used to close open tabs”. No reads anywhere in the repo. Tab cleanup relies on `invalidateQueries` + `tabs.listOpen()` in `handleDeleteThread`.

**Impact:** Dead state; misleading for contributors; any planned auto-close-on-delete behavior was never wired.

**Recommendation:** Remove field or implement open-tab closure on delete using the set.

---

### 35. `thread-store.error` and `project-store.error` never surface in UI

**Status:** **Confirmed**

**Code:** Both stores set `error` on load failure. No component selects `useThreadStore((s) => s.error)` or `useProjectStore((s) => s.error)`.

**Impact:** Thread/project load failures show empty UI with no retry path.

**Recommendation:** Empty-state error surfaces with retry in agent panel and `App` header.

---

### 36. Thread rename/create failures are console-only

**Status:** **Confirmed**

**Code:** `thread-store.createThread` / `renameThread` catch → `console.error`, return `null`. `commitRenameThread` refocuses input on `false` but shows no message.

**Impact:** Rename/create appears stuck in edit mode with no reason.

**Recommendation:** Toast on failure; exit rename mode with error text.

---

### 37. Header project switch has no renderer error handling; main swallows activation errors

**Status:** **Confirmed**

**Code:** `App.tsx` calls `await window.omni.projects.setActive(project.id)` with no try/catch. In `electron/main.ts`, `projects:setActive` calls `setActiveProjectId` and broadcasts `projects:activeChanged` even when `activateProject` fails (failure is only `console.error`).

**Impact:** UI shows a new active project while agent runtime may still be on the old project or broken.

**Recommendation:** Propagate activation success/failure from IPC; revert active project in renderer on failure; toast.

---

### 38. Closing companion does not reject or warn about uncommitted edits

**Status:** **Confirmed**

**Code:** `companionWindow.on("closed")` and `companion:close` call `endCompanionSession()` → `disposeEditor()` + broadcast `editMode: false`. No `rejectChanges`, no dirty-workspace prompt. Accept/reject only via explicit companion buttons.

**Impact:** User closes companion window (X button or double-Esc); modified workspace files remain with no rollback or confirmation.

**Recommendation:** Prompt if git dirty since edit baseline; optionally auto-reject on close.

---

### 39. Accept with missing edit baseline treats all dirty files as in-scope

**Status:** **Likely**

**Code:** `changedSincePipperEditBaseline` returns `true` when `pipperEditBaseline` is null. Baseline is captured in `editor:activate`, not `pipper:enterEditMode`. If accept runs before baseline capture completes, all current dirty files pass the filter.

**Impact:** Unrelated pre-existing dirty files could be committed on accept.

**Recommendation:** Block accept until baseline is set; surface “not ready” in companion.

---

### 40. `markActiveHealthy` is fire-and-forget; `false` is invisible in UI

**Status:** **Confirmed**

**Code:** `App.tsx` and `launch/app.tsx` call `void window.omni.update.markActiveHealthy(...)`. `UpdateManager.markActiveHealthy` returns `false` on version/phase mismatch and only appends to run log.

**Impact:** Post-update health check can stall in `awaiting-health-check` until timeout/rollback with no in-app explanation.

**Recommendation:** Handle return value; show update dialog error when health check fails.

---

### 41. `tabs:changed` listener can briefly show tabs without thread metadata

**Status:** **Likely**

**Code:** `useOpenTabsQuery` on `tabs:changed` calls `setQueryData` spreading IPC state but keeping `openThreads: current?.openThreads ?? []`, then invalidates. New/closed tab IDs can disagree with cached titles until refetch completes.

**Impact:** Ghost tab labels or missing titles for a frame after tab open/close.

**Recommendation:** Optimistically filter `openThreads` by new `openThreadIds`, or show loading skeleton until refetch.

---

### 42. `agent-store.events` accumulated but never consumed

**Status:** **Confirmed**

**Code:** Every bridge event appended (`slice(-200)`); no component or selector reads `events`.

**Impact:** Dead state; minor memory/CPU on every bridge event.

**Recommendation:** Remove or expose in a debug panel.

---

### 43. `isConnecting` is set but never used in UI

**Status:** **Confirmed**

**Code:** `connect()` toggles `isConnecting`; `AgentPanel` calls `connect()` on mount but never reads the flag.

**Impact:** No loading state while agent bridge connects; composer usable against null snapshot.

**Recommendation:** Disable composer and show connecting indicator while `isConnecting`.

---

### 44. Model `setModel` failure gives no feedback

**Status:** **Confirmed**

**Code:** Agent panel and companion close dropdown only `if (success)` — neither toasts on failure.

**Impact:** User believes model changed when it did not.

**Recommendation:** Toast on `setModel` returning false or throwing.

---

### 45. `companion:open` and `enterEditMode` on mount lack error surfacing

**Status:** **Confirmed**

**Code:** `App.tsx` uses `void window.omni.companion.open()` with no catch. Companion mount uses `void window.omni?.pipper?.enterEditMode?.()` with no catch. Main throws when `isUpdateBusy()`.

**Impact:** Companion opens in broken state during updates; no banner (unlike accept/reject `operationError`).

**Recommendation:** Catch and toast; disable edit UI when enter fails.

---

## Terminal

### 46. Terminal sessions survive project switches with stale `cwd`

**Status:** **Confirmed**

**Code:** `OthersView` calls `createSession(activeProject?.path)` once per new tab. `cwd` is stored on the session object. No effect clears or respawns sessions when `activeProject` changes.

**Impact:** After switching projects, existing terminals keep the old project path (or undefined/home fallback).

**Recommendation:** Clear sessions on project change, or show cwd mismatch warning and offer “open in active project”.

---

### 47. Terminal tab creation is optimistic; PTY failure leaves a zombie tab

**Status:** **Confirmed**

**Code:** `createSession` adds to store immediately. `TerminalInner` shows error on PTY `create` failure but does not call `closeSession`.

**Impact:** Broken terminal tab stays in the tab bar until manual close.

**Recommendation:** Auto-close session on unrecoverable PTY failure, or mark tab as errored in the tab list.

---

## Electron shell and security

### 48. `shell:openExternal` IPC allows arbitrary URLs

**Status:** **Confirmed**

**Code:** `shell:openExternal` resolves `clerk:sign-in` / `clerk:sign-up` aliases, then passes any other non-empty string to `shell.openExternal`.

**Impact:** A compromised renderer could open arbitrary external URLs. Mitigated by `contextIsolation` + preload boundary, but IPC surface is broad.

**Recommendation:** Allowlist hosts/schemes or restrict to known Clerk URLs and documented externals.

---

### 49. All app windows use `sandbox: false`

**Status:** **Confirmed**

**Code:** Main, launch, and companion `webPreferences` set `sandbox: false` (with `contextIsolation: true`).

**Impact:** Broader blast radius if preload/renderer boundary is breached.

**Recommendation:** Evaluate enabling sandbox per window where Node integration is not required.

---

## Cross-cutting findings

### A. Enter vs stop button semantics (`InputMessage`)

During `isStreaming`, the **button** stops (via `onStop`) but **Enter** still calls `handleSend` → parent `onSend`. Both companion and agent panel rely on this for queue/steer behavior. Users who muscle-memorize Enter-to-submit may accidentally queue instead of stop.

### B. `operationError` strip in companion

Companion surfaces accept/reject/send/abort failures in a red status area above the composer. Overlay popup does not use the same toast path.

---

## Prioritized fix backlog (suggested)

| Priority | Item                                                             | Effort |
| -------- | ---------------------------------------------------------------- | ------ |
| P0       | Overlay `addComment` / `setProcessing` failure UX (#14)          | Small  |
| P0       | Accept with zero files still closes (#3)                         | Small  |
| P0       | Companion close without dirty-workspace guard (#38)              | Medium |
| P0       | `handleSend` / `handleRegenerate` silent IPC failures (#31, #32) | Small  |
| P1       | Agent `error` never displayed (#30)                              | Small  |
| P1       | Project switch swallows activation failure (#37)                 | Medium |
| P1       | Activation loading/error state (#1, #43)                         | Small  |
| P1       | UI dialog stale during thread switch (#19)                       | Small  |
| P1       | Trace missing tool result status (#22)                           | Small  |
| P1       | Accept before edit baseline ready (#39)                          | Small  |
| P1       | `shell:openExternal` allowlist (#48)                             | Medium |
| P2       | Edit grouped consecutive user messages (#20)                     | Medium |
| P2       | `handleCreateThread` / pagination offset (#33)                   | Small  |
| P2       | Terminal stale cwd on project switch (#46)                       | Medium |
| P2       | Terminal zombie tab on PTY failure (#47)                         | Small  |
| P2       | `activePipperIdRef` or remove (#2)                               | Small  |
| P2       | Model pending guard + failure toast (#13, #27, #44)              | Small  |
| P2       | Store errors never surfaced (#35, #36)                           | Small  |
| P2       | `deletedThreadIds` dead state (#34)                              | Small  |
| P2       | `markActiveHealthy` invisible failure (#40)                      | Small  |
| P3       | Companion virtualization (#10)                                   | Medium |
| P3       | Thread pane viewport collision (#25)                             | Small  |
| P3       | Mount-time recency labels (#24)                                  | Small  |
| P3       | `agent-store.events` dead state (#42)                            | Small  |
| P3       | Electron sandbox evaluation (#49)                                | Large  |

---

## Files reviewed

- `src/components/companion-view.tsx`
- `src/components/pipper-overlay.tsx`
- `src/components/agent-panel.tsx`
- `src/components/terminal-session.tsx`
- `src/components/others-view.tsx`
- `src/store/pipper-store.ts`
- `src/store/agent-store.ts`
- `src/store/thread-store.ts`
- `src/store/project-store.ts`
- `src/store/terminal-store.ts`
- `src/lib/thread-queries.ts`
- `src/App.tsx`
- `src/launch/app.tsx`
- `@/components/ui/input-message.tsx`
- `@/components/ui/assistant-trace-deck.tsx`
- `src/lib/theme.tsx`
- `src/lib/agent-message-images.ts`
- `electron/main.ts`
- `electron/agent.ts`
- `electron/update-manager.ts`

---

## Suggested test matrix (blind-spot focused)

**Companion**

- Editor activation failure (mock IPC throw).
- Accept with zero git changes since baseline.
- Accept before `editor:activate` baseline captured.
- Close companion window (X) with dirty workspace — no reject prompt.
- Overlay comment when companion IPC disconnected.
- Toggle overlay off — confirm edit session + accept bar still present.
- Strict vs loose component annotation strings in message history.
- Open companion during update busy state.

**Agent panel**

- Edit group of two consecutive user messages — verify replace target.
- Drag unsupported MIME — expect silent drop today.
- Send/replace/compact/abort IPC failure — no toast today.
- Regenerate when `replacePrompt` throws.
- Create thread IPC failure — uncaught today.
- Thread switch failure — tab reverts but no error message.
- UI request during thread switch + timeout.
- Streaming trace expansion without text length change — scroll follow.
- Rapid model / thinking-level clicks.
- `setModel` returns false — no feedback.

**Overlay**

- Scroll/resize while popup open and while beaming — highlight follows.
- Click nested pipper ids — which element is selected.
- `setProcessing` succeeds, `addComment` fails — processing stuck?

**Runtime / shell**

- Switch project when `activateProject` fails — UI vs runtime mismatch.
- `markActiveHealthy` with wrong version during `awaiting-health-check`.
- Open tabs broadcast — tab id list changes before thread titles refetch.
- `shell:openExternal` with non-Clerk URL (dev only).

**Terminal**

- Switch project with open terminal tabs — cwd unchanged.
- PTY create failure — tab remains in bar.
