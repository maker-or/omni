# Adversarial Quality Review Report — ARCHITECTURE_MAP.md

**Reviewer**: Reviewer 2 (Adversarial Quality Reviewer)  
**Target Document**: `/Users/harshithpasupuleti/code/omni/ARCHITECTURE_MAP.md`  
**Target Codebase**: `/Users/harshithpasupuleti/code/omni`  
**Date**: July 21, 2026

---

## Executive Summary

**Verdict**: **APPROVE** (with 2 minor documentation correction suggestions)

An exhaustive adversarial review was conducted on `/Users/harshithpasupuleti/code/omni/ARCHITECTURE_MAP.md` against the actual codebase. All 111 Request-Response/One-Way IPC channels, 21 Main-to-Renderer push events, 4 Mermaid diagrams, 13 Zustand stores in `src/store/`, and 5 core entry points (`electron/main.ts`, `electron/preload.ts`, `src/main.tsx`, `src/launch.tsx`, `src/App.tsx`) were systematically verified.

No integrity violations, hallucinated channels, missing main process handlers, or Mermaid syntax errors were detected. Two minor documentation typos/subtotal miscounts were identified in Section 4.1 tables.

---

## 1. Subsystem Verification Details

### 1.1 IPC Channels & Preload Contract Verification

- **Request-Response & One-Way Channels**: All 111 IPC channels listed in Section 4.1 were mapped to `electron/preload.ts` and `electron/main.ts`. Every `ipcRenderer.invoke` and `ipcRenderer.send` call in preload has a corresponding `ipcMain.handle` or `ipcMain.on` in `electron/main.ts`.
- **Main-to-Renderer Push Events**: All 21 push events listed in Section 4.2 were verified against `electron/preload.ts` listener hooks (`on*` methods) and `webContents.send` invocations in `electron/main.ts`.
- **Return Types & Parameter Signatures**: Verified across contract definitions in `contracts/` (e.g. `Worktree`, `GitBranch`, `UpdateState`, `AcpSessionState`, `LauncherUpdateState`). Return types match implementation signatures.

### 1.2 Mermaid Diagram Validation

- **Diagram 1 (High-Level Process Architecture)**: `graph TD`. Valid syntax. Accurately details Electron Main process subsystems (`db.ts`, `agent-connection-manager.ts`, `subagent-manager.ts`, `node-pty`, `electron/mcp/`), Preload isolation boundary, 3 Chromium renderer windows (`mainWindow`, `launchWindow`, `companionWindow`), and external processes (`ACP_AGENTS`, `PTY_SHELLS`, `MCP_SERVERS`).
- **Diagram 2 (IPC & Data Flow Architecture)**: `sequenceDiagram`. Valid syntax. Accurately traces flow from Renderer UI -> Zustand Store -> Preload Bridge -> Main Process -> Subprocess (std I/O) -> Push Events -> Store / TanStack Query -> UI re-render.
- **Diagram 3 (Provider Hierarchy & Layout Tree)**: `graph TD`. Valid syntax. Conforms directly to `src/main.tsx` (`ErrorBoundary` -> `AppQueryProvider` -> `ThemeProvider` -> `IconProvider` -> `App`) and `src/launch.tsx` (`ThemeProvider` -> `SurfaceProvider` -> `ShapeProvider` -> `IconProvider` -> `LaunchApp`).
- **Diagram 4 (State Management & ACP/PTY Data Lifecycle)**: `flowchart TD`. Valid syntax. Correctly models event processing from input sources through main handlers, IPC broadcast, Zustand store ingestion, TanStack Query cache patching, and reactive UI components.

### 1.3 Zustand 13-Store Catalog Verification

Verified all 13 Zustand store files in `src/store/`:

1. `agent-store.ts` — verified direct TanStack Query cache patching (`OPEN_TABS_QUERY_KEY`) on session title events.
2. `project-store.ts` — verified active project tracking and SQLite sync.
3. `worktree-store.ts` — verified worktree and branch selection map sync.
4. `workspace-view-store.ts` — verified mode routing (`"agent"` vs `"terminal"`) and `useIsDiffSplit()`.
5. `terminal-store.ts` — verified scrollback log buffer cap at 200,000 characters (`appendHistory`) and `makeWorkspaceKey`.
6. `agent-terminal-store.ts` — verified agent terminal output buffering.
7. `diff-store.ts` — verified tool call diff ingestion via `<DiffIngestor />`.
8. `thread-store.ts` — verified project thread list management and pagination.
9. `continuation-store.ts` — verified `/continue` command transcript stashing.
10. `agent-registry-store.ts` — verified ACP agent descriptors and binary probe state.
11. `pipper-store.ts` — verified visual editor mode transitions and comment tags.
12. `update-store.ts` — verified workspace code update state machine.
13. `launcher-update-store.ts` — verified Electron app installer update state machine.

### 1.4 Main Entry Points Verification

- `electron/main.ts`: Verified `mainWindow` (1280x800, min 720x480), `launchWindow` (960x720, min 640x560), `companionWindow` (400x640, min 320x480). Verified `webPreferences` (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`), and `setWindowOpenHandler` URL security checks.
- `electron/preload.ts`: Verified `contextBridge.exposeInMainWorld("omni", api)` context boundary.
- `src/main.tsx` & `src/launch.tsx`: Verified entry point rendering and provider stacks.
- `src/App.tsx`: Verified window header frame (`-webkit-app-region: drag`), `react-resizable-panels` 40:60 split layout, `z-30` terminal overlay, and `CompanionView` routing.

---

## 2. Findings & Discrepancies

### [Minor] Finding 1: Preload API Method Name Mismatch

- **Location**: `ARCHITECTURE_MAP.md` Section 4.1, Table 5, Row 4 (`launch:isWorkspaceReady`).
- **Issue**: The table lists the Preload API method as `omni.launch.isWorkspaceReady()`.
- **Actual Code**: In `electron/preload.ts` (line 62), the method exposed on `omni.launch` is `isReady()`, i.e., `omni.launch.isReady()`.
- **Suggested Fix**: Update `omni.launch.isWorkspaceReady()` in Table 5 to `omni.launch.isReady()`.

### [Minor] Finding 2: Subtotal Header Miscounts in Section 4.1

- **Location**: `ARCHITECTURE_MAP.md` Section 4.1, Table headers 5 and 9.
- **Issue**:
  - Table 5 header states `(shell:*, launch:*, companion:* — 9 channels)`, but the table actually lists 10 rows (`shell:1`, `launch:4`, `companion:3`, `onboarding:2`). Note that `onboarding:*` channels were included in table 5 but omitted from the header category title.
  - Table 9 header states `(theme:*, editor:*, analytics:*, pipper:* — 17 channels)`, but the table actually lists 16 rows (`theme:2`, `editor:6`, `analytics:1`, `pipper:7`).
- **Suggested Fix**: Update Table 5 header to `(shell:*, launch:*, companion:*, onboarding:* — 10 channels)` and Table 9 header to `(theme:*, editor:*, analytics:*, pipper:* — 16 channels)`. (Note: The grand total of 111 channels across all 9 tables is correct: 13+13+6+6+10+11+25+11+16 = 111).

---

## 3. Verified Claims Matrix

| Claim in ARCHITECTURE_MAP.md                           | Verification Method                                                        | Status                    |
| ------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------- |
| 111 Request-Response/One-Way IPC Channels              | Extracted and matched against `electron/preload.ts` and `electron/main.ts` | **PASS**                  |
| 21 Push Event Channels                                 | Matched `on*` methods in `preload.ts` with `webContents.send` in `main.ts` | **PASS**                  |
| 4 Mermaid Diagrams Valid & Accurate                    | Checked syntax and structure against renderer and main architecture        | **PASS**                  |
| 13 Zustand Stores Catalog                              | `find_by_name` in `src/store/` (excluding tests)                           | **PASS** (13/13 verified) |
| Scrollback Buffer Cap (200,000 chars)                  | Verified line 147 in `src/store/terminal-store.ts`                         | **PASS**                  |
| Direct TanStack Query Cache Patching                   | Verified `applyThreadTitleUpdate` in `src/store/agent-store.ts`            | **PASS**                  |
| Multi-Window Configurations & WebPreferences           | Inspected `BrowserWindow` options in `electron/main.ts`                    | **PASS**                  |
| Provider Hierarchy (`src/main.tsx` & `src/launch.tsx`) | Inspected JSX render trees in entry files                                  | **PASS**                  |
| All Project Vitest Unit Tests Pass                     | Executed `bun run test` (54 files, 285 tests)                              | **PASS**                  |

---

## 4. Conclusion

`ARCHITECTURE_MAP.md` is an exceptionally high-quality, comprehensive, and accurate representation of the Omni system architecture. It passes all adversarial quality checks. The document is approved.
