# Visual Editor (Pipper) — Implementation Plan

## Architecture

```
┌──────────────────────────┐     ┌────────────────────────────┐
│ MAIN WINDOW              │     │ COMPANION WINDOW            │
│                          │     │                            │
│  PipperOverlay           │◄────│  editMode / processingId   │
│   (hover/click overlay)  │  ───│  (via broadcastToWindows)  │
│                          │ ipc │                            │
│  BorderBeam on           │     │  CompanionView refactored  │
│   processing element     │◄────│  → editor:sendPrompt ──────┼───┐
│                          │     │  InputMessage              │   │
│  PipperStore (zustand)   │     │  (auto-filled on comment)  │   │
│   editMode, processingId │     │                            │   │
└──────────────────────────┘     └────────────────────────────┘   │
                                                                   ▼
                                                     ┌────────────────────────┐
                                                     │  AgentManager          │
                                                     │                        │
                                                     │  editorRecord          │
                                                     │   (ephemeral, no DB)   │
                                                     │   cwd: ~/code/omni    │
                                                     │                        │
                                                     │  events → editor:event │
                                                     │   (separate channel)   │
                                                     └────────────────────────┘
```

## Phase 1: Ephemeral Editor Session

### Files: `electron/agent.ts`, `electron/main.ts`

**AgentManager additions:**

| Field/Method                                 | Purpose                                                                                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editorRecord: ProjectRuntimeRecord \| null` | In-memory record, no DB backing                                                                                                                                  |
| `activateEditor()`                           | Creates fake `Project { id: "__omni_editor__", path: "~/code/omni" }`, calls `createProjectRuntime(project, SessionManager.continueRecent(path))`, binds session |
| `sendEditorPrompt(input)`                    | `editorRecord.runtime.session.prompt(input.message)`, push snapshot                                                                                              |
| `resolveEditorSnapshot()`                    | Same as `resolveSnapshot()` but uses `editorRecord`                                                                                                              |
| `disposeEditor()`                            | Dispose runtime + nullify record                                                                                                                                 |

**Key:** Session events emit on `editor:event` channel (separate from main agent's `agent:event`). Constructor takes new `sendToFlyout` callback. No DB calls whatsoever.

**IPC handlers** in `main.ts`:

- `editor:activate` / `editor:sendPrompt` / `editor:dispose`
- `pipper:setProcessing` → `broadcastToWindows("pipper:stateChanged", { processingId })`
- `pipper:enterEditMode` / `pipper:exitEditMode`

## Phase 2: Preload API

### File: `electron/preload.ts`

```typescript
editor: {
  onEvent: (callback) => ipcRenderer.on("editor:event", ...),
  activate: () => ipcRenderer.invoke("editor:activate"),
  sendPrompt: (input) => ipcRenderer.invoke("editor:sendPrompt", input),
  dispose: () => ipcRenderer.invoke("editor:dispose"),
},
pipper: {
  onStateChanged: (callback) => ipcRenderer.on("pipper:stateChanged", ...),
  enterEditMode: () => ipcRenderer.invoke("pipper:enterEditMode"),
  exitEditMode: () => ipcRenderer.invoke("pipper:exitEditMode"),
  addComment: (pipperId, text) => ipcRenderer.invoke("pipper:addComment", pipperId, text),
}
```

## Phase 3: Pipper Store

### File: `src/store/pipper-store.ts`

```typescript
interface PipperState {
  editMode: boolean;
  processingId: string | null;
}
```

Zustand store synced cross-window via `pipper:stateChanged` IPC broadcasts.

## Phase 4: PipperOverlay (Main Window)

### File: `src/components/pipper-overlay.tsx`

Rendered in `App.tsx` when `editMode === true`:

- Transparent overlay (`pointer-events: none`)
- `document.elementFromPoint()` on mousemove to detect `[data-pipper-id]`
- Highlights hovered element with outline rect
- On click: shows floating textarea near the element
- On submit: `window.omni.pipper.addComment(pipperId, text)` → broadcast to flyout

## Phase 5: Companion View — Visual Editor Console

### File: `src/components/companion-view.tsx`

**Refactor** the existing CompanionView. It currently uses `useAgentStore()` + `connect()` (shares the main panel's session). Must switch to the ephemeral editor session instead.

Changes:

- Remove `useAgentStore()` — replace with `window.omni.editor.*` API
- Remove model selector (editor uses a fixed model, no switching needed)
- Remove message history display (editor session has no persistent messages)
- Header: "✏️ Visual Editor" + close button
- `InputMessage` at bottom — auto-focused on mount
- On Enter: `window.omni.editor.sendPrompt({ message })`
- On mount: `window.omni.editor.activate()`, subscribe to `editor:event`
- On unmount: `window.omni.editor.dispose()`, `pipper:exitEditMode`

**Auto-fill:** When main window submits a comment → `pipper:commentAdded` broadcast → companion fills the comment text into `InputMessage`.

## Phase 6: PipperBeam + UI Wrapping

### File: `@/components/ui/pipper-beam.tsx`

```tsx
function PipperBeam({ pipperId, children }) {
  const processingId = usePipperStore((s) => s.processingId);
  if (!pipperId) return children;
  return (
    <BorderBeam colorVariant="mono" active={processingId === pipperId}>
      {children}
    </BorderBeam>
  );
}
```

If no `pipperId`, renders children as-is (zero cost).

### Wrap in 8-10 shared components:

| Component                     | Root Element        | Change    |
| ----------------------------- | ------------------- | --------- |
| `button.tsx`                  | `<ButtonPrimitive>` | Wrap root |
| `dropdown.tsx`                | `<Elevated>`        | Wrap root |
| `menu-item.tsx`               | `<div>`             | Wrap root |
| `chat-message.tsx`            | `<motion.div>`      | Wrap root |
| `input-message.tsx`           | `<div>`             | Wrap root |
| `thinking-indicator.tsx`      | `<div>`             | Wrap root |
| `badge.tsx`                   | `<span>`            | Wrap root |
| `tabs.tsx` (TabItem/TabPanel) | Various             | Wrap root |

Each adds 2 lines: import `PipperBeam`, wrap root element.

## Phase 7: Flow Summary

```
1. User clicks SelectionBackground icon in title bar
   → flyout:open IPC → createFlyoutWindow()
   → CompanionView mounts → editor:activate → creates ephemeral session
   → pipper:enterEditMode → main window renders PipperOverlay

2. Main window: cursor → crosshair, hover highlights elements

3. User clicks "thread-tabs" element
   → Inline input appears near element
   → User types "Make tabs smaller" + Enter
   → pipper:addComment("thread-tabs", "Make tabs smaller")
   → CompanionView receives comment, fills InputMessage

4. User presses Enter in companion
   → pipper:setProcessing("thread-tabs") → BorderBeam activates
   → editor:sendPrompt({ message: "Make tabs smaller" })
   → Agent processes (cwd: ~/code/omni)
   → On agent_end → pipper:setProcessing(null) → BorderBeam stops

5. Repeat: click → comment → enter → process

6. User closes companion window
   → pipper:exitEditMode → overlay + cursor restored
   → editor:dispose → cleanup
```

## File Change Summary

| File                                | Action                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `electron/agent.ts`                 | Modify — add editor record + methods                                                                                 |
| `electron/main.ts`                  | Modify — add 5 IPC handlers                                                                                          |
| `electron/preload.ts`               | Modify — expose `window.omni.editor` + `window.omni.pipper`                                                          |
| `src/store/pipper-store.ts`         | **New**                                                                                                              |
| `src/components/pipper-overlay.tsx` | **New**                                                                                                              |
| `src/components/companion-view.tsx` | Modify — refactor to use editor API instead of shared agent store, remove model selector, add auto-fill for comments |
| `@/components/ui/pipper-beam.tsx`   | **New**                                                                                                              |
| 8-10 `@/components/ui/*.tsx`        | Modify — wrap with PipperBeam                                                                                        |
| `src/App.tsx`                       | Modify — conditionally render PipperOverlay                                                                          |
