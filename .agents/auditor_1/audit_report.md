# Forensic Audit Report — ARCHITECTURE_MAP.md

**Work Product**: `/Users/harshithpasupuleti/code/omni/ARCHITECTURE_MAP.md`  
**Target Codebase**: `/Users/harshithpasupuleti/code/omni`  
**Profile**: General Project  
**Audit Date**: July 21, 2026  
**Verdict**: **CLEAN**  

---

## 1. Executive Summary

An independent Forensic Integrity Audit was performed on `/Users/harshithpasupuleti/code/omni/ARCHITECTURE_MAP.md` against the live codebase at `/Users/harshithpasupuleti/code/omni`. 

The audit evaluated two primary dimensions:
1. **Integrity Forensics**: Checking for prohibited patterns, cheating, hardcoded test results, facade implementations, dummy descriptions, synthetic placeholders, or pre-populated verification artifacts.
2. **Empirical Fact Verification**: Cross-checking every claim in the document (IPC channel counts, file paths, SQLite schema, Zustand stores, tech stack matrix, multi-process architecture, ACP agents, and test suite execution) directly against the codebase files and execution environments.

**Verdict**: **CLEAN**. No integrity violations, cheating, fake outputs, or dummy descriptions were detected. All technical claims in `ARCHITECTURE_MAP.md` reflect real, functional implementations in the codebase. The project test suite executes cleanly with 54 test files passing and 285 individual tests passing.

---

## 2. Forensic Checks & Prohibited Patterns Analysis

| # | Check / Pattern | Result | Details & Findings |
|---|---|---|---|
| 1 | **Hardcoded Test Results** | **PASS** | No hardcoded PASS/FAIL strings, fake output mocks, or synthetic result artifacts were found embedded in documentation or test runners. |
| 2 | **Facade Implementations** | **PASS** | Interface specifications in the document correspond to fully functional TypeScript code (e.g. `electron/main.ts`, `electron/preload.ts`, `electron/db.ts`). |
| 3 | **Pre-populated Artifact Detection** | **PASS** | No pre-cooked test output logs or fake result files exist in the repository. |
| 4 | **Self-Certifying Tests** | **PASS** | Test suite (`vitest`) runs dynamic assertion tests across stores, worktree operations, IPC bridges, and database migrations. |
| 5 | **Cheating / Synthetic Placeholders** | **PASS** | Grep analysis for `TODO`, `LOREM`, `TBD`, `PLACEHOLDER`, `SYNTHETIC` returned zero fake documentation stubs. |

---

## 3. Empirical Fact Cross-Check Matrix

### 3.1 Tech Stack & Dependency Matrix

Cross-checked against `/Users/harshithpasupuleti/code/omni/package.json`:

| Document Claim | Codebase Verification | Status |
|---|---|---|
| Package Name: `pipper-code-alpha` | `package.json:2` -> `"name": "pipper-code-alpha"` | **MATCH** |
| Version: `0.0.22` | `package.json:3` -> `"version": "0.0.22"` | **MATCH** |
| Electron: `v42.3.3` | `package.json:85` -> `"electron": "^42.3.3"` | **MATCH** |
| React: `v19.2.6` (React Compiler) | `package.json:59, 84` -> `"react": "^19.2.6"`, `"babel-plugin-react-compiler": "^1.0.0"` | **MATCH** |
| Vite & electron-vite: `v8.0.12`, `v5.0.0` | `package.json:87, 94` -> `"electron-vite": "^5.0.0"`, `"vite": "^8.0.12"` | **MATCH** |
| Tailwind CSS: `v4.3.0` | `package.json:68` -> `"tailwindcss": "^4.3.0"` | **MATCH** |
| Zustand: `v5.0.14` | `package.json:70` -> `"zustand": "^5.0.14"` | **MATCH** |
| ACP Protocol SDK: `@agentclientprotocol/sdk` | `package.json:31` -> `"@agentclientprotocol/sdk": "^1.2.1"` | **MATCH** |
| Native Terminal: `node-pty`, `@wterm/react` | `package.json:50, 56` -> `"@wterm/react": "^0.3.0"`, `"node-pty": "^1.1.0"` | **MATCH** |
| electron-builder: `v26.15.2` | `package.json:86` -> `"electron-builder": "^26.15.2"` | **MATCH** |

### 3.2 Process Architecture & Windows

Cross-checked against `/Users/harshithpasupuleti/code/omni/electron/main.ts`:

- `mainWindow` (Line 804): WebPreferences set `preload: out/preload/index.js`, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`. (**MATCH**)
- `launchWindow` (Line 865): Loads `launch.html`, onboarding stage. (**MATCH**)
- `companionWindow` (Line 912): Floating overlay window, loads `companion-state.json`. (**MATCH**)

### 3.3 Database & SQLite Schema

Cross-checked against `/Users/harshithpasupuleti/code/omni/electron/db.ts`:

All 5 declared SQLite tables exist with matching column structures:
1. `projects` (`id`, `path` UNIQUE, `name`, `icon`)
2. `threads` (`id`, `project_id` FK, `agent_id`, `agent_session_id`, `title`, `worktree_path`, `sort_order`, `created_at`, `last_used_at`)
3. `user_agent_selections` (`agent_id`, `selected_at`)
4. `mcp_servers` (`id`, `name`, `transport_type`, `url`, `command`, `args`, `env`, `created_at`, `updated_at`)
5. `auth_users` (`provider`, `provider_user_id` PK, `email`, `name`, `avatar_url`, `created_at`, `updated_at`, `last_seen_at`)

### 3.4 ACP Agents Catalog

Cross-checked against `/Users/harshithpasupuleti/code/omni/electron/agents/registry.ts`:

All 8 ACP agent engines listed in Section 3.2 exist in `BUILTIN_ACP_AGENTS`:
1. `cursor-acp`
2. `codex-acp`
3. `claude-agent-acp`
4. `opencode-acp`
5. `grok-acp`
6. `gemini-acp`
7. `copilot-acp`
8. `pipper-mock`

### 3.5 Preload & IPC Channel Verification

Cross-checked against `/Users/harshithpasupuleti/code/omni/electron/preload.ts`:

- **Request-Response / One-Way IPC Channels**: Document claims **111 Total**. Manual inspection of `electron/preload.ts` confirms **EXACTLY 111** invoke/send methods defined across all subsystems.
- **Main-to-Renderer Push Events**: Document claims **21 Total**. Manual inspection of `electron/preload.ts` confirms **EXACTLY 21** `ipcRenderer.on` event hooks defined.

### 3.6 Zustand Stores Catalog

Cross-checked against `/Users/harshithpasupuleti/code/omni/src/store/`:

All 13 declared Zustand store files exist in `src/store/`:
1. `agent-store.ts`
2. `project-store.ts`
3. `worktree-store.ts`
4. `workspace-view-store.ts`
5. `terminal-store.ts`
6. `agent-terminal-store.ts`
7. `diff-store.ts`
8. `thread-store.ts`
9. `continuation-store.ts`
10. `agent-registry-store.ts`
11. `pipper-store.ts`
12. `update-store.ts`
13. `launcher-update-store.ts`

### 3.7 Helpers & Custom Utilities Catalog

Cross-checked against `/Users/harshithpasupuleti/code/omni/src/lib/`:

All 11 listed helper modules exist in `src/lib/`:
`theme.tsx`, `icon-context.ts`, `acp-session-reducer.ts`, `acp-entries.ts`, `acp-transcript.ts`, `agent-commands.ts`, `subagent-orchestration.ts`, `agent-message-images.ts`, `surface-context.tsx`, `shape-context.tsx`, `utils.ts`.

### 3.8 Behavioral & Test Suite Execution

Ran project test suite via `bun run test`:
```
Test Files  54 passed (54)
     Tests  285 passed (285)
  Duration  5.50s
```
Result: All 54 test files and 285 unit/integration tests passed cleanly.

---

## 4. Minor Precision Notes (Non-Violational Documentation Drift)

During empirical cross-checking, two minor documentation precision notes were identified. Neither note constitutes an integrity violation or cheating attempt:

1. **MCP Subsystem Path Reference**:
   - `ARCHITECTURE_MAP.md` references `electron/mcp/` as a directory in Section 3 overview box, Section 3.4 title, and Mermaid Diagram 1.
   - *Codebase Actual*: MCP functionality is implemented across `electron/mcp-servers.ts` and `electron/subagents/mcp-http-server.ts` rather than an `electron/mcp/` directory.

2. **Subsystem Header Channel Count Typographical Discrepancies**:
   - Section 4.1 Table 5 header reads `— 9 channels`, but the table lists 10 channels (`shell:openExternal`, `launch:complete`, `launch:show`, `launch:isWorkspaceReady`, `launch:getUser`, `companion:open`, `companion:minimize`, `companion:close`, `onboarding:verifyGit`, `onboarding:startSetup`).
   - Section 4.1 Table 9 header reads `— 17 channels`, but the table lists 16 channels (`theme:getCurrent`, `theme:changed`, `editor:activate`, `editor:getState`, `editor:sendPrompt`, `editor:abort`, `editor:setModel`, `editor:dispose`, `analytics:componentMutationRequested`, `pipper:setProcessing`, `pipper:setOverlayVisible`, `pipper:enterEditMode`, `pipper:exitEditMode`, `pipper:addComment`, `pipper:acceptChanges`, `pipper:rejectChanges`).
   - *Note*: The section total header (`111 Total`) is 100% accurate (13 + 13 + 6 + 6 + 10 + 11 + 25 + 11 + 16 = 111).

---

## 5. Audit Verdict

**VERDICT**: **CLEAN**

The document `ARCHITECTURE_MAP.md` is an exceptionally accurate, authentic, and detailed architectural mapping of the `omni` codebase. It contains zero synthetic placeholders, zero hardcoded test outputs, and zero facade implementations. All core claims regarding process architecture, IPC contract, database schema, state management, and test pass state were independently verified.
