# Renderer & UI Architecture Analysis — Omni (Pipper Code)

## Overview
`omni` (Pipper Code) is a high-performance desktop AI coding environment built on Electron, Vite 5, React 19, Tailwind CSS v4, and Zustand 5. It features a multi-window architecture (Main Application Window, Launcher Window, Companion Window), real-time PTY terminal virtualization, side-by-side unified/split diff rendering, and deep IPC binding with an Agent Client Protocol (ACP) backend.

---

## 1. Renderer Entry Points & Provider Hierarchy

### Entry Points
- **Main Application Window**: `index.html` -> `src/main.tsx` -> `src/App.tsx`
- **Launcher Window**: `launch.html` -> `src/launch.tsx` -> `src/launch/app.tsx` (`LaunchApp`)
- **Companion Stage (Overlay/Popup)**: `index.html?stage=companion` -> `src/main.tsx` -> `src/App.tsx` (detects `stage === "companion"` and renders `<CompanionView />`)

### Early Theme Pre-Hydration
`index.html` contains an inline `<script>` that reads `localStorage.getItem("pipper:theme")` and applies the `dark` CSS class to `document.documentElement` before React mounts to prevent flash of unstyled theme (FOUC).

### Provider Hierarchy

#### Main Window Provider Hierarchy (`src/main.tsx`)
```tsx
<StrictMode>
  <ErrorBoundary>
    <AppQueryProvider>          {/* TanStack QueryClientProvider */}
      <ThemeProvider>           {/* Theme context & IPC sync */}
        <IconProvider defaultLibrary="lucide">  {/* Icon library context */}
          <App />
        </IconProvider>
      </ThemeProvider>
    </AppQueryProvider>
  </ErrorBoundary>
</StrictMode>
```

#### Launcher Window Provider Hierarchy (`src/launch.tsx`)
```tsx
<StrictMode>
  <ErrorBoundary>
    <ThemeProvider>
      <SurfaceProvider value={1}>   {/* Elevation surface depth */}
        <ShapeProvider defaultShape="rounded"> {/* UI shape styling */}
          <IconProvider defaultLibrary="lucide">
            <LaunchApp />
            <Toaster />
          </IconProvider>
        </ShapeProvider>
      </SurfaceProvider>
    </ThemeProvider>
  </ErrorBoundary>
</StrictMode>
```

---

## 2. UI Components & Major Views

### Major Views & Pages

1. **Main Workspace View (`src/App.tsx`)**:
   - **Custom Title Header**: Draggable frame (`-webkit-app-region: drag`) with non-draggable interactive elements (`-webkit-app-region: no-drag`). Includes project switcher, worktree dropdown, git branch selector, `<GlobalTabBar />`, diff toggle button, companion toggle button, and `<ThemeToggle />`.
   - **Split Workspace Layout**: Powered by `react-resizable-panels` (`Group`, `Panel`, `Separator`).
     - **Agent Panel (`<AgentView />` / `<AgentPanel />`)**: Always mounted as Child #1 in the Panel Group to preserve scroll position and uncommitted prompt draft text when toggling views.
     - **Diff View (`<DiffView />`)**: Mounts in a 40:60 split alongside `AgentPanel` when changes exist and diff mode is toggled on.
   - **Terminal Panel Overlay (`<TerminalSession />`)**: Rendered as an absolute `z-30` full-width overlay when active terminal tab is selected.
   - **Background Services & Overlays**: `<DiffIngestor />` (headless tool call ingestor), `<PipperOverlay />` (interactive canvas overlay), `<UpdateDialog />`, `<LauncherUpdateDialog />`, `<UpdateBanner />`, `<LauncherUpdateBanner />`, `<Toaster />`.

2. **Companion View (`src/components/companion-view.tsx`)**:
   - Floating visual customization window for element-level editing.
   - Listens to component annotations (`[component: <id>]`), manages real-time editor prompts, model selector, targeting switch, and Accept/Reject change buttons.

3. **Launcher Window (`src/launch/app.tsx`)**:
   - Authenticated stage (`AuthenticatedStage`): Project grid/list, recent projects, new project creation (`AddProjectForm`), workspace setup status.
   - Unauthenticated stage (`UnauthenticatedStage`): Sign-in / Sign-up redirection via Clerk.
   - Update stage (`UpdateStage`): Launcher update notices and diagnostics.

### UI Component Framework & Libraries
- **Core Framework**: React 19.2.6 & React DOM 19.2.6
- **Styling**: Tailwind CSS v4 (`@tailwindcss/vite`, `tailwindcss`), `clsx`, `tailwind-merge`, `class-variance-authority`, `tw-animate-css`
- **Component Primitives**: `@base-ui/react`, Radix UI (`@radix-ui/react-accordion`, `@radix-ui/react-slot`, `@radix-ui/react-tooltip`), `sonner` / `<Toaster />`
- **Icon Libraries**: `lucide-react`, `@phosphor-icons/react`, `@hugeicons/react`, `@tabler/icons-react`, `@untitledui/icons`
- **Animations & Virtualization**: `framer-motion` (12.42.0), `@tanstack/react-virtual` (3.14.3)
- **Terminal Rendering**: `@wterm/react`, `@wterm/dom`, `@wterm/ghostty`
- **Code & Markdown Rendering**: `shiki`, `react-markdown`, `remark-gfm`, `rehype-sanitize`, `@pierre/diffs`

---

## 3. State Management Architecture

State is managed via **13 specialized Zustand stores** in `src/store/`, complemented by TanStack Query for remote thread data and IPC event listeners.

| Store File | Responsibility & Reactive Model | IPC / Cache Sync |
|---|---|---|
| `agent-store.ts` | Active ACP agent session, streaming entries, tool calls, permissions (`uiRequestQueue`), prompt sending, model & thinking levels. | Listens to `window.omni.agent.onEvent`. Patches TanStack Query cache (`OPEN_TABS_QUERY_KEY`) directly when agent renames thread. |
| `project-store.ts` | Active project metadata and loading states. | Calls `window.omni.projects.getActive()`. Listens to `onActiveChanged`. |
| `worktree-store.ts` | Git worktrees, local branches, active worktree selection map per project. | Synchronizes with `window.omni.worktrees.getSelections()`. Listens to `onSetupProgress`. |
| `workspace-view-store.ts` | Active workspace view mode (`"agent"` or `"terminal"`), active terminal ID, optimistic thread switch target (`requestedThreadId`), `useIsDiffSplit()` derived state. | Pure renderer store driven by tab clicks and layout toggles. |
| `terminal-store.ts` | Open PTY sessions, scrollback history buffering (capped at 200k chars), workspace terminal bucketing (`makeWorkspaceKey`). | Calls `window.omni.terminal.create/write/resize/kill`. Listens to `onData`. |
| `agent-terminal-store.ts` | Terminal output logs for agent-executed sub-commands. | Listens to `terminal-output` events on agent bridge. |
| `diff-store.ts` | Ingests file diffs from completed agent tool calls. Manages file tree order and active file path. | Ingested via `<DiffIngestor />` listening to `agent-store` tool calls. |
| `thread-store.ts` | Project thread list, paginated project thread state (`pagesByProject`), thread rename/delete/add. | Calls `window.omni.threads.listProject/rename/delete`. |
| `continuation-store.ts` | Stashes carry-over transcripts for `/continue` command threads until first prompt send. | In-memory renderer store. |
| `agent-registry-store.ts` | Available ACP agents, user-selected agent IDs, agent handshake probe results (`probeAgents`). | Calls `window.omni.agent.listAgents/probeAgent/setSelectedAgentIds`. |
| `pipper-store.ts` | Visual edit mode state, overlay visibility, processing ID. | Subscribes to `window.omni.pipper.onStateChanged` IPC broadcasts across windows. |
| `update-store.ts` | Core application updater state, update runs, and health checks. | Listens to `window.omni.update.onStateChanged` and `onProgress`. |
| `launcher-update-store.ts` | Launcher auto-updater state, download progress, and diagnostics. | Listens to `window.omni.launcherUpdate.onStateChanged`. |

---

## 4. Routing & Layout Architecture

### Multi-Window Routing
1. **Main Window**: Loads `index.html`, runs full application shell.
2. **Launcher Window**: Loads `launch.html`, manages project selection, authentication, and updates.
3. **Companion Window**: Main window opened with `?stage=companion`, rendering `<CompanionView />` for visual element customization.

### Inner Workspace View Routing
The main workspace has three principal modes controlled by `useWorkspaceViewStore`:
1. **Agent Full View** (`mode === "agent"`, `isDiffOpen === false`): `<AgentView />` spans 100% width.
2. **Agent + Diff Split View** (`mode === "agent"`, `showDiffSplit === true`): Resizable 40:60 split with `<AgentView />` on the left and `<DiffView />` on the right.
3. **Terminal Overlay View** (`mode === "terminal"`): `<TerminalSession />` renders as an absolute full-width `z-30` overlay above `<AgentView />`. `<AgentView />` remains mounted to retain conversation scroll position and input composer state.

---

## 5. Custom Hooks & Utility Modules (`src/lib/`)

- `theme.tsx`: Context provider & hook (`useTheme()`). Handles `light` | `dark` | `system` themes, system color scheme change media listeners, and IPC synchronization (`window.omni.theme.changed`).
- `query-client.tsx`: Module-level `queryClient` instance and `<AppQueryProvider />`. Allows Zustand stores and non-React IPC listeners to patch TanStack Query cache directly without React context.
- `icon-context.ts`: Context provider (`IconProvider`) and hook (`useIcon()`) supporting dynamic icon set switching.
- `acp-session-reducer.ts`: Pure reducer functions (`applySessionUpdate`, `applyTurnStop`, `appendLocalUserMessage`) for optimistic local ACP state updates.
- `acp-entries.ts` & `acp-transcript.ts`: Tools for extracting conversation messages from raw entry timelines, budgeting token context windows, and building continuation transcripts.
- `agent-commands.ts`: Command parser and slash command pattern matcher for `/continue` and custom agent commands.
- `subagent-orchestration.ts`: Subagent trigger parser (`/subagent`), subagent run status helpers.
- `agent-message-images.ts`: Converts local image files to base64 ACP prompt image objects, enforces image count limits (max 5 images).
- `surface-context.tsx` & `shape-context.tsx`: Context providers for surface elevation levels and corner radius shapes.
- `elevated.tsx` & `surface-classes.ts`: Utility components/helpers for styling layered UI surfaces.
- `utils.ts`: `cn()` helper blending `clsx` and `tailwind-merge`.

---

## 6. Extensibility Points

1. **Agent Client Protocol (ACP) Plugin System**:
   - Any compliant ACP agent binary or service can be registered.
   - `listAgents()`, `probeAgent()`, `switchAgent()`, `setSelectedAgentIds()` allow dynamic selection and hot-swapping of agent backends.
   - Support for custom slash commands and `/subagent` delegation.
2. **Model Context Protocol (MCP) Integration**:
   - `window.omni.mcp` exposes server management (`list`, `create`, `update`, `delete`), enabling third-party tool servers to attach to the agent environment.
3. **Theme Customization**:
   - CSS variables defined in `src/index.css` mapped to Tailwind semantic color tokens (`surface-1` through `surface-5`, `foreground`, `muted-foreground`, `border`, `accent`, etc.).
4. **Keybindings & Shortcuts**:
   - Global keyboard shortcuts in `AgentPanel`: Enter (submit prompt), Shift+Enter (newline), Esc (abort agent run), Up/Down arrows (slash menu navigation & `/continue` picker selection).
