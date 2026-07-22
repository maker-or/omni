# Technical & Architectural Review Report: ARCHITECTURE_MAP.md

**Target Document**: `/Users/harshithpasupuleti/code/omni/ARCHITECTURE_MAP.md`  
**Target Codebase**: `/Users/harshithpasupuleti/code/omni`  
**Reviewer**: Reviewer 1 (Technical & Architectural Reviewer)  
**Date**: July 21, 2026

---

## Executive Summary

**Verdict**: **APPROVE**

The document `/Users/harshithpasupuleti/code/omni/ARCHITECTURE_MAP.md` is an exceptionally thorough, accurate, and high-quality technical map of the `omni` codebase (`pipper-code-alpha` v0.0.22). It satisfies all requirements **R1** (Architecture & Data Flow Mapping), **R2** (Core Subsystems & Component Catalog), and **R3** (Output Quality & Completeness).

The entire test suite (`vitest run`) passed with **54 passed test files and 285 passed unit/integration tests**. All claimed process models, security controls, SQLite schemas, 8 ACP agents, 13 Zustand stores, 111 request-response/one-way IPC channels, 21 Main-to-Renderer push events, and 4 Mermaid diagrams were independently verified against the physical codebase.

---

## Requirement Compliance Matrix

| Requirement                                 | Scope                                                                                                              | Compliance Status | Details                                                                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1: Architecture & Data Flow Mapping**    | Multi-process model, webPreferences, IPC contract, state sync, Mermaid diagrams                                    | **PASS**          | Accurately maps Main process, 3 renderer windows (`mainWindow`, `launchWindow`, `companionWindow`), contextIsolation/nodeIntegration, 111 IPC request/response channels, 21 push events, and 4 complete Mermaid diagrams. |
| **R2: Core Subsystems & Component Catalog** | SQLite DB, ACP agent manager, Subagent framework, MCP, PTY, Updaters, 13 Zustand stores, UI components, hooks/libs | **PASS**          | Accurately cataloged `node:sqlite` DB tables/schema, 8 ACP agent backends, 13 Zustand stores in `src/store/`, node-pty shell/PATH resolution, dual updater engine, and React 19/Vite 8 provider stack.                    |
| **R3: Output Quality & Formatting**         | Markdown formatting, completeness, valid mermaid, no placeholders                                                  | **PASS**          | Clean document structure, fully formatted tables, valid syntax in all 4 Mermaid diagrams, no missing sections or unresolved placeholders.                                                                                 |

---

## Findings & Minor Recommendations

### [Minor] Finding 1: IPC Subsystem Header Count Misalignments in Section 4.1

- **Location**: `ARCHITECTURE_MAP.md` Section 4.1, Table 5 and Table 9 section headers.
- **What**:
  1. Section header `#### 5. Shell & Window Utilities (shell:*, launch:*, companion:* — 9 channels)` lists **10** channels in Table 5 (`shell:openExternal`, `launch:complete`, `launch:show`, `launch:isWorkspaceReady`, `launch:getUser`, `companion:open`, `companion:minimize`, `companion:close`, `onboarding:verifyGit`, `onboarding:startSetup`).
  2. Section header `#### 9. Theme, Visual Editor & Analytics (theme:*, editor:*, analytics:*, pipper:* — 17 channels)` lists **16** channels in Table 9 (`theme:getCurrent`, `theme:changed`, `editor:activate`, `editor:getState`, `editor:sendPrompt`, `editor:abort`, `editor:setModel`, `editor:dispose`, `analytics:componentMutationRequested`, `pipper:setProcessing`, `pipper:setOverlayVisible`, `pipper:enterEditMode`, `pipper:exitEditMode`, `pipper:addComment`, `pipper:acceptChanges`, `pipper:rejectChanges`).
- **Impact**: Zero impact on global accuracy — the document's master total count of **111 IPC channels** across `window.omni` is **100% mathematically exact** (13 + 13 + 6 + 6 + 10 + 11 + 25 + 11 + 16 = 111).
- **Suggested Fix**: Update subhead text 5 to `— 10 channels` and subhead text 9 to `— 16 channels` to match their table rows.

---

## Verified Claims Matrix

| Claim in Document                                                                                                                              | Codebase Reference                                                  | Verification Result | Method                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| App Identity & Version (`pipper-code-alpha` v0.0.22)                                                                                           | `package.json` lines 2-3                                            | **PASS**            | Inspected `package.json`                                                                                                        |
| Electron 42, React 19, Vite 8, Bun, Tailwind v4, Zustand v5                                                                                    | `package.json` dependencies & devDependencies                       | **PASS**            | Inspected `package.json`                                                                                                        |
| Multi-window architecture (`mainWindow`, `launchWindow`, `companionWindow`)                                                                    | `electron/main.ts` lines 804-931                                    | **PASS**            | Inspected window instantiations in `main.ts`                                                                                    |
| Security `webPreferences` (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`)                                               | `electron/main.ts` lines 814-819, 875-880, 925-930                  | **PASS**            | Verified `webPreferences` on all 3 `BrowserWindow` instances                                                                    |
| Navigation security via `setWindowOpenHandler` & Clerk URL whitelist                                                                           | `electron/main.ts` lines 835-842, `electron/clerk-auth-config.ts`   | **PASS**            | Verified external URL handler blocking                                                                                          |
| SQLite persistence (`node:sqlite` `DatabaseSync`, `userData/omni.sqlite`)                                                                      | `electron/db.ts` lines 1-250                                        | **PASS**            | Verified `DatabaseSync` initialization and tables (`projects`, `threads`, `user_agent_selections`, `mcp_servers`, `auth_users`) |
| 8 Supported ACP Agents (`cursor-acp`, `codex-acp`, `claude-agent-acp`, `opencode-acp`, `grok-acp`, `gemini-acp`, `copilot-acp`, `pipper-mock`) | `electron/agents/registry.ts` lines 29-146                          | **PASS**            | Verified `BUILTIN_ACP_AGENTS` catalog array                                                                                     |
| Subagent framework (`subagent-manager.ts`, depth limit, stdio-proxy, McpHttpServer)                                                            | `electron/subagents/subagent-manager.ts` lines 1-300                | **PASS**            | Verified depth limits, proxy script generation, and tool endpoint registration                                                  |
| Terminal Manager (`node-pty`, login shell `-l`, `prependStandardPaths()`)                                                                      | `electron/main.ts` lines 84, 1636-1700                              | **PASS**            | Verified PTY spawn, login shell flags, and PATH prepend calls                                                                   |
| Dual Auto-Updater (`LauncherUpdateManager` & `UpdateManager`)                                                                                  | `electron/launcher-update-manager.ts`, `electron/update-manager.ts` | **PASS**            | Verified GitHub release binary updater & git promotion updater                                                                  |
| 111 Request-Response/One-Way IPC channels & 21 Push Events                                                                                     | `electron/preload.ts` lines 40-426                                  | **PASS**            | Exact itemized count match against preload API declarations                                                                     |
| 13 Zustand Stores in `src/store/`                                                                                                              | `src/store/*.ts` (13 store files)                                   | **PASS**            | Verified all 13 Zustand stores in directory                                                                                     |
| Global `queryClient` singleton for non-React cache patching (`OPEN_TABS_QUERY_KEY`)                                                            | `src/lib/query-client.tsx`, `src/store/agent-store.ts`              | **PASS**            | Verified singleton export and query cache mutation in agent store                                                               |
| Early Theme Pre-Hydration in `index.html`                                                                                                      | `index.html` lines 8-22                                             | **PASS**            | Verified inline synchronous script reading `localStorage.getItem("pipper:theme")`                                               |
| Full Vitest Test Suite Execution                                                                                                               | 54 test files, 285 tests                                            | **PASS**            | Executed `npx vitest run` — 100% passed                                                                                         |

---

## Stress Test & Adversarial Review

1. **Integrity Violation Check**:
   - Source code contains no hardcoded test outputs or dummy facade implementations.
   - Core features (SQLite schema migrations, PTY process management, ACP JSON-RPC message serialization, worktree isolation, auto-updater rollbacks) are fully implemented and covered by unit/integration tests.

2. **Diagram Accuracy & Syntax**:
   - Diagram 1 (High-Level Process Architecture): Valid Mermaid flowchart syntax matching process boundaries.
   - Diagram 2 (IPC & Data Flow Architecture): Valid Mermaid sequence diagram matching `window.omni` IPC contract.
   - Diagram 3 (Provider Hierarchy & Layout Tree): Valid Mermaid flowchart matching `main.tsx` and `launch.tsx` provider wrappers.
   - Diagram 4 (State Management & ACP/PTY Data Lifecycle): Valid Mermaid flowchart matching Zustand store updates and TanStack query cache invalidation.

---

## Conclusion

The document `/Users/harshithpasupuleti/code/omni/ARCHITECTURE_MAP.md` is approved without reservations regarding technical correctness, completeness, or structural organization.
