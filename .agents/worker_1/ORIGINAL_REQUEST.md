## 2026-07-21T15:59:24Z

You are Worker 1 (Architecture Documentation Writer).
Working directory: /Users/harshithpasupuleti/code/omni/.agents/worker_1
Target file to write: /Users/harshithpasupuleti/code/omni/ARCHITECTURE_MAP.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your task is to synthesize the detailed analysis reports from Explorer 1 (`/Users/harshithpasupuleti/code/omni/.agents/explorer_1/analysis.md`) and Explorer 2 (`/Users/harshithpasupuleti/code/omni/.agents/explorer_2/analysis.md`) and generate the complete, production-grade `ARCHITECTURE_MAP.md` at `/Users/harshithpasupuleti/code/omni/ARCHITECTURE_MAP.md`.

Requirements & Structure for `ARCHITECTURE_MAP.md`:

1. **Executive Overview & Tech Stack**: App identity (`pipper-code-alpha` v0.0.22), Electron 42, React 19, Vite 8, Bun, Tailwind CSS v4, Node native SQLite (`node:sqlite`), ACP (`@agentclientprotocol/sdk`), `node-pty`.
2. **Process Architecture & Security Model**: Dual-window (`mainWindow`, `launchWindow`) & companion window (`companionWindow`), `webPreferences` security configuration (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`), navigation URL origin checks.
3. **Main Process Core Subsystems**:
   - SQLite Storage Engine (`electron/db.ts`): Schema for projects, threads, user_agent_selections, mcp_servers, auth_users.
   - ACP Agent Manager (`electron/agent-connection-manager.ts` & `registry.ts`): stdio JSON-RPC bridge supporting Cursor, Codex, Claude Code, Opencode, Grok, Gemini, Copilot, Mock agents.
   - Subagent Framework (`electron/subagents/subagent-manager.ts`): max depth configuration, MCP proxying.
   - Model Context Protocol (`electron/mcp/`): MCP server management.
   - Terminal Session Manager (`node-pty` integration for xterm).
   - Dual Auto-Updater System (`LauncherUpdateManager` for app releases, `UpdateManager` for workspace updates).
   - Configuration & Build Pipeline (`electron.vite.config.ts`, `electron-builder.yml`, TypeScript setups).
4. **Preload & IPC Contract Catalog**:
   - `window.omni` contextBridge API structure (`src/electron.d.ts`).
   - Comprehensive tables of ALL 111 request-response/one-way IPC channels and ALL 21 push events, with argument types, return types, and descriptions.
5. **Renderer Architecture & UI Component Catalog**:
   - Entry points (`index.html`, `launch.html`, `main.tsx`, `launch.tsx`, `App.tsx`).
   - Provider hierarchies (Query, Theme, Surface, Shape, Icon).
   - Component catalog: `App.tsx`, `AgentPanel` / `AgentView`, `DiffView`, `TerminalSession`, `CompanionView`, `LaunchApp`, UI component framework & libraries.
6. **State Management Architecture**:
   - Breakdown of all 13 Zustand stores in `src/store/`.
   - TanStack Query cache patching and optimistic UI updates.
   - State synchronization model between Renderer stores and Main process IPC events.
7. **Routing, Layout & Extensibility**:
   - Multi-window and inner workspace layout routing (react-resizable-panels, z-index terminal overlay).
   - Custom hooks and utilities (`src/lib/`).
   - Extensibility points: ACP agent registry, MCP tools, theme customization, keybindings.
8. **Mermaid Diagrams**:
   - High-Level Process Architecture Diagram (`graph TD`)
   - IPC & Data Flow Architecture Diagram (`sequenceDiagram` or `graph LR`)
   - Provider Hierarchy & Layout Tree Diagram (`graph TD`)
   - State Management & ACP/PTY Data Lifecycle Diagram (`flowchart TD`)

Write the complete document directly to `/Users/harshithpasupuleti/code/omni/ARCHITECTURE_MAP.md`. Do not leave any placeholders, TODOs, or truncated sections. When finished, update your `progress.md` and send a completion message back to your parent orchestrator.
