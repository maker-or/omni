# Handoff Report — Renderer & UI Architecture Exploration

## 1. Observation

- **Entry Points**:
  - Main app window: `index.html` (lines 8-27) -> `src/main.tsx` (lines 1-23) -> `src/App.tsx`.
  - Launcher window: `launch.html` (lines 1-17) -> `src/launch.tsx` (lines 1-27) -> `src/launch/app.tsx`.
  - Companion window: `index.html?stage=companion` -> `src/App.tsx` (lines 42-48 & 379-381 rendering `<CompanionView />` at `src/components/companion-view.tsx`).
- **Provider Hierarchy**:
  - `src/main.tsx`: `StrictMode` -> `ErrorBoundary` -> `AppQueryProvider` -> `ThemeProvider` -> `IconProvider` -> `App`.
  - `src/launch.tsx`: `StrictMode` -> `ErrorBoundary` -> `ThemeProvider` -> `SurfaceProvider` -> `ShapeProvider` -> `IconProvider` -> `LaunchApp` + `Toaster`.
- **UI Architecture & Layout**:
  - Workspace layout (`src/App.tsx:720-773`) uses `react-resizable-panels` (`Group`, `Panel`, `Separator`). `AgentPanel` is mounted as Panel #1 to preserve composer text and scroll state across view switches.
  - Diff View (`<DiffView />` at `src/components/diff-view.tsx`) mounts in 40:60 split when diffs exist (`useIsDiffSplit()`, `src/store/workspace-view-store.ts:49-54`).
  - Terminal Overlay (`<TerminalSession />` at `src/components/terminal-session.tsx`) mounts as absolute `z-30` full-width section when `workspaceMode === "terminal"`.
- **State Management**:
  - 13 Zustand stores in `src/store/`: `agent-store.ts`, `project-store.ts`, `worktree-store.ts`, `workspace-view-store.ts`, `terminal-store.ts`, `agent-terminal-store.ts`, `diff-store.ts`, `thread-store.ts`, `continuation-store.ts`, `agent-registry-store.ts`, `pipper-store.ts`, `update-store.ts`, `launcher-update-store.ts`.
  - IPC contract defined in `src/electron.d.ts` (lines 40-271) exposing `window.omni` namespaces (`launch`, `shell`, `update`, `launcherUpdate`, `projects`, `worktrees`, `onboarding`, `threads`, `tabs`, `agent`, `subagents`, `mcp`, `dialog`, `terminal`, `companion`, `editor`, `analytics`, `pipper`, `theme`).
- **UI Libraries & Styling**:
  - Tailwind CSS v4 (`@tailwindcss/vite`), React 19 (`react`, `react-dom` 19.2.6), Base UI & Radix UI primitives (`@base-ui/react`, `@radix-ui/react-accordion`, `@radix-ui/react-tooltip`), Framer Motion (`framer-motion`), TanStack Virtual (`@tanstack/react-virtual`), Shiki (`shiki`), Pierre Diffs (`@pierre/diffs`), WTerm (`@wterm/react`, `@wterm/dom`).

## 2. Logic Chain

1. **Multi-Window & Stage Isolation**:
   - The application supports distinct user journeys (full coding workspace, launcher onboarding/project selection, floating visual element companion) by leveraging separate HTML entry points and query parameters (`?stage=companion`).
2. **State & Tab Persistence Strategy**:
   - The UI separates workspace mode (`WorkspaceMode` in `workspace-view-store.ts`) from active thread state (`agent-store.ts` & `thread-store.ts`).
   - By keeping `<AgentView />` mounted in Panel #1 regardless of whether diff split or terminal overlay is active, input composer drafts, image attachments, and conversation scroll positions remain intact during tab switches.
3. **Optimistic UI & Cache Synchronization**:
   - Stores like `agent-store.ts` receive real-time ACP events from main process via `window.omni.agent.onEvent`.
   - When an agent renames a thread, `agent-store.ts` directly patches TanStack Query cache (`OPEN_TABS_QUERY_KEY`) and `useThreadStore`, ensuring header tab labels update immediately without requiring network or IPC re-fetches.
4. **Terminal Session Bucketing**:
   - Terminal sessions are scoped to `(projectId, workspacePath)` buckets (`makeWorkspaceKey` in `terminal-store.ts`).
   - Navigating between worktrees stashes scrollback history and replaces active PTY instances, ensuring terminal processes don't execute against stale worktree directories.

## 3. Caveats

- **Execution Mode**: Analysis was performed strictly in read-only mode without executing the application build or runtime binaries.
- **Main Process Dependencies**: Renderer process heavily relies on pre-bound IPC channels under `window.omni`. Changes to IPC interface shapes in `src/electron.d.ts` require synchronous updates across both main process handlers and renderer Zustand stores.

## 4. Conclusion

The `omni` renderer process is a clean, modular React 19 architecture optimized for speed, low-latency streaming updates, and state persistence across multi-window and split-panel layouts. Its separation of concerns across 13 dedicated Zustand stores, TanStack Query, and ACP/MCP event bridges makes it highly scalable and extensible for AI agent workflows.

## 5. Verification Method

- **Code Inspection**:
  - Confirm entry points: `view_file` on `index.html`, `launch.html`, `src/main.tsx`, `src/launch.tsx`, `src/App.tsx`.
  - Confirm store map: `find_by_name` on `src/store/`.
  - Confirm IPC contract: `view_file` on `src/electron.d.ts`.
- **Build Verification**:
  - Run `bun run build` or `npx electron-vite build` (per project scripts) to compile main, preload, and renderer packages into `out/renderer`.
