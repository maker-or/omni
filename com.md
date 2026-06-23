# Companion / Edit Mode — Beta Fix Report

Verified against the codebase on 2026-06-23. This document covers **only** the issues explicitly raised by the user and confirmed during code review. It is written for a coding agent that will implement fixes later.

Do not expand scope into broader UX polish or redesign work unless a fix here requires a small adjacent change.

---

## Scope

| # | Issue | Verified | Beta-fixable |
|---|-------|----------|--------------|
| 1 | Closing edit mode should delete the session; reopening must start with no prior logs | Yes | Yes |
| 2 | Within a session, conversation should feel back-and-forth with the agent | Partially (agent supports it; UI limits it) | Yes |
| 3 | Companion window must not float above all desktop apps | Yes | Yes |
| 4 | Overlay input and companion bottom input render user messages differently | Yes | Yes |

---

## Issue 1 — Session must not persist after close

### User expectation

- Closing the companion / edit-mode session should **fully discard** the conversation.
- Reopening edit mode must create a **brand-new session** with **no previous messages**.
- No explicit “remember conversation” behavior is desired for beta.

### Current behavior (verified)

The editor uses an **ephemeral in-memory session** in the main process:

- `electron/agent.ts` — `activateEditor()` creates `SessionManager.inMemory(omniPath)` and stores it on `this.editorRecord`.
- Comment in code: `// Ephemeral editor record — no DB backing, lives only in memory`.

**Problem A — session reuse on re-activate**

```ts
// electron/agent.ts — activateEditor()
if (this.editorRecord) return; // already active
```

If `editorRecord` is still set when the companion reopens, the old session (including all messages) is reused unchanged.

**Problem B — cleanup relies on renderer unmount**

`src/components/companion-view.tsx` disposes only in a React cleanup effect:

```ts
return () => {
  void window.omni?.editor?.dispose?.();
  void window.omni?.pipper?.exitEditMode?.();
  void window.omni?.pipper?.setProcessing?.(null);
};
```

This is fire-and-forget (`void`). If the BrowserWindow is destroyed before IPC completes, `disposeEditor()` may never run in the main process.

**Problem C — main process does not dispose on close**

```ts
// electron/main.ts
ipcMain.on("companion:close", () => {
  companionWindow?.close();
});
```

No call to `disposeEditor()`, `exitEditMode()`, or `setProcessing(null)`.

**Problem D — reopen reuses existing window**

```ts
// electron/main.ts — createCompanionWindow()
if (companionWindow && !companionWindow.isDestroyed()) {
  companionWindow.show();
  companionWindow.focus();
  return;
}
```

If the user did not fully close the window, the same session and UI state remain.

### Files involved

| File | Role |
|------|------|
| `electron/agent.ts` | `activateEditor()`, `disposeEditor()`, `editorRecord`, `sendEditorPrompt()` |
| `electron/main.ts` | `createCompanionWindow()`, `companion:open`, `companion:close`, `editor:dispose` IPC |
| `src/components/companion-view.tsx` | `useEditorSession()` mount/unmount lifecycle |
| `electron/preload.ts` | `editor.dispose`, `companion.close` bridge |
| `src/electron.d.ts` | Type definitions for editor/companion IPC |

### Recommended fix (for coding agent)

1. **Main process owns session lifecycle** — do not rely solely on renderer cleanup.
   - On `companion:close` and/or `companionWindow.on("closed")`, call:
     - `requireAgentManager().disposeEditor()`
     - broadcast `pipper:stateChanged` with `{ editMode: false, processingId: null }`
2. **Fresh session on open** — on `companion:open`:
   - Either always `disposeEditor()` before `createCompanionWindow()`, or
   - Add something like `activateEditor({ fresh: true })` that disposes any existing record first.
3. **Remove or bypass early return** in `activateEditor()` when a fresh session is requested.
4. Optionally keep renderer cleanup as a safety net, but main process must be authoritative.

### Acceptance criteria

- [ ] Close companion window → reopen → companion shows empty state (“Edit Mode”), zero prior messages.
- [ ] `getEditorState().messages` is `[]` after close + reopen.
- [ ] `isEditorActive()` is `false` after close until companion opens again.
- [ ] Edit mode overlay on main window is off after companion close.

---

## Issue 2 — Within-session conversation should be back-and-forth

### User expectation

During a single edit-mode session (before accept/reject), the user should be able to send multiple messages and continue the conversation with the agent naturally.

### Current behavior (verified)

**What works**

- `sendEditorPrompt()` calls `record.runtime.session.prompt(input.message)` — the pi-sdk session accumulates turns in memory.
- Overlay comments and companion bottom input both route through `sendEditorPrompt()`.

**What limits conversational feel**

**A — send blocked while streaming**

```ts
// src/components/companion-view.tsx — handleSend()
if (!trimmed || isStreaming || isProcessingAccept) return;
```

User cannot send the next message until the agent finishes. Unlike `src/components/agent-panel.tsx`, there is no `followUp` / `steer` queue while streaming.

**B — messages hidden after internal commit prompt**

```ts
// src/components/companion-view.tsx
const commitMsgIndex = (snapshot?.messages ?? []).findIndex((m) =>
  content.includes("Commit all completed changes to Git with a clear, descriptive commit message"),
);
const visibleMessages =
  commitMsgIndex !== -1
    ? (snapshot?.messages ?? []).slice(0, commitMsgIndex)
    : (snapshot?.messages ?? []);
```

If the agent triggers an internal commit step, later turns are sliced out of the UI. This can make the thread look truncated or non-conversational.

**C — main window reload on every `agent_end`**

```ts
// electron/agent.ts — editor session subscribe
if (event.type === "agent_end") {
  this.completeEditorMutation("success");
  this.reloadMainWindow?.();
}
```

Each completed agent turn reloads the main Pipper window. Conversation history remains in the companion, but the main app flashing/reloading can interrupt the edit flow.

### Files involved

| File | Role |
|------|------|
| `src/components/companion-view.tsx` | `handleSend`, `visibleMessages` filtering, streaming gate |
| `electron/agent.ts` | `sendEditorPrompt()`, `agent_end` → `reloadMainWindow` |
| `electron/main.ts` | `reloadMainWindow` implementation (restarts Vite + reloads) |
| `src/components/agent-panel.tsx` | Reference for follow-up/steer queue pattern (if porting) |

### Recommended fix (for coding agent)

Minimum for beta (low scope):

1. **Remove or narrow `commitMsgIndex` filtering** — show full user/assistant turns for the current session. If hiding the commit prompt is still needed, hide only that single system/tool message, not everything after it.
2. **Keep streaming gate** for beta if follow-up queue is too much work — but document that users must wait for the agent to finish before sending again.

Optional improvement (slightly more work):

3. Port a simplified **follow-up queue** from agent panel so users can type the next message while the agent is still running.
4. Revisit **`reloadMainWindow` on every `agent_end`** — consider reloading only when files actually changed, or debouncing, so multi-turn editing feels less disruptive.

### Acceptance criteria

- [ ] User can send message → agent responds → user sends another message → both user turns and both assistant replies are visible in companion.
- [ ] No unexplained disappearance of messages mid-session (especially after agent uses git/commit tooling).
- [ ] (Optional) User can queue a follow-up message while agent is streaming.

---

## Issue 3 — Companion must not stay on top of all desktop apps

### User expectation

The companion window should appear above the Pipper app only — **not** globally above Chrome, Slack, or other desktop applications.

### Current behavior (verified)

```ts
// electron/main.ts — createCompanionWindow()
companionWindow = new BrowserWindow({
  // ...
  alwaysOnTop: true,
```

`alwaysOnTop: true` pins the window above every application on the OS, which is distracting.

### Files involved

| File | Role |
|------|------|
| `electron/main.ts` | `createCompanionWindow()` BrowserWindow options |

### Recommended fix (for coding agent)

**Preferred:** Remove `alwaysOnTop: true` and set `parent: mainWindow` (ensure `mainWindow` exists before creating companion). Child windows stay above their parent within the app without global always-on-top.

**Fallback:** Remove `alwaysOnTop: true` only.

Do not add new always-on-top behavior elsewhere.

### Acceptance criteria

- [ ] Companion floats above the main Pipper window when both are open.
- [ ] Switching focus to another app (e.g. browser) places that app above the companion.
- [ ] Companion is still usable and not lost behind the main window when Pipper is the active app.

---

## Issue 4 — Overlay input vs companion bottom input render differently

### User expectation

When the user sends a request — whether by clicking a UI element (overlay popup) or typing in the companion’s bottom input — the user message should render **consistently** in the companion chat.

### Current behavior (verified)

**Overlay path** formats the prompt with a component annotation:

```ts
// src/components/companion-view.tsx — onCommentAdded
void sendPrompt(`[Component: ${pipperId}]\n${text}`);
```

**Companion bottom input** sends plain text:

```ts
// src/components/companion-view.tsx — handleSend
await sendPrompt(trimmed);
```

**Rendering splits on that format:**

```ts
// src/components/companion-view.tsx
const componentMatch = bodyText.match(/^\[Component:\s*(.+?)\]\n([\s\S]+)$/);

{from === "user" && componentMatch ? (
  /* Annotation bubble — chip + comment, surface-3, maxWidth 240 */
) : (
  /* Regular message bubble — surface-4, different layout */
)}
```

Result: same session, two different visual treatments for user messages depending on which input was used.

The agent already distinguishes sources in analytics (`overlay_comment` vs `companion_prompt` in `electron/agent.ts`); the mismatch is **UI-only**.

### Files involved

| File | Role |
|------|------|
| `src/components/companion-view.tsx` | `onCommentAdded`, `handleSend`, message rendering loop |
| `src/components/pipper-overlay.tsx` | Overlay submit → `pipper:addComment` (does not render chat itself) |
| `electron/main.ts` | `pipper:addComment` broadcast to companion |
| `electron/agent.ts` | `buildMutationProperties()` source tagging |

### Recommended fix (for coding agent)

Pick one consistent user-message presentation:

**Option A (simplest):** Always use the regular user bubble for all user messages. Overlay path still sends `[Component: …]` prefix for agent context, but rendering shows it as normal text (or strip the prefix for display while keeping it in the sent prompt).

**Option B:** Extract a shared `EditModeUserMessage` component. Overlay-tagged messages show the chip; companion free-text messages use the same bubble shell (alignment, padding, surface) without a chip.

**Option C:** Wrap companion bottom-input messages in the same annotation format when a component is selected (`activePipperIdRef`), otherwise use a unified “general” style.

Do not change the overlay popup itself for beta unless needed — fix the companion chat rendering.

### Acceptance criteria

- [ ] Overlay-initiated user message and companion-input user message use the same visual language (alignment, bubble style, typography).
- [ ] Component-targeted overlay messages can still show which component was edited (chip or equivalent).
- [ ] Agent still receives correct prompt text for both paths (no regression in `sendEditorPrompt`).

---

## IPC / state reference (quick lookup)

| IPC / API | Direction | Purpose |
|-----------|-----------|---------|
| `companion:open` | renderer → main | Open/show companion window |
| `companion:close` | renderer → main | Close companion window |
| `editor:activate` | renderer → main | Start editor session |
| `editor:dispose` | renderer → main | Tear down editor session |
| `editor:sendPrompt` | renderer → main | Send user message to editor agent |
| `pipper:enterEditMode` | renderer → main | Broadcast `editMode: true` |
| `pipper:exitEditMode` | renderer → main | Broadcast `editMode: false` |
| `pipper:addComment` | renderer → main | Overlay comment → companion auto-send |
| `pipper:stateChanged` | main → all windows | Sync `editMode`, `processingId` |
| `pipper:commentAdded` | main → companion | Overlay text forwarded to companion |

State store: `src/store/pipper-store.ts` (`editMode`, `processingId`).

---

## Suggested implementation order

1. **Issue 3** — `alwaysOnTop` / `parent` in `electron/main.ts` (smallest, isolated change).
2. **Issue 1** — session dispose + fresh session in `electron/main.ts` + `electron/agent.ts`.
3. **Issue 4** — unify user message rendering in `src/components/companion-view.tsx`.
4. **Issue 2** — message visibility + optional follow-up queue in `src/components/companion-view.tsx`.

---

## Out of scope for this report

- General edit-mode UX improvements (onboarding, diff preview, suggested prompts, etc.).
- Full companion UI redesign.
- `patch.md` / accept-reject workflow changes.
- Analytics event changes (unless required to verify fixes).

---

## Verification after fixes

Run before marking complete:

```bash
bun run doctor
bun run lint
bun run build
bun run fmt
```

Manual smoke test:

1. Open companion → overlay click → send → see message → close companion → reopen → empty chat.
2. Open companion → send from bottom input → agent replies → send again → full thread visible.
3. Focus another app while companion is open → companion does not cover it.
4. Send via overlay and via bottom input → consistent user bubble styling.