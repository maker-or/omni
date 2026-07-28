# Terminal Lifecycle Bug Report

> Root-cause analysis of tab-switch degradation, process-death illusion, and related rendering bugs in the @wterm / Ghostty terminal integration.

---

## TABLE OF CONTENTS

1. [Architecture: How It Works Today](#1-architecture)
2. [Critical Bugs](#2-critical-bugs)
3. [High-Impact Bugs](#3-high-impact-bugs)
4. [Medium Bugs](#4-medium-bugs)
5. [Low / Cosmetic Bugs](#5-low--cosmetic-bugs)
6. [Root Cause Summary](#6-root-cause-summary)

---

## 1. Architecture: How It Works Today

```
Tab Click → workspace-view-store.mode
  ├─ "agent"   → TerminalSession UNMOUNTED (PTY stays alive in main process)
  └─ "terminal" → TerminalSession MOUNTED
                    ├─ GhosttyCore.load() → Ghostty WASM emulator
                    ├─ window.omni.terminal.create() → node-pty in main process
                    ├─ Full history replay via write()
                    └─ Live onData → appendHistory → write() loop
```

**Key files:**

- `src/App.tsx` — routes mode → overlay vs hidden
- `src/components/terminal-session.tsx` — Ghostty + PTY lifecycle
- `src/store/terminal-store.ts` — flat-string history, workspace bucketing
- `src/components/global-tab-bar.tsx` — tab strip, create/close/select
- `electron/main.ts` — IPC handlers, node-pty management
- `electron/preload.ts` — IPC bridge to renderer

---

## 2. Critical Bugs

### CRIT-01: Full VT state loss on every tab switch

**Severity:** Critical
**Files:** `src/App.tsx:867-880`, `src/components/terminal-session.tsx:96-104`

**What happens:**
The terminal view is conditionally rendered — when `mode !== "terminal"`, the entire `TerminalSession` unmounts. On return, a brand-new Ghostty WASM emulator is created and the full `history` string is dumped through `write()`. This is fundamentally incompatible with VT100/xterm semantics for interactive programs.

**Why it breaks:**

- ANSI escape sequences in the replay reference VT state (cursor position, alternate screen buffer, scroll regions, colors) that was set up by live interactive streams.
- Alternate-screen programs (vim, less, htop) leave the emulator in alt-screen mode mid-replay.
- Progress bars, spinners, and overlapping output corrupt when replayed linearly.
- Cursor positioning sequences reposition the "replay cursor" to the wrong location, making subsequent text appear at random screen positions.

**The deeper problem:**
The architecture treats flat-text `history` as a serializable VT emulator state. It is not. A VT emulator is a state machine — replaying ANSI into a fresh instance without the intervening state transitions cannot produce the same visual output.

**Upstream model (wterm docs):**

```
Terminal (persistent instance)
  onData  → backend write
  backend onData → terminal.write(data)  ← live, incremental, same instance
  onResize → backend resize
```

**Omni's actual model:**

```
create PTY → store onData → history string
tab switch → destroy Ghostty
tab return → new Ghostty + write(history)  ← lossy replay
```

---

### CRIT-02: PTY process death masks as a rendering bug

**Severity:** Critical  
**Files:** `src/lib/thread-actions.ts:13-31`, `electron/main.ts:1717-1781`

**What happens:**
Switching from terminal to an agent tab via `selectThread` calls `view.showAgent()` which sets `mode = "agent"`. The `TerminalSession` unmounts, but `window.omni.terminal.kill()` is **never called** on this path. The PTY stays alive in the main process. However, on return, the corrupted replay makes the terminal look dead — garbled output, the wrong prompt, or blank screen.

**User sees:** "My dev server ended when I switched tabs."
**Reality:** Process is still running. `lsof -i :<port>` shows it listening. The UI just can't display its output correctly.

**When it actually does die:**

- Close terminal tab (×): `closeSession` → `kill` — explicit ✓
- Switch workspace: `setWorkspace` kills all PTYs — explicit ✓
- Switch project (triggers workspace change): same path ✓
- Switch to agent thread tab: **no kill** — rendering bug only ✓

---

### CRIT-03: `onExit` message silently lost when process exits while hidden

**Severity:** Critical  
**File:** `src/components/terminal-session.tsx:136-145`

**What happens:**
The `[Process completed]` string is written _client-side_ by the `onExit` callback:

```typescript
const unsubscribeExit = window.omni.terminal.onExit((payload) => {
  if (payload.sessionId === sessionId) {
    write("\r\n[Process completed]\r\n"); // ← client-side string
  }
});

return () => {
  unsubscribeExit(); // ← unsubscribed on unmount
};
```

When the terminal tab is hidden (agent mode), `TerminalSession` unmounts and `unsubscribeExit()` fires. If the shell process exits during this time, the `terminal:exit` IPC event arrives to **no listener**. The `[Process completed]` string is never appended to `history`.

**On return:** The user sees the last shell prompt from `history` replay. A brand-new PTY is spawned (because `ptyProcesses.delete(id)` ran in main.ts:1779 on exit, so `create` doesn't hit the reuse guard). A fresh shell appears with no indication the old one exited.

**Impact:** User can't tell if their `npm run dev` crashed, or if they're looking at a new shell spawned over a dead one. Lost information about background state.

---

### CRIT-04: Flat-string truncation at 100k chars is silent data loss

**Severity:** Critical  
**File:** `src/store/terminal-store.ts:141-153`

**What happens:**
History is capped at 200k chars; when exceeded, only the **last 100k** are kept:

```typescript
let newHistory = s.history + data;
if (newHistory.length > 200000) {
  newHistory = newHistory.slice(newHistory.length - 100000);
}
```

For a Vite dev server producing ~50k chars per compilation, after ~3 rebuilds while the terminal is hidden, the **entire startup log is discarded**. The user returns to find only recent HMR output — no errors from the initial build, no "ready on http://localhost:5173" message.

The truncation is also **character-based, not escape-sequence-aware**. A truncation mid-sequence corrupts everything replayed after that point:

```
\r\n\u001b[1m  VITE v4.5.0  \u001b[22m\r\n\u001b[36mready in 300ms\← MID-TRUNCATION
[garbled output follows]
```

**Report correction:** The report says "200k chars" as the cap and "100k" as the slice. Reading the code: `newHistory.length > 200000` slices to `newHistory.length - 100000`. So the max is 200k, but after a single hit it's 100k, then it grows back toward 200k, gets trimmed to ~100k again, etc. Effective **stable size is ~150k** but every truncation discards 100k of history arbitrarily.

---

### CRIT-05: Store history replay blocks the render thread

**Severity:** Critical  
**File:** `src/components/terminal-session.tsx:96-104`

```typescript
useEffect(() => {
  if (!isReady || !history) return;
  const newText = history.slice(writtenLengthRef.current);
  if (newText) {
    write(newText); // ← synchronous Ghostty WASM write
    writtenLengthRef.current = history.length;
  }
}, [history, isReady, write]);
```

On every tab return, potentially 100k+ chars are written to Ghostty's WASM emulator **synchronously** inside a React effect. Ghostty's `write()` likely processes the entire string through the VT parser synchronously (it's WASM, single-threaded). For large payloads, this freezes the render thread for tens to hundreds of milliseconds.

**Impact:** The tab switch animation stutters, and the UI is unresponsive until the replay finishes. During this freeze, new PTY output is still arriving in the store, which triggers another effect run, extending the freeze.

---

## 3. High-Impact Bugs

### HIGH-01: PTY spawns at 80×24, resized asynchronously on every remount

**Severity:** High  
**File:** `electron/main.ts:1748-1751`

```typescript
ptyProcess = pty.spawn(defaultShell, shellArgs, {
  name: "xterm-256color",
  cols: 80,   // ← always 80
  rows: 24,   // ← always 24
```

On every tab return:

1. Fresh Ghostty emulator mounts
2. `window.omni.terminal.create()` is called → main process checks `ptyProcesses.has(sessionId)` → if PTY exists, **skips** the spawn but the old PTY is already at the correct size from before
3. If PTY was killed (workspace switch, close), a new one spawns at 80×24
4. Ghostty's `autoResize` fires `onResize` asynchronously → `terminal:resize` IPC → PTY resized

**The gap:** Between spawn and the resize IPC, all PTY output is formatted for 80 columns. For a full-width terminal (~150 columns), shell prompts wrap incorrectly, `ls` output is garbled, and dev-server logs have hard linebreaks at col 80. When the resize arrives, content "jumps" to the correct width. Visible flash on every workspace switch.

**Worse:** `autoResize` depends on the container being in the DOM at its final size. The `TerminalSession` component also has a "Measuring layout…" phase (`terminal-session.tsx:47-50`) that delays mount until `ResizeObserver` fires. This adds ~1 frame of delay on top of the resize latency.

---

### HIGH-02: 150ms focus delay eats keystrokes on tab return

**Severity:** High  
**File:** `src/components/terminal-session.tsx:159-167`

```typescript
useEffect(() => {
  if (isReady) {
    const timer = setTimeout(() => {
      ref.current?.focus();
    }, 150); // ← fixed 150ms delay
    return () => clearTimeout(timer);
  }
}, [isReady]);
```

On every tab switch back to terminal, there's a 150ms hardcoded delay before focus is applied. If the user starts typing immediately (muscle memory):

- Keystrokes go to whatever was previously focused (agent composer, search bar, or nothing)
- Those keystrokes are lost for terminal but may trigger hotkeys or type into the composer
- The first 1-3 characters of every terminal command can be silently swallowed

**Root cause:** The `setTimeout` was likely added as a workaround for Ghostty not being ready for input immediately after `onReady`. But 150ms is arbitrary and too long for fast tab-switching users.

---

### HIGH-03: Workspace switch creates new session IDs, causing full remount cycle

**Severity:** High  
**File:** `src/store/terminal-store.ts:119-125`

```typescript
const restored = (nextStash[key] ?? []).map((stashed) => ({
  id: crypto.randomUUID(), // ← NEW ID
  title: stashed.title,
  cwd,
  history: stashed.history,
}));
```

When `setWorkspace` restores stashed terminals, it assigns **new UUIDs** to every session. This means:

1. `activeTerminalId` in the workspace-view store changes to the new ID
2. `key={activeTerminalId}` on `<TerminalSession>` changes → full React remount
3. Fresh Ghostty instance created, full history replayed
4. All terminal tabs in the tab strip get new `key={session.id}` → remount animation

The visual result: on workspace switch, the terminal flickers blank → "Initializing Ghostty Core…" → "Measuring layout…" → history replay. This takes ~200-500ms of visible stutter.

**Why new IDs?** The stash-restore is designed to kill all PTYs on workspace leave and create new ones on return. But this means the terminal can never survive a workspace switch seamlessly — it's always a full destroy-recreate cycle, even if the underlying PTY could theoretically be reused.

---

### HIGH-04: `appendHistory` creates new array identity on every IPC chunk for orphaned sessions

**Severity:** High  
**File:** `src/store/terminal-store.ts:141-153`

```typescript
appendHistory: (id: string, data: string) => {
  set((state) => ({
    sessions: state.sessions.map((s) => {  // ← map always creates new array
      if (s.id !== id) return s;            // ← no-op for non-matching sessions
      // ... mutate matching session
    }),
  }));
},
```

When a PTY produces output after its session has been removed (e.g., SIGTERM hasn't fully killed it yet, or a race between `kill` and final output), `appendHistory` is called with an orphaned session ID. The `map` still creates a **new array reference** with identical elements. Any Zustand selector subscribing to `sessions` re-renders.

**Real scenario:**

1. Close terminal tab → `closeSession` → `kill()` → PTY removed from store
2. PTY outputs final bytes before dying → `onData` → `terminal:data` IPC → `appendHistory`
3. No session matches `id` → `map` returns new array with same contents
4. `GlobalTabBar`'s `terminalTabsKey` selector fires → tab strip re-renders

**Impact:** Unnecessary re-renders of the tab strip and any component subscribed to `sessions`.

---

### HIGH-05: `handleData` and `handleResize` are inline functions, no `useCallback`

**Severity:** High  
**File:** `src/components/terminal-session.tsx:149-156`

```typescript
const handleData = (data: string) => {
  window.omni.terminal.write(sessionId, data);
};

const handleResize = (cols: number, rows: number) => {
  window.omni.terminal.resize(sessionId, cols, rows);
};
```

These are plain arrow functions defined every render of `TerminalInner`. They are passed as props to `<Terminal>`:

```typescript
<Terminal
  ref={ref}
  core={core}
  autoResize={true}
  onData={handleData}      // ← new reference every render
  onResize={handleResize}  // ← new reference every render
  onReady={() => setIsReady(true)}  // ← also new every render
```

Every render of `TerminalInner` (triggered by `history` changes, i.e., every PTY output chunk) creates new function references for `onData`, `onResize`, and `onReady`. The `<Terminal>` component likely uses referential equality on these callbacks — every output chunk causes the `<Terminal>` internal handlers to be re-attached.

**Impact:** Each chunk of PTY output causes unnecessary internal work inside `@wterm/react`.

---

## 4. Medium Bugs

### MED-01: `resize` is fire-and-forget — renderer never knows if it succeeded

**Severity:** Medium  
**File:** `electron/preload.ts:327-328`

```typescript
resize: (sessionId: string, cols: number, rows: number): void =>
  ipcRenderer.send("terminal:resize", { sessionId, cols, rows }),
```

Uses `ipcRenderer.send` (fire-and-forget) instead of `ipcRenderer.invoke`. The main process catches and logs resize errors (main.ts:1801), but the renderer has no feedback path. If the PTY was killed between the last render and this resize, the resize silently fails. Ghostty's `autoResize` will keep firing, but the PTY won't respond.

The same pattern applies to `terminal:write` (preload.ts:325-326).

---

### MED-02: `GhosttyCore.load()` called on every mount with no dedup window

**Severity:** Medium  
**File:** `src/components/terminal-session.tsx:76-94`

```typescript
GhosttyCore.load({ wasmPath: "./ghostty-vt.wasm" }).then((loadedCore) => {
  if (active) {
    setCore(loadedCore);
  }
});
```

`GhosttyCore.load()` is called on every `TerminalInner` mount. It likely returns a cached singleton internally, but the promise chain and `setCore` still run on every mount. On rapid tab switching (A → B → A), multiple `GhosttyCore.load()` calls may be in flight simultaneously. The `active` guard prevents double `setCore`, but the WASM compilation could be triggered multiple times.

**Risk:** If `GhosttyCore.load()` is NOT a singleton, each tab switch loads and initializes a new WASM instance, wasting memory and CPU. This depends on `@wterm/ghostty`'s implementation.

---

### MED-03: `handleCloseTerminal` has no guard against rapid double-close

**Severity:** Medium  
**File:** `src/components/global-tab-bar.tsx:502-509`

```typescript
const handleCloseTerminal = (id: string) => {
  const wasActiveTerminal = mode === "terminal" && activeTerminalId === id;
  closeSession(id);
  if (!wasActiveTerminal) return;
  const next = useTerminalStore.getState().activeSessionId;
  if (next) showTerminal(next);
  else showAgent();
};
```

Compare with `handleCloseThreadTab` which has a `closingTabIdsRef` guard (line 366-368):

```typescript
const handleCloseThreadTab = async (id: string) => {
  if (closingTabIdsRef.current.has(id)) return;
  closingTabIdsRef.current.add(id);
  // ...
};
```

`handleCloseTerminal` has **no debounce or re-entrancy guard**. If the user rapidly clicks the close button twice:

1. First call: `closeSession(id)` removes session, sets `activeSessionId` to next
2. Second call: `closeSession(id)` finds no matching session (already removed), filtered sessions are identical, `activeSessionId` (already changed) is unchanged by the guard `if (activeSessionId === id)` — this is `false` since active is now the next session. The second call is effectively a no-op.

But: `window.omni.terminal.kill(id)` is called **twice**. The second call is a no-op on the main process side (`ptyProcesses.get(id)` returns `undefined` after first kill deleted it). The second `set()` in Zustand sets the same state. So double-close is safe but wasteful.

---

### MED-04: No visual indicator for dead/hidden terminals

**Severity:** Medium  
**File:** `src/components/global-tab-bar.tsx:606-617`

Terminal tabs always show a `TerminalWindowIcon` with no state indicators:

```typescript
<TabItem
  key={session.id}
  value={`${TERMINAL_TAB_PREFIX}${session.id}`}
  label={session.title}
  icon={TerminalWindowIcon}    // ← always the same icon
  onClose={() => handleCloseTerminal(session.id)}
/>
```

Agent thread tabs have `TabWorkingIcon` (a spinner, via `runningThreadIds`). Terminals have no equivalent for:

- Process exited (dead shell)
- Dev server crashed while hidden
- High output rate (scrolling indicator)

**Impact:** User can't tell from the tab strip if their dev server is still alive without switching to the terminal tab. Combined with CRIT-03 (lost `onExit`), a dead process is invisible.

---

### MED-05: `setActiveSessionId` called redundantly in `handleSelectTerminal`

**Severity:** Medium  
**File:** `src/components/global-tab-bar.tsx:490-493`

```typescript
const handleSelectTerminal = (id: string) => {
  setActiveSessionId(id); // ← already matches if terminal was active
  showTerminal(id);
};
```

`showTerminal` already sets `activeTerminalId` in the workspace-view store. But this `setActiveSessionId` sets a **different** field — the terminal store's `activeSessionId`. These two values can desynchronize:

- `workspace-view-store.activeTerminalId`: which session is currently visible
- `terminal-store.activeSessionId`: which session "would be active" if terminal mode were active

The redundant `setActiveSessionId` isn't harmful, but the dual-source-of-truth is confusing. If `activeSessionId` is changed by `closeSession` but `activeTerminalId` isn't updated (e.g., closing a background terminal tab), the next `handleSelectTerminal` fixes the sync. But there's a brief window where they disagree.

---

## 5. Low / Cosmetic Bugs

### LOW-01: "Measuring layout…" flash on every terminal mount

**File:** `src/components/terminal-session.tsx:43-53`

```typescript
return (
  <div ref={containerRef} className="h-full w-full overflow-hidden">
    {dimensions ? (
      <TerminalInner sessionId={sessionId} cwd={cwd} />
    ) : (
      <div className="...">Measuring layout…</div>
    )}
  </div>
);
```

Every tab return shows "Measuring layout…" for ~1 frame while `ResizeObserver` fires. Combined with "Initializing Ghostty Core…" (rendered inside `TerminalInner`), the terminal is blank for 2-3 frames on every switch.

---

### LOW-02: `ghostty-vt.wasm` path is hardcoded with no fallback

**File:** `src/components/terminal-session.tsx:78`

```typescript
GhosttyCore.load({ wasmPath: "./ghostty-vt.wasm" });
```

This path is relative to the HTML entry point. In Electron, that's `file://` to the `dist/` directory. In dev mode (Vite), it's a dev server URL. If the WASM file is missing or at the wrong path, the error is caught and displayed, but recovery requires a full remount (tab switch). No retry logic.

---

### LOW-03: Multiple `TerminalSession` render cycles during mount

**File:** `src/components/terminal-session.tsx`

Mount sequence:

1. `TerminalSession` mounts → shows "Measuring layout…"
2. `ResizeObserver` fires → `dimensions` set → `TerminalInner` mounts
3. `TerminalInner` mounts → `GhosttyCore.load()` starts → shows "Initializing Ghostty Core…"
4. `GhosttyCore.load()` resolves → `core` set → `<Terminal>` mounts with `core`
5. `<Terminal>` mounts → WASM initializes → `onReady` fires → `isReady = true`
6. `useEffect` at line 107 fires: `if (!core || !isReady) return` → passes → calls `create`
7. `useEffect` at line 97 fires: history replay via `write()`

**Total renders between mount and live:** 5-7 React renders. Each is fast (<1ms), but the cumulative effect is visible as a stutter on tab switch.

---

### LOW-04: `electron/main.ts` `ptyProcess.onData` listener accumulates on multi-spawn

**File:** `electron/main.ts:1765-1769`

```typescript
ptyProcess.onData((data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("terminal:data", { sessionId, data });
  }
});
```

For **ACP agent terminals** (managed by `TerminalManager` in `agent-connection-manager.ts`), the renderer-managed PTY system in main.ts has a parallel `ptyProcesses` map. These are two independent terminal systems sharing the same IPC channel. There's no conflict (different session IDs), but the separation is unclear and could lead to confusion if a renderer session ID collides with an ACP session ID.

---

### LOW-05: Zustand selector recreates `terminalTabsKey` on every history change

**File:** `src/components/global-tab-bar.tsx:102-114`

```typescript
const terminalTabsKey = useTerminalStore((state) =>
  state.sessions.map((session) => `${session.id}\t${session.title}`).join("\n"),
);
```

This selector is a derived string that changes only when sessions are added/removed/renamed — not on every `appendHistory` call. The comment on line 96-101 explains this is intentional: `sessions` gets a new identity on every `appendHistory` (because `set((state) => ({ sessions: state.sessions.map(...) }))` creates a new array), but since `state` is a new object on every Zustand `set`, the selector is called on every store change. However, the resulting string only changes when session count or title changes. Zustand's `useStore` with a selector does a shallow comparison of the returned value, so this is fine.

**But**: the `map` + `join` runs on every `appendHistory` call — that's every PTY output chunk. For 10 terminal sessions, this is 10 string concatenations per chunk. Negligible overhead, but unnecessary work.

---

## 6. Root Cause Summary

| ID      | Root Cause                                                 | Location                     | Symptom                                         |
| ------- | ---------------------------------------------------------- | ---------------------------- | ----------------------------------------------- |
| CRIT-01 | Terminal UI unmounted on agent tab switch                  | App.tsx:867-880              | VT state lost; full remount on return           |
| CRIT-01 | History is flat-string replay, not persistent VT           | terminal-session.tsx:96-104  | Garbled/corrupt render for interactive programs |
| CRIT-02 | No kill on selectThread                                    | thread-actions.ts:15         | Process looks dead, UI broken                   |
| CRIT-03 | onExit subscribed in mount effect, unsubscribed on unmount | terminal-session.tsx:136-145 | Process exit while hidden is invisible          |
| CRIT-04 | Character-based truncation at 100k-200k                    | terminal-store.ts:146-148    | Silent data loss + ANSI corruption              |
| CRIT-05 | Synchronous write() in render effect for large payloads    | terminal-session.tsx:100-101 | Render thread freeze on tab return              |
| HIGH-01 | PTY always spawns at 80×24                                 | main.ts:1748-1751            | Width flash on every spawn                      |
| HIGH-02 | 150ms setTimeout for focus                                 | terminal-session.tsx:161     | Keystrokes lost on fast tab return              |
| HIGH-03 | Workspace restore creates new UUIDs                        | terminal-store.ts:119-125    | Full remount on workspace switch                |
| HIGH-04 | appendHistory creates new array for orphan sessions        | terminal-store.ts:141-153    | Unnecessary re-renders                          |
| HIGH-05 | Inline callbacks recreate on every render                  | terminal-session.tsx:149-156 | Unnecessary <Terminal> internal work            |
| MED-01  | send() not invoke() for resize/write                       | preload.ts:325-328           | Silent failures                                 |
| MED-02  | GhosttyCore.load() per mount                               | terminal-session.tsx:78      | Potential duplicate WASM init                   |
| MED-04  | No dead/alive indicator for terminal tabs                  | global-tab-bar.tsx:606       | Hidden process death invisible                  |
| MED-05  | Dual source of truth for active terminal ID                | global-tab-bar.tsx:491       | Desync window between stores                    |

---

## Recommended Fix Priorities

### P0 (Must fix — shipping block):

1. **Keep terminal emulators alive while hidden** (CRIT-01) — mirror AgentView's persistent mount pattern. Use `display: none` / `visibility: hidden` instead of conditional render. Ghostty should never be destroyed on tab switch.

2. **Stop flat-string replay as the rendering source of truth** (CRIT-01, CRIT-05) — IPC `onData` → `write()` directly while visible. Store history becomes optional/metadata. For crash recovery, accept that full VT fidelity isn't possible and use a plain `<pre>` scrollback.

3. **Fix `onExit` subscription lifecycle** (CRIT-03) — either keep the `onExit` handler at the global level (not per-mount) so exit messages are always captured, or buffer the exit event in the store so it persists across remounts.

### P1 (High user-visible impact):

4. **Remove 150ms focus delay** (HIGH-02) — replace with a 0-delay or use `requestAnimationFrame` instead of fixed timeout.

5. **Fix initial PTY size** (HIGH-01) — send the correct dimensions as part of `terminal:create` instead of spawning at 80×24, or pass them in the IPC payload so the main process can `resize` immediately after `spawn`.

6. **Wrap `handleData`/`handleResize` in `useCallback`** (HIGH-05) — stop recreating callbacks on every PTY chunk.

### P2 (Correctness):

7. **Truncate at escape-sequence boundaries** (CRIT-04) — or switch to line-count capping. Never replay truncated ANSI into Ghostty.

8. **Preserve session IDs across workspace stashes** (HIGH-03) — keep the same UUID so React keys are stable and remount isn't forced.

9. **Add process-death visual to terminal tabs** (MED-04) — check exit status in the store and show a gray/dim/danger icon.

### P3 (Polish):

10. **"Measuring layout…" and "Initializing Ghostty Core…" flashes** (LOW-01, LOW-03) — pre-warm the container or skip the loading states.

---

---

# Additional Bugs — Deep Code Review Pass

> The following 15 bugs were discovered through a second deep-dive code review and are **not** covered by the sections above. They span the terminal subsystem, tab/thread management, workspace switching, and cross-cutting state issues.

---

## 7. Additional Critical Bugs

### CRIT-06: Terminal output permanently freezes after history truncation

**Severity:** Critical
**Files:** `src/components/terminal-session.tsx:96-104`, `src/store/terminal-store.ts:146-148`

**What happens:**
`TerminalInner` uses `writtenLengthRef.current` to track how much of the store's `history` string has already been sent to Ghostty. When the history exceeds 200k characters, `appendHistory` truncates it to the last 100k characters. However, `writtenLengthRef.current` is **never reset** — it stays at ~200k.

On the next render cycle:

```
history.slice(writtenLengthRef.current)  →  history.slice(200000)
// But history.length is now ~100k → returns ""
// Empty string → writtenLengthRef is never updated → permanent dead loop
```

**User sees:** A verbose dev server (Vite, webpack, Next.js) produces enough output to hit the 200k cap while the terminal is **visible** — the terminal screen permanently freezes. No new output ever appears. The user must switch tabs away and back (causing a full remount) to see output again, and even then the problem repeats on the next truncation.

**The deeper problem:** `writtenLengthRef` is an absolute index into the history string, but truncation silently shifts the string's coordinate system. There is no reconciliation between the two.

---

### CRIT-07: Unhandled `write()` exception crashes the entire Electron app

**Severity:** Critical
**File:** `electron/main.ts:1783-1791`

**What happens:**
The `terminal:write` IPC handler calls `ptyProcess.write(data)` with **no `try/catch`** wrapper:

```typescript
ipcMain.on("terminal:write", (_event, { sessionId, data }) => {
  const ptyProcess = ptyProcesses.get(sessionId);
  if (ptyProcess) {
    ptyProcess.write(data); // ← unguarded
  }
});
```

Compare with `terminal:resize` (line 1798) and `terminal:kill` (line 1810), which both have `try/catch`. If the PTY process has just died and its pipe is broken, `node-pty`'s `write()` throws a synchronous exception (e.g., `Error: socket is closed`).

**User sees:** Typing a keystroke at the exact moment a background shell dies crashes the **entire Electron main process**, instantly terminating the app with no save/recovery.

---

### CRIT-08: Closing a background terminal creates a zombie PTY with no UI

**Severity:** Critical
**Files:** `src/store/terminal-store.ts:64-82`, `src/components/global-tab-bar.tsx:502-509`, `src/store/workspace-view-store.ts:39`

**What happens:**
When the app is in `"agent"` mode, `workspace-view-store.activeTerminalId` still holds the ID of the last-viewed terminal. If the user closes this specific terminal from the tab strip:

1. `handleCloseTerminal` calls `closeSession(id)` — session removed from terminal store
2. Because `mode !== "terminal"`, the guard `wasActiveTerminal` is `false` — early return
3. `workspace-view-store.activeTerminalId` is **never cleared** — still points to the deleted ID

When the user later switches to terminal mode:

- `showTerminalView` resolves to `false` because `hasActiveTerminal` is `false` (session gone from store)
- But `activeTerminalId` is stale — any code reading it outside the conditional render gets a dangling reference
- If `TerminalSession` did somehow mount with the stale ID, it would call `create()` and spawn a new PTY that has no corresponding store entry — all `onData` output is silently dropped by `appendHistory`

**User sees:** Terminal mode shows a blank screen or inconsistent state after closing the last-viewed terminal while in agent mode.

---

### CRIT-09: Thread switch error silently swallowed — caller never knows it failed

**Severity:** Critical
**Files:** `src/lib/thread-actions.ts:21-30`, `src/store/agent-store.ts:838-848`

**What happens:**
`selectThread()` wraps `switchThread(id)` in a try/catch, expecting errors to propagate. But `switchThread` internally chains the operation onto `threadSwitchQueue` with its own `.catch()`:

```typescript
// agent-store.ts:838-848
.catch((err) => {
  set(() => {
    // ... sets store error field
    return { error: err.message };
  });
  // ← does NOT re-throw! Promise resolves successfully
});
```

The error is caught and converted to a store state update, but the `.catch()` doesn't re-throw. The `await threadSwitchQueue` in `selectThread` resolves successfully. The `try/catch` in `selectThread` never triggers.

**User sees:** Thread switch failures are invisible to calling code. Any flow relying on `selectThread` throwing (error toasts, rollbacks, retry logic) silently assumes success and proceeds in a corrupted state.

---

## 8. Additional High-Impact Bugs

### HIGH-06: Closing/deleting an agent tab yanks user out of terminal mode

**Severity:** High
**Files:** `src/components/global-tab-bar.tsx:374`, `src/components/global-tab-bar.tsx:420`, `src/lib/thread-actions.ts:15`

**What happens:**
When a user deletes or closes an agent thread tab, the handler selects the next available thread by calling `selectThread()`. But `selectThread` **unconditionally** calls `view.showAgent()` on line 15, regardless of what mode the user is currently in.

```typescript
export async function selectThread(id: string): Promise<void> {
  const view = useWorkspaceViewStore.getState();
  view.showAgent(); // ← always, even if user is in terminal mode
  // ...
}
```

**User sees:** While watching a dev server in terminal mode, closing a background agent tab violently switches the view to the agent panel. Extremely disorienting during active terminal work.

---

### HIGH-07: Closing the last agent tab with terminals open shows blank screen

**Severity:** High
**File:** `src/components/global-tab-bar.tsx:372-375`

**What happens:**
When `handleCloseThreadTab` closes the last agent tab, `nextState.activeThreadId` is `null`, so it calls `requestThread(null)`. But it doesn't check if terminal tabs exist or switch `WorkspaceMode` to `"terminal"`:

```typescript
if (nextState.activeThreadId) await handleSelectThread(nextState.activeThreadId);
else requestThread(null); // ← stays in "agent" mode, no fallback to terminal
```

**User sees:** If terminal tabs are still open, the user sees a blank/broken agent view instead of being gracefully redirected to the terminal.

---

### HIGH-08: Stale `activeTerminalId` persists across workspace switches

**Severity:** High
**Files:** `src/App.tsx:400-404`, `src/store/workspace-view-store.ts:39`

**What happens:**
When switching workspaces, `App.tsx` only updates `activeTerminalId` if the user was in terminal mode (`wasTerminalActive`). If they were in agent mode, the old `activeTerminalId` — pointing to a session from the _previous_ workspace that was just killed — is left dangling:

```typescript
const wasTerminalActive = view.mode === "terminal";
const newActiveId = terminals.setWorkspace(key, selectedWorktreePath);
if (wasTerminalActive) {
  if (newActiveId) view.showTerminal(newActiveId);
  else view.showAgent();
}
// ← if mode was "agent", activeTerminalId is NEVER updated
```

**User sees:** After a workspace switch, switching to terminal mode may show stale data or a blank screen because `activeTerminalId` references a killed session.

---

### HIGH-09: Leaking `setTimeout` on PTY creation failure

**Severity:** High
**File:** `src/components/terminal-session.tsx:131, 143`

**What happens:**
When `terminal.create()` fails, the `.catch()` schedules a `closeSession` call via `window.setTimeout(() => closeSession(sessionId), 1200)`. This timeout ID is never captured or cleared in the `useEffect` cleanup:

```typescript
.catch((err) => {
  // ...
  window.setTimeout(() => closeSession(sessionId), 1200);  // ← fire-and-forget
});

return () => {
  unsubscribeExit();  // ← setTimeout not cleaned up here
};
```

**User sees:** If the user manually closes the errored tab before 1.2 seconds, the leaked timeout fires and calls `closeSession` on a session that was already removed — or worse, on a new session that reused the same array slot.

---

### HIGH-10: Missing `isMounted` guard on `create()` rejection path

**Severity:** High
**File:** `src/components/terminal-session.tsx:120-132`

**What happens:**
The `GhosttyCore.load()` effect correctly uses an `active` flag to guard against unmounted updates. But the `terminal.create()` promise rejection handler has no such guard — it calls `write()` and `closeSession()` even if the component has already unmounted:

```typescript
.catch((err) => {
  setError(err instanceof Error ? err.message : String(err));  // ← no mount check
  write(`\r\nError: ...`);  // ← may call on destroyed Ghostty
  window.setTimeout(() => closeSession(sessionId), 1200);
});
```

**User sees:** Rapidly switching tabs while PTY creation is in flight and it fails can throw a renderer exception from calling `write()` on a destroyed Ghostty instance, logging React errors about unmounted updates.

---

## 9. Additional Medium Bugs

### MED-06: `closingTabIdsRef` leaks IDs, permanently preventing tab closure

**Severity:** Medium
**File:** `src/components/global-tab-bar.tsx:377-380`

**What happens:**
`handleCloseThreadTab`'s `finally` block intentionally skips removing an ID from `closingTabIdsRef` if it matches the current snapshot's thread ID:

```typescript
finally {
  if (id !== useAgentStore.getState().snapshot?.threadId) {
    closingTabIdsRef.current.delete(id);
  }
}
```

This assumes `handleSelectThread` will eventually clear it. But if the thread is re-opened via an external mechanism (broadcast, Pipper overlay, deep link) that bypasses `handleSelectThread`, the ID remains permanently in the Set.

**User sees:** The user can never close that tab again — clicking ✕ silently does nothing because `closingTabIdsRef.current.has(id)` returns `true` at line 367.

---

### MED-07: Thread store pagination corruption on delete

**Severity:** Medium
**File:** `src/store/thread-store.ts:137-152`

**What happens:**
When a thread is deleted, the code unconditionally decrements `nextOffset` by 1:

```typescript
nextOffset: Math.max(0, (state.pagesByProject[existingThread.project_id]?.nextOffset ?? 0) - 1),
```

But `addThread()` (line 163) does **not** increment `nextOffset`. So if a thread was locally added and then deleted, the offset goes negative (clamped to 0), causing the next page fetch to re-fetch already-loaded threads.

Worse: if `pagesByProject` doesn't yet have an entry for the project, the fallback creates a malformed entry with `nextOffset: 0, hasMore: false`, permanently preventing thread loading for that project.

**User sees:** Broken thread pagination — duplicated threads, skipped items, or being completely unable to load threads for a project.

---

### MED-08: Infinite thread load retry on backend error

**Severity:** Medium
**File:** `src/store/thread-store.ts:96-108`

**What happens:**
If `listProject` throws, the catch block unconditionally sets `hasMore: true`:

```typescript
catch (err) {
  set((state) => ({
    error: err instanceof Error ? err.message : "Failed to load threads",
    pagesByProject: {
      ...state.pagesByProject,
      [projectId]: { nextOffset: offset, hasMore: true, isLoading: false },
    },
  }));
}
```

**User sees:** If the backend is down or returning errors, `hasMore: true` tells the UI there are more threads to load. Any auto-loading or "Load More" logic retries forever, flooding the console with errors and wasting network/CPU.

---

### MED-09: Terminal naming collision after close/create cycles

**Severity:** Medium
**File:** `src/store/terminal-store.ts:53-54`

**What happens:**
Terminal titles are based on the current `sessions.length`, not a monotonically increasing counter:

```typescript
const sessionCount = get().sessions.length + 1;
const title = `Terminal ${sessionCount}`;
```

**User sees:** If the user has "Terminal 1" and "Terminal 2", closes "Terminal 1", and creates a new terminal, array length is 1 → new terminal is named "Terminal 2". Two tabs are now labeled "Terminal 2", making them impossible to distinguish.

---

### MED-10: Workspace branch switch kicks user out of terminal mode

**Severity:** Medium
**File:** `src/App.tsx:402-404`

**What happens:**
When switching branches/worktrees, if the target workspace has no stashed terminals (`newActiveId` is null), the code calls `view.showAgent()`:

```typescript
if (wasTerminalActive) {
  if (newActiveId) view.showTerminal(newActiveId);
  else view.showAgent(); // ← forces agent mode
}
```

**User sees:** Users who primarily work in the terminal are yanked to agent mode when switching to a branch that has no stashed terminal sessions, even if they'd prefer to stay in terminal mode.

---

### MED-11: Panel layout snap-back destroys user's manual resizing

**Severity:** Medium
**File:** `src/App.tsx:320-338`

**What happens:**
The layout effect uses hardcoded percentages and fires every time `showFileTreePanel` or `showDiffSplit` toggles:

```typescript
const layout = showFileTreePanel
  ? showDiffSplit
    ? { files: 15, agent: 34, diff: 51 } // ← hardcoded
    : { files: 15, agent: 85 } // ← hardcoded
  : showDiffSplit
    ? { agent: 40, diff: 60 } // ← hardcoded
    : { agent: 100 }; // ← hardcoded
```

**User sees:** Any manual panel resizing the user has done (dragging the file tree wider, adjusting the diff split) is instantly destroyed when toggling the file tree or diff panel. The layout snaps back to hardcoded defaults.

---

## Updated Root Cause Summary (New Bugs)

| ID      | Root Cause                                               | Location                     | Symptom                                         |
| ------- | -------------------------------------------------------- | ---------------------------- | ----------------------------------------------- |
| CRIT-06 | `writtenLengthRef` not reset on history truncation       | terminal-session.tsx:96-104  | Terminal output permanently freezes             |
| CRIT-07 | Missing try/catch on `ptyProcess.write()`                | main.ts:1783-1791            | App crash on keystroke during PTY death         |
| CRIT-08 | `activeTerminalId` not cleared on background close       | global-tab-bar.tsx:502-509   | Zombie PTY, blank terminal screen               |
| CRIT-09 | `.catch()` doesn't re-throw in `switchThread`            | agent-store.ts:838-848       | Thread switch failures invisible                |
| HIGH-06 | `selectThread` unconditionally calls `showAgent()`       | thread-actions.ts:15         | Terminal mode interrupted by agent tab ops      |
| HIGH-07 | No terminal fallback on last agent tab close             | global-tab-bar.tsx:372-375   | Blank agent view with terminals available       |
| HIGH-08 | `activeTerminalId` not updated in agent mode             | App.tsx:400-404              | Stale terminal reference after workspace switch |
| HIGH-09 | `setTimeout` not captured/cleared in cleanup             | terminal-session.tsx:131     | Leaked timer mutates store post-close           |
| HIGH-10 | No `isMounted` guard on create rejection                 | terminal-session.tsx:126-132 | Renderer exception on rapid tab switch          |
| MED-06  | `closingTabIdsRef` never cleaned for re-opened tabs      | global-tab-bar.tsx:377-380   | Tab permanently unclosable                      |
| MED-07  | Pagination offset decremented without matching increment | thread-store.ts:137-152      | Duplicate/missing threads in list               |
| MED-08  | `hasMore: true` set unconditionally on error             | thread-store.ts:96-108       | Infinite retry loop on backend failure          |
| MED-09  | Title based on `sessions.length`, not max counter        | terminal-store.ts:53-54      | Duplicate terminal tab names                    |
| MED-10  | Forced `showAgent()` when target has no terminals        | App.tsx:402-404              | Mode change on branch switch                    |
| MED-11  | Hardcoded panel percentages on every toggle              | App.tsx:320-338              | User resize destroyed on panel toggle           |

---

## Updated Fix Priorities (New Bugs)

### P0 (Must fix — shipping block):

11. **Guard `ptyProcess.write()` with try/catch** (CRIT-07) — mirror the existing pattern in `terminal:resize` and `terminal:kill`. A single missing try/catch can crash the entire app.

12. **Reset `writtenLengthRef` on history truncation** (CRIT-06) — detect when `history.length < writtenLengthRef.current` and reset the ref to 0 to trigger a full re-write, or use a generation counter to detect truncation.

13. **Clear `activeTerminalId` when the referenced session is closed** (CRIT-08) — `closeSession` or `handleCloseTerminal` must update `workspace-view-store.activeTerminalId` when the closed session was the active one, regardless of current mode.

### P1 (High user-visible impact):

14. **Make `selectThread` mode-aware** (HIGH-06) — only call `showAgent()` if the user is not in terminal mode, or let the caller decide whether to switch modes.

15. **Fall back to terminal tabs when last agent tab is closed** (HIGH-07) — if terminal sessions exist, switch to the first terminal instead of showing a blank agent view.

16. **Update `activeTerminalId` on workspace switch regardless of mode** (HIGH-08) — always sync the workspace-view store's terminal ID when `setWorkspace` runs.

17. **Re-throw errors in `switchThread`'s `.catch()`** (CRIT-09) — or restructure so `selectThread` reads the store error after await instead of relying on exception propagation.

### P2 (Correctness):

18. **Clean up `setTimeout` in create failure path** (HIGH-09, HIGH-10) — capture the timeout ID and clear it in the effect cleanup; add an `isMounted` guard matching the pattern used by `GhosttyCore.load()`.

19. **Fix thread pagination offset accounting** (MED-07) — either increment `nextOffset` in `addThread` or don't decrement it in `deleteThread`.

20. **Preserve `hasMore` state on load error** (MED-08) — use the previous `hasMore` value instead of unconditionally setting `true`.

### P3 (Polish):

21. **Use a monotonic counter for terminal names** (MED-09) — track a `nextSessionNumber` in the store instead of using `sessions.length`.

22. **Persist user panel sizes** (MED-11) — read current layout before applying defaults, or store user-adjusted percentages and restore them.
