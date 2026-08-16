# Terminal Implementation, Issue Analysis & Fix Plan

## 1. Overview of Terminal Systems in Omni / Pipper

Omni contains two distinct terminal architectures tailored for different operational domains:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          1. USER INTERACTIVE TERMINAL                       │
│                                                                             │
│  [UI Component: TerminalSession (Ghostty VT WASM via @wterm/react)]        │
│                               ▲                                             │
│                               │ (onData / write / resize IPC)               │
│  [Frontend Store: useTerminalStore (Workspace bucketing & plain scrollback)]│
│                               ▲                                             │
│                               │ IPC (terminal:create, write, resize, kill)  │
│  [Electron Main Process: node-pty (Login Shell: zsh/bash/pwsh)]             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                          2. ACP AGENT TERMINAL (HEADLESS)                   │
│                                                                             │
│  [AI Agent / Subagent Process (e.g., Claude, Codex, Custom ACP Subagents)]  │
│                               ▲                                             │
│                               │ ACP JSON-RPC (terminal/create, output, etc.)│
│  [AgentConnectionManager: Workspace path assertion & IPC bridge events]     │
│                               ▲                                             │
│                               │                                             │
│  [TerminalManager: child_process.spawn with bounded UTF-8 output & kill]   │
│                               ▼                                             │
│  [UI Chat Trace: AssistantTraceDeck & useAgentTerminalStore]                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Deep Dive: Bug Analysis & Root Causes

### Symptoms Observed:
1. When opening a terminal and running commands, output starts normally at the top.
2. After switching tabs (e.g., to an Agent thread or Diff view) and returning, terminal rendering is broken.
3. Content is displaced to the bottom of the viewport with large empty spaces above/below.
4. Text lines are split or rendered out of place.
5. Colors are mixed up, inverted, or bleeding across lines.

### Technical Root Causes:

1. **Container Dimension Collapse to $0\times0$ via `display: none` (`hidden` class in `App.tsx`)**:
   - When switching tabs, `isActive` became `false`, applying Tailwind's `hidden` (`display: none`) to the parent `<section>`.
   - The DOM tree inside `<TerminalSession>` remained mounted (`hasBeenActive`).
   - `ResizeObserver` inside `@wterm/dom` observed the collapse to `width: 0, height: 0`.
   - `@wterm/dom` calculated:
     $$\text{cols} = \max(1, \lfloor 0 / \text{charWidth} \rfloor) = 1, \quad \text{rows} = \max(1, \lfloor 0 / \text{rowHeight} \rfloor) = 1$$
   - It invoked `this.bridge.resize(1, 1)` on Ghostty WASM and sent `terminal:resize` ($1\times1$) over IPC to the backend PTY.

2. **Shell Reflow Flood on $1\times1$ `SIGWINCH`**:
   - The interactive login shell (`zsh`/`bash`) received `SIGWINCH` with dimensions $1\times1$.
   - Readline/Zsh attempted to redraw the prompt in a 1-character column, outputting an avalanche of single-character line wraps, carriage returns (`\r`), and cursor repositioning codes (`\x1b[2K`, `\x1b[1A`).
   - This garbled output flooded the Ghostty buffer and polluted `useTerminalStore.history`.

3. **Displacement to Bottom on Tab Return**:
   - When switching back to the tab, the container returned to full size (e.g., 120 cols $\times$ 35 rows).
   - Ghostty WASM expanded its grid from 1 row to 35 rows.
   - Because the previous output had been crushed or pushed upward into scrollback history during the $1\times1$ burst, the active cursor and newly expanded lines settled at the bottom edge.
   - `@wterm`'s auto-scroll (`_scrollToBottom()`) snapped to the bottom of this distorted state.

4. **ANSI Color Bleeding & Theme Mismatch**:
   - ANSI SGR escape sequences (e.g., `\x1b[32m` green, `\x1b[1;34m` blue bold) emitted during the $1\times1$ burst were split across single-character lines without reaching closing reset codes (`\x1b[0m`).
   - Lingering color attributes remained active in Ghostty's cell state and applied to subsequent text.
   - `@wterm/dom` had hardcoded VS Code dark theme 16-color ANSI palettes (`--term-color-0..15`), clashing with `--term-bg: transparent` under light and dark theme variations.

---

## 3. Plan & Implementation Details

### Step 1: Preserve Container Geometry Across Tab Switches
- **Target File**: [`src/App.tsx`](file:///Users/harshithpasupuleti/code/omni/src/App.tsx)
- **Change**: Replace `display: none` (`hidden`) with layout-preserving visibility styles:
  ```tsx
  <section
    key={session.id}
    className={cn(
      "absolute inset-0 z-30 flex flex-col bg-surface-1 p-2",
      isActive
        ? "pointer-events-auto visible opacity-100"
        : "pointer-events-none invisible opacity-0 -z-10",
    )}
    aria-hidden={!isActive}
  >
  ```
- **Rationale**: `visibility: hidden` (`invisible`) keeps the container's box model and pixel dimensions intact so `ResizeObserver` never drops to $0\times0$.

### Step 2: Add Dimension Bounds in Frontend Terminal Session
- **Target File**: [`src/components/terminal-session.tsx`](file:///Users/harshithpasupuleti/code/omni/src/components/terminal-session.tsx)
- **Change**: Guard `handleResize` against degenerate sizes ($\text{cols} < 2$ or $\text{rows} < 2$) and set safe initial minimums:
  ```tsx
  const handleResize = useCallback(
    (cols: number, rows: number) => {
      if (cols < 2 || rows < 2 || !Number.isFinite(cols) || !Number.isFinite(rows)) return;
      pendingSizeRef.current = { cols, rows };
      if (!ptyReadyRef.current) return;
      void window.omni.terminal.resize(sessionId, cols, rows).catch((err) => {
        console.error(`[Terminal Session] Failed to resize PTY ${sessionId}:`, err);
      });
    },
    [sessionId],
  );
  ```

### Step 3: Guard Backend PTY Resize in Electron Main
- **Target File**: [`electron/main.ts`](file:///Users/harshithpasupuleti/code/omni/electron/main.ts)
- **Change**: Add validation in the `terminal:resize` IPC handler to clamp cols/rows to safe bounds ($\ge 2$ and $\le 1000$):
  ```ts
  ipcMain.handle("terminal:resize", (_event, { sessionId, cols, rows }) => {
    const session = ptyProcesses.get(sessionId);
    if (!session) throw new Error(`Terminal session ${sessionId} is not running.`);
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 2 || rows < 2) {
      return;
    }
    const safeCols = Math.max(2, Math.min(Math.floor(cols), 1000));
    const safeRows = Math.max(2, Math.min(Math.floor(rows), 1000));
    session.process.resize(safeCols, safeRows);
  });
  ```

### Step 4: Configure Theme-Aware 16-Color ANSI Palettes & Typography
- **Target File**: [`src/index.css`](file:///Users/harshithpasupuleti/code/omni/src/index.css)
- **Change**: Define full 16-color ANSI palettes for both light mode (`:root`) and dark mode (`.dark`), along with monospace font variables and line-height constraints for `.wterm`.

---

## 4. Verification & Testing

- **Vitest Suite**: Executed `bun run test` across all 48 test files (301 tests passing).
- **Linter**: Ran `oxlint` with 0 errors.
- **Manual Verification Matrix**:
  - Open terminal tab $\rightarrow$ run commands $\rightarrow$ text stays at top.
  - Switch to Agent / Thread / Diff tab $\rightarrow$ container dimensions remain stable.
  - Switch back to terminal tab $\rightarrow$ rendering, layout, scroll position, and ANSI colors remain crisp and undisturbed.
