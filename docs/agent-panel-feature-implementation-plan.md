# AgentPanel missing-feature implementation plan

## Purpose

This document is the implementation handoff for wiring attachments, slash commands, abort, streaming input, queue display, compaction, thread deletion, regeneration, and message editing into `AgentPanel`.

The underlying runtime capabilities already exist for most features. The work is primarily renderer wiring, plus one required backend addition for correct regenerate/edit semantics and a renderer-friendly attachment representation.

## Current architecture and source map

### Renderer

- `src/components/agent-panel.tsx`
  - Owns the chat composer and message list.
  - Calls `useAgentStore().sendPrompt()` from `handleSend()`.
  - Reads `snapshot.messages`, `snapshot.streamingMessage`, `snapshot.commands`, and `snapshot.isStreaming`.
  - Slash suggestions only insert text through `applyCommand()`.
  - Regenerate currently finds the preceding user message and submits it again, appending a duplicate turn.
  - Edit currently copies text into `inputValue` without changing conversation history.
  - Tab close uses `window.omni.tabs.close()` and must remain distinct from permanent deletion.
- `@/components/ui/input-message.tsx`
  - Already supports controlled `files`, `onFilesChange`, drag/drop, picker access through a slot, previews, file-only sends, MIME filtering, and `maxFiles`.
  - `onSend(value, files)` already returns attached files to the owner.
  - Attachment behavior is disabled when `onFilesChange` is absent.
- `@/components/ui/chat-message.tsx`
  - Its `files?: File[]` API is suitable only for renderer-local browser `File` objects.
  - Persisted runtime messages contain image content objects, not `File` objects.
- `src/store/agent-store.ts`
  - Already exposes `sendPrompt`, `abort`, and `compact`.
  - Receives snapshots/events and keeps `snapshot.queue` current through full snapshots.
- `src/store/thread-store.ts`
  - Already exposes `deleteThread(id)` through `window.omni.threads.delete(id)`.
  - Records deleted IDs so open tabs can react.

### Contracts and Electron bridge

- `contracts/agent.ts`
  - `AgentPromptInput.images` is `Array<{ type: "image"; data: string; mimeType: string }>`.
  - `AgentPromptInput.streamingBehavior` is `"steer" | "followUp"`.
  - `AgentRuntimeSnapshot` exposes `isStreaming`, `isCompacting`, `messages`, `streamingMessage`, `queue`, and `commands`.
  - `AgentQueueState` contains separate `steering` and `followUp` string arrays.
- `electron/preload.ts` and `src/electron.d.ts`
  - The renderer bridge already exposes send, abort, compact, and thread deletion.
- `electron/main.ts`
  - Registers `agent:sendPrompt`, `agent:abort`, `agent:compact`, and `threads:delete`.
  - `threads:delete` also closes the deleted thread tab and broadcasts the resulting tab state.
- `electron/agent.ts`
  - `sendPrompt()` passes `images` and `streamingBehavior` directly to `record.runtime.session.prompt()`.
  - `abort()` and `compact()` are implemented.
  - Runtime `queue_update` events update the snapshot queue.
  - `getCommands()` currently returns extension commands only.

### Runtime constraint for regenerate/edit

`@earendil-works/pi-coding-agent` stores sessions as an append-only tree. Entries cannot be edited or deleted. Correct replacement behavior requires creating a new active branch:

- `AgentSession.sessionManager.getBranch()` returns the active session entries.
- `AgentSession.sessionManager.branch(entryId)` moves the leaf to an earlier entry.
- `AgentSession.sessionManager.resetLeaf()` moves before the first entry.
- `AgentSession.navigateTree(targetId, options)` provides higher-level tree navigation.

Do not splice `snapshot.messages`, rewrite JSONL files, or mutate stored entries. For regenerate, branch immediately before the target user message and resubmit that original message. For edit, branch immediately before the target user message and submit the edited text. The abandoned path remains available in the session tree.

## Product decisions to use during implementation

These decisions remove ambiguity for the coding agent:

1. Attachments: support PNG, JPEG, GIF, and WebP initially. Do not expose PDF until there is a defined PDF-to-text/image ingestion path; `AgentPromptInput.images` cannot represent PDF.
2. Maximum attachments: 5 images per prompt; maximum size 10 MiB each. Reject unsupported/oversized files with a toast and keep valid files.
3. Image transport: convert browser `File` objects to raw base64 without the `data:<mime>;base64,` prefix before calling `sendPrompt`.
4. Streaming send default: while streaming, the main send button queues a `followUp`. Provide a small mode control to switch the next send to `steer`. When idle, omit `streamingBehavior`.
5. Slash command selection: clicking a suggestion inserts the command and keeps focus. Pressing Enter sends it through the ordinary prompt path. Do not auto-send on suggestion click because commands may accept arguments.
6. Built-in slash commands: add renderer-owned `/compact` and `/abort`. Execute these locally and do not send them to the model/runtime prompt. Extension commands remain runtime-provided.
7. Queue display: show both queues above the composer while non-empty, labelled `Steering` and `Next`. Items are read-only in the first release because no dequeue API exists.
8. Abort: while streaming, replace the normal send affordance with a visible Stop action, while keeping the textarea enabled so a follow-up/steer can be composed. Stop calls `abort()` once and is disabled while awaiting completion.
9. Compaction: expose `/compact` and an overflow-menu action. Disable while streaming or already compacting. Show compacting state from `snapshot.isCompacting`.
10. Delete: permanent deletion must require confirmation and clearly differ from closing a tab. After deletion, rely on `threads:delete` to close the tab, then invalidate open-tab and project-thread queries and select the returned/fallback active tab.
11. Regenerate: branch before the relevant user message, then submit the original text and original images. It replaces the active visible path but preserves the old branch in storage.
12. Edit: enter an explicit edit mode containing the target message text and attachments. Submit branches before that message and sends the edited prompt. Cancel restores normal composer state without runtime mutation.

## Required contract additions

### Renderer-friendly message attachments

Do not pass persisted images through `ChatMessage.files`; constructing fake `File` objects loses semantic clarity and can be expensive. Add a serializable attachment view model:

```ts
export interface ChatImageAttachment {
  id: string;
  mimeType: string;
  data: string; // raw base64
  name?: string;
}
```

Add `images?: ChatImageAttachment[]` to `ChatMessageProps`, or create a dedicated `MessageAttachments` component used inside `AgentPanel`. Render with a data URL assembled as `data:${mimeType};base64,${data}`. Preserve `files` on `InputMessage` for unsent browser files.

Create pure helpers in `src/lib/agent-message-images.ts`:

- `fileToPromptImage(file): Promise<AgentPromptImage>`
- `extractMessageImages(message): ChatImageAttachment[]`
- `extractGroupedMessageImages(messages): ChatImageAttachment[]`
- MIME and size validation helpers.

The runtime’s user message content may be a string or an array of text/image parts. Image parts use `{ type: "image", data, mimeType }`. Extraction must ignore thinking/tool-call content.

### Stable session entry identity

Rendered `AgentMessage[]` currently do not expose the session entry ID needed for branching. Add a renderer-safe message envelope rather than guessing by array index:

```ts
export interface AgentMessageView {
  entryId: string;
  parentId: string | null;
  message: AgentMessage;
}
```

Preferred change: change snapshot `messages` and `streamingMessage` to view objects only if all consumers can be migrated atomically. Lower-risk change: add parallel metadata:

```ts
export interface AgentMessageEntryRef {
  entryId: string;
  parentId: string | null;
}

messageEntryRefs: AgentMessageEntryRef[];
```

The refs must align exactly with `snapshot.messages`. Add an invariant/test for equal lengths. Streaming messages do not need a persisted entry ID until finalized.

### Branch-and-submit IPC

Add one atomic backend operation so the renderer cannot branch successfully and then fail before submission:

```ts
export interface AgentReplacePromptInput {
  threadId: string;
  targetUserEntryId: string;
  message: string;
  images?: AgentPromptImage[];
}

replacePrompt(input: AgentReplacePromptInput): Promise<void>;
```

Wire it through:

1. `contracts/agent.ts` and `contracts/index.ts`
2. `src/electron.d.ts`
3. `electron/preload.ts`
4. `electron/main.ts` as `agent:replacePrompt`
5. `src/store/agent-store.ts`
6. `electron/agent.ts`

Backend algorithm:

1. Resolve/switch to `input.threadId` exactly as `sendPrompt()` does.
2. Reject while streaming, compacting, or retrying.
3. Read `sessionManager.getBranch()` and locate `targetUserEntryId`.
4. Verify the target is a user-message entry on the active branch.
5. Find its preceding entry. Call `sessionManager.branch(previous.id)` or `sessionManager.resetLeaf()` when editing the first entry.
6. Push a snapshot immediately so the active visible branch updates.
7. Call the shared internal prompt submission routine with edited/original text and images.
8. Emit a notification and restore a coherent snapshot on failure. Existing abandoned entries remain safe because storage is append-only.

Refactor common send logic inside `AgentManager` so `sendPrompt()` and `replacePrompt()` share project activation, thread switching, mutation tracking, error reporting, fallback-model behavior, and snapshot pushes.

## Implementation phases

### Phase 0 — Safety tests and shared helpers (0.5–1 day)

Files:

- Add `src/lib/agent-message-images.ts`
- Add corresponding Bun tests.
- Add tests around message grouping/index mapping where practical.

Tasks:

- Implement `FileReader`/`arrayBuffer` base64 conversion without retaining data-URL prefixes.
- Validate MIME, count, and byte size.
- Extract image parts from persisted user/tool messages.
- Add clear error types/messages suitable for toasts.

Exit criteria:

- Multiple images retain order and MIME type.
- File-only messages are allowed.
- Unsupported files and oversized files do not enter composer state.
- Text extraction continues to exclude image payloads.

### Phase 1 — Image attach, send, and render (1–1.5 days)

Files:

- `src/components/agent-panel.tsx`
- `@/components/ui/chat-message.tsx` or new `@/components/ui/message-attachments.tsx`
- `src/lib/agent-message-images.ts`

Tasks:

- Add `attachedFiles` state to `AgentPanel`.
- Pass `files`, `onFilesChange`, `accept="image/png,image/jpeg,image/gif,image/webp"`, and `maxFiles={5}` into `InputMessage`.
- Add an attach button in `leftSlot` using `openFilePicker("image/*")`.
- Change `handleSend(text, files)` to allow text-only, image-only, or mixed sends.
- Convert all files before calling `sendPrompt`; do not clear composer state until conversion and IPC invocation succeed.
- Prevent double-submit while files are converting.
- Clear text and files together after successful submission.
- Extract persisted image parts from each grouped user message and render thumbnails.
- Add click-to-preview using a dialog/lightbox; do not open untrusted URLs because images are local data.
- Ensure regenerate/edit preserve original image parts.

Exit criteria:

- Picker and drag/drop both attach supported images.
- Images preview before send and render after send, thread switch, and app restart.
- Image-only prompts work.
- A conversion or IPC failure leaves the draft intact.

### Phase 2 — Abort and stream-while-running (0.75–1 day)

Files:

- `src/components/agent-panel.tsx`
- Optional small reusable composer status component.

Tasks:

- Destructure `abort` from `useAgentStore()`.
- Track `isAborting` locally to suppress duplicate calls.
- Add visible Stop UI whenever `snapshot.isStreaming` is true.
- Keep the composer enabled while streaming; only thread switching, conversion, replacement, or destructive operations should disable it.
- Add next-send behavior state: `followUp` by default, selectable `steer`.
- In `handleSend`, pass the selected behavior only when `isStreaming`.
- Reset behavior to `followUp` after a successful streaming send.
- Surface runtime rejection through toast/error state rather than clearing the draft.

Exit criteria:

- Stop aborts the current response and returns UI to idle.
- Sending while streaming produces a queue item and does not raise the runtime’s missing-`streamingBehavior` error.
- Steer and follow-up reach their distinct queues.

### Phase 3 — Queue display (0.5 day)

Files:

- `src/components/agent-panel.tsx`
- Prefer new `src/components/agent-queue.tsx`.

Tasks:

- Read `snapshot.queue.steering` and `.followUp`.
- Render a compact queue panel above slash suggestions/composer.
- Label behavior clearly: steering affects the current turn; follow-up runs next.
- Collapse long items to two lines with full text in a tooltip.
- Preserve arrival order.
- Hide empty sections and hide the panel when both queues are empty.

Exit criteria:

- Queue changes appear from runtime snapshots without refresh.
- Queue clears as items are consumed or after abort/runtime updates.

### Phase 4 — Slash-command registry and built-ins (0.75–1 day)

Files:

- Add `src/lib/agent-commands.ts`
- `src/components/agent-panel.tsx`

Tasks:

- Define a renderer command model that normalizes built-ins and extension commands.
- Built-ins: `/compact` and `/abort`.
- Merge built-ins with `snapshot.commands`, resolving collisions in favor of built-ins and logging/marking duplicates.
- Improve matching to prefer prefix matches before substring matches.
- Add keyboard selection: ArrowUp/ArrowDown, Enter/Tab to insert, Escape to dismiss.
- Keep extension command behavior as text insertion followed by ordinary send.
- Before send, parse only an exact first token. Execute built-ins locally:
  - `/abort` accepts no arguments and calls `abort()`.
  - `/compact [instructions]` calls `compact(instructions || undefined)`.
- Do not intercept extension commands.

Exit criteria:

- Built-ins never reach `session.prompt()`.
- Extension commands still execute through the runtime.
- Commands with arguments remain editable before submission.

### Phase 5 — Compact UI (0.5 day)

Files:

- `src/components/agent-panel.tsx`

Tasks:

- Destructure `compact` from the store.
- Add Compact to the thread/conversation overflow menu in addition to `/compact`.
- Disable while streaming, compacting, retrying, or switching thread.
- Display `Compacting…` from `snapshot.isCompacting` and prevent duplicates.
- Keep custom instructions accessible through `/compact <instructions>`; the menu action uses defaults.

Exit criteria:

- Both menu and slash paths trigger the same store operation.
- Errors arrive through the existing runtime notification flow.

### Phase 6 — Permanent thread deletion (0.75–1 day)

Files:

- `src/components/agent-panel.tsx`
- Possibly a reusable confirmation-dialog component.
- `src/store/thread-store.ts` if return/error behavior needs strengthening.

Tasks:

- Destructure `deleteThread` from `useThreadStore()`.
- Add Delete in the thread item context/overflow menu, never on the existing close-tab button.
- Confirmation copy must state that the session history is permanently deleted.
- Block deletion while that thread is actively streaming, or abort first only after explicit confirmation. Prefer blocking for the first release.
- After success, invalidate `OPEN_TABS_QUERY_KEY` and affected project thread queries, clear editing/hover state, and select the active/fallback tab returned by refreshed open-tab state.
- Change `thread-store.deleteThread` to return success/failure or throw; the current implementation swallows errors, which prevents accurate UI feedback.

Exit criteria:

- Close tab preserves the thread.
- Delete removes the database row and session file, closes its tab, and selects a valid fallback.
- Failed deletion leaves the UI entry intact and shows an error.

### Phase 7 — Correct regenerate and edit (2–3 days)

Files:

- `contracts/agent.ts`, `contracts/index.ts`
- `electron/agent.ts`, `electron/main.ts`, `electron/preload.ts`
- `src/electron.d.ts`
- `src/store/agent-store.ts`
- `src/components/agent-panel.tsx`
- Backend and helper tests.

Tasks:

- Add stable message-entry refs to snapshots.
- Add atomic `replacePrompt` IPC/store operation described above.
- Update grouped-message structures so actions retain the relevant user entry ID rather than relying on `originalIndex` after grouping.
- Regenerate action:
  - Find the user message associated with the assistant response.
  - Extract its text and images.
  - Confirm it has a stable entry ref.
  - Call `replacePrompt` with unchanged content.
  - Disable actions while replacement starts.
- Edit action:
  - Store `{ targetEntryId, text, existingImages }` as explicit edit state.
  - Populate composer with text and reconstructed attachment view state. Prefer a union draft attachment type (`File` for new, serialized image for existing) rather than converting persisted base64 into large `File` objects.
  - Show `Editing message` and Cancel controls.
  - On submit, serialize both retained and new images and call `replacePrompt`.
- Prevent regenerate/edit on streaming messages or while runtime is busy.
- If entry identity cannot be resolved, disable the action and log a diagnostic; never guess from displayed array index.

Exit criteria:

- Regenerate does not append after the old assistant response on the active path.
- Edit produces a new branch from immediately before the edited user message.
- Earlier history is preserved, later old history disappears from the active view, and abandoned history remains in the session tree.
- First-message edit works through `resetLeaf()`.
- Text and images survive regenerate/edit.

### Phase 8 — Integration polish and regression testing (1–1.5 days)

Tasks:

- Exercise thread switching during drafts, conversion, streaming, compaction, and replacement.
- Ensure async completions cannot clear a draft belonging to another thread. Associate drafts/actions with the thread ID captured at operation start.
- Verify virtualized message measurements update after image load.
- Add accessible labels, focus restoration, keyboard navigation, and confirmation focus traps.
- Run `bun test`, `bun run lint`, `bun run fmt:check`, and `bun run build`.
- Manual Electron test matrix below.

## Recommended delivery order and estimate

One engineer familiar with React/Electron and the pi runtime:

| Milestone | Scope                                                      |              Estimate |
| --------- | ---------------------------------------------------------- | --------------------: |
| M1        | Helpers + image attach/send/render                         |          1.5–2.5 days |
| M2        | Abort + streaming behavior + queue                         |         1.25–1.5 days |
| M3        | Slash built-ins + compact UI                               |         1.25–1.5 days |
| M4        | Thread deletion                                            |            0.75–1 day |
| M5        | Message identity + atomic branch/replace + regenerate/edit |              2–3 days |
| M6        | Integration, accessibility, regression fixes               |            1–1.5 days |
| **Total** | Full implementation                                        | **8–11 working days** |

Add 2–3 days if branch APIs reveal undocumented runtime behavior or if automated Electron UI test infrastructure must be introduced from scratch. A realistic calendar commitment for one engineer is two working weeks plus review/QA buffer.

Parallelization is limited: M1–M3 can proceed together after Phase 0, but M5 modifies shared contracts, `AgentPanel`, and `AgentManager`, so it should land after the simpler UI wiring or on a carefully coordinated branch.

## Manual test matrix

### Attachments

- Send one PNG with text.
- Send multiple mixed supported image formats.
- Send image-only prompt.
- Drag/drop and picker paths.
- Remove one/all attachments before send.
- Reject PDF, SVG, non-image, oversized image, and sixth image.
- Simulate IPC failure and confirm draft remains.
- Switch away/back and reload app; persisted images render.

### Streaming and queue

- Send follow-up while response is streaming.
- Send steer while response is streaming.
- Verify both queue sections and order.
- Abort with empty and non-empty queues.
- Repeated Stop clicks invoke abort once.
- Sending while idle omits `streamingBehavior`.

### Commands/compact

- Keyboard and mouse select extension command.
- Extension command with arguments.
- `/compact`, `/compact custom instructions`, and menu Compact.
- `/abort` idle and streaming.
- Command name collision between built-in and extension.
- Compact controls disabled during streaming/compaction.

### Thread deletion

- Close tab and reopen thread; history remains.
- Cancel deletion.
- Delete inactive thread.
- Delete active non-streaming thread with zero, one, and several remaining tabs.
- Attempt active-streaming deletion.
- Simulated filesystem/database failure preserves UI state.

### Regenerate/edit

- Regenerate latest response.
- Regenerate an older response.
- Edit first and middle user messages.
- Edit text-only, image-only, and mixed prompts.
- Cancel edit.
- Failure between branch validation and prompt submission.
- Confirm old branch remains navigable using runtime tree facilities.
- Confirm message action entry IDs remain correct after grouping consecutive messages and virtualization.

## Definition of done

- Every feature in the original matrix has an intentional, visible `AgentPanel` behavior.
- No feature depends on mutating runtime message arrays or session JSONL directly.
- Renderer drafts are cleared only after successful conversion and IPC acceptance.
- Regenerate/edit operate through stable entry IDs and atomic backend branching.
- Close-tab and permanent-delete semantics are visibly distinct.
- All automated checks pass and the full manual matrix is recorded in the PR description.

## Explicit non-goals for this implementation

- PDF ingestion.
- Removing or reordering queued items; the runtime currently exposes queue state but no queue mutation bridge.
- Full `/tree`, `/fork`, or `/clone` UI.
- Editing stored history in place; session storage is append-only.
- Auto-executing extension commands when a suggestion is clicked.
