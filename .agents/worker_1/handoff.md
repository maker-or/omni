# Handoff Report — Worker 1 (Architecture Documentation Writer)

## 1. Observation
- **Inputs**: Read and synthesized analysis reports from Explorer 1 (`/Users/harshithpasupuleti/code/omni/.agents/explorer_1/analysis.md`) and Explorer 2 (`/Users/harshithpasupuleti/code/omni/.agents/explorer_2/analysis.md`).
- **Target Output File**: Generated `/Users/harshithpasupuleti/code/omni/ARCHITECTURE_MAP.md` (698 lines, ~56 KB).
- **Subsystem Breakdown**:
  - Tech stack: `pipper-code-alpha` v0.0.22, Electron 42, React 19, Vite 8, Bun, Tailwind CSS v4, Node native SQLite (`node:sqlite`), ACP (`@agentclientprotocol/sdk`), `node-pty`.
  - Security model: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`, origin-checked navigation via `setWindowOpenHandler`.
  - Main process subsystems: SQLite schemas (`projects`, `threads`, `user_agent_selections`, `mcp_servers`, `auth_users`), ACP agent connection manager & registry, Subagent framework, MCP server engine, PTY terminal manager, Dual Auto-updaters, `dependency-installer.ts`, configuration & build pipeline (`electron.vite.config.ts`, `electron-builder.yml`).
  - Preload & IPC Contract: All 111 request-response/one-way IPC channels and 21 push events mapped into comprehensive markdown tables with arguments, return types, and descriptions.
  - Renderer & UI component catalog: Provider hierarchies for `mainWindow` and `launchWindow`, early FOUC pre-hydration, view components (`App.tsx`, `AgentPanel`, `DiffView`, `TerminalSession`, `CompanionView`, `LaunchApp`).
  - State management architecture: Detailed breakdown of all 13 Zustand stores in `src/store/`, TanStack Query `OPEN_TABS_QUERY_KEY` cache patching, and optimistic reducer state updates.
  - Routing, Layout & Extensibility: Multi-window routing, `react-resizable-panels` layout, custom hooks/utilities in `src/lib/`, extensibility points.
  - 4 Mermaid Diagrams: High-Level Process Architecture (`graph TD`), IPC & Data Flow Architecture (`sequenceDiagram`), Provider Hierarchy & Layout Tree (`graph TD`), State Management & ACP/PTY Data Lifecycle (`flowchart TD`).

## 2. Logic Chain
1. Combined structural findings from Explorer 1 (Main process, IPC contracts, DB schemas, native integrations) and Explorer 2 (Renderer entry points, provider trees, Zustand stores, layout routing).
2. Formatted all IPC contracts into 9 sub-table groupings covering the exact 111 channels and 21 push events.
3. Formatted all 13 Zustand stores into a structured catalog highlighting their responsibility, reactive model, and IPC/Query cache synchronization mechanisms.
4. Rendered 4 complete Mermaid diagrams representing process boundaries, sequential data flows, component/provider trees, and data lifecycles.

## 3. Caveats
- No caveats. The document was constructed directly from source-verified explorer analysis reports and contains zero placeholders, TODOs, or truncated sections.

## 4. Conclusion
`ARCHITECTURE_MAP.md` is complete, fully validated, and written to `/Users/harshithpasupuleti/code/omni/ARCHITECTURE_MAP.md`.

## 5. Verification Method
- Inspect `/Users/harshithpasupuleti/code/omni/ARCHITECTURE_MAP.md` via `view_file` or `grep_search`.
- Verify total channel counts: 111 invoke/send channels + 21 push events = 132 IPC contracts.
- Verify total store count: 13 Zustand stores in Section 6.
- Verify 4 valid Mermaid diagram code blocks.
