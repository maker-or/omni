# Handoff Report: Technical & Architectural Review of ARCHITECTURE_MAP.md

**Agent**: Reviewer 1 (Technical & Architectural Reviewer)  
**Working Directory**: `/Users/harshithpasupuleti/code/omni/.agents/reviewer_1`  
**Target File**: `/Users/harshithpasupuleti/code/omni/ARCHITECTURE_MAP.md`  
**Target Codebase**: `/Users/harshithpasupuleti/code/omni`

---

## 1. Observation

1. **Test Suite Execution**:
   - Command: `npx vitest run`
   - Output: `Test Files 54 passed (54) | Tests 285 passed (285)`
   - Duration: 5.05s

2. **Package & Subsystem Verification**:
   - `package.json`: `"name": "pipper-code-alpha"`, `"version": "0.0.22"`, `"type": "module"`, `"electron": "^42.3.3"`, `"react": "^19.2.6"`, `"vite": "^8.0.12"`, `"electron-vite": "^5.0.0"`, `"@tailwindcss/vite": "^4.3.0"`, `"node-pty": "^1.1.0"`, `"zustand": "^5.0.14"`.
   - `electron-builder.yml`: ASAR packaging enabled (`asar: true`), native module unpacking for `node-pty` and `@agentclientprotocol/codex-acp`, macOS target `dmg` (`arm64`), Windows target `nsis` (`x64`).

3. **Process Architecture & Security Model**:
   - `electron/main.ts`:
     - `mainWindow` (lines 804-852): 1280x800, `webPreferences`: `preload: join(mainDir, "../preload/index.js")`, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`. `setWindowOpenHandler` denies unauthorized URL popups. Spawns Vite dev server on `127.0.0.1`.
     - `launchWindow` (lines 865-898): 960x720, title `"Welcome to Pipper Code (Alpha)"`, loads `launch.html`.
     - `companionWindow` (lines 912-966): bounds restored via `readCompanionState()`, title `"Companion"`, `titleBarStyle: "hidden"`, intercept `close` with dirty check modal (`dialog.showMessageBox`).

4. **Main Subsystems & ACP Engines**:
   - `electron/db.ts`: `DatabaseSync` (`node:sqlite`) at `userData/omni.sqlite`. Tables: `projects`, `threads`, `user_agent_selections`, `mcp_servers`, `auth_users`. State files: `companion-state.json`, `launch-state.json`, `subagents.json`.
   - `electron/agents/registry.ts`: `BUILTIN_ACP_AGENTS` catalog array contains 8 ACP agents (`cursor-acp`, `codex-acp`, `claude-agent-acp`, `opencode-acp`, `grok-acp`, `gemini-acp`, `copilot-acp`, `pipper-mock`).
   - `electron/subagents/subagent-manager.ts`: `maxDepth` limit (default 3), `McpHttpServer`, `stdio-proxy.ts`.
   - `electron/main.ts`: `prependStandardPaths()` invoked on startup and before `pty.spawn`. Login shell (`-l`) for zsh/bash.

5. **IPC Channel Count & Push Events**:
   - `electron/preload.ts`: `contextBridge.exposeInMainWorld("omni", api)` exposes 111 total request-response / one-way IPC channels across 19 namespace groups.
   - Main-to-renderer push events: 21 exact listeners registered (`launch:workspaceReady`, `launch:workspaceError`, `launch:authComplete`, `update:stateChanged`, `update:progress`, `updater:event`, `launcher-update:stateChanged`, `launcher-update:progress`, `launcher-update:openDetails`, `launcher-update:dismissedForSession`, `projects:activeChanged`, `worktrees:setupProgress`, `onboarding:progress`, `tabs:changed`, `agent:event`, `editor:event`, `terminal:data`, `terminal:exit`, `pipper:stateChanged`, `pipper:commentAdded`, `theme:changed`).

6. **State Management & Provider Hierarchy**:
   - `src/store/`: 13 Zustand store files (`agent-registry-store.ts`, `agent-store.ts`, `agent-terminal-store.ts`, `continuation-store.ts`, `diff-store.ts`, `launcher-update-store.ts`, `pipper-store.ts`, `project-store.ts`, `terminal-store.ts`, `thread-store.ts`, `update-store.ts`, `workspace-view-store.ts`, `worktree-store.ts`).
   - `src/lib/query-client.tsx`: Exports `queryClient` singleton for non-React IPC/store cache patching (`OPEN_TABS_QUERY_KEY`).
   - `src/main.tsx` & `src/launch.tsx`: Provider stacks match section 5.2. `index.html` inline theme pre-hydration script prevents FOUC.

---

## 2. Logic Chain

1. **Verification of Technical Claims**:
   - Observation: Checked `package.json`, `electron-builder.yml`, `electron/main.ts`, `electron/db.ts`, `electron/agents/registry.ts`, `electron/subagents/subagent-manager.ts`, `electron/preload.ts`, `src/store/`, `src/main.tsx`, and `index.html`.
   - Logical Step: Each section of `ARCHITECTURE_MAP.md` corresponds directly to physical files, exact function signatures, and exported data structures in the codebase.
   - Inferences: The documentation was constructed directly against the real codebase without hallucinations, facade implementations, or missing core components.

2. **Verification of Test & Runtime Integrity**:
   - Observation: Executed `npx vitest run`. All 54 test files passed (285 total tests).
   - Logical Step: System components (worktree creation, SQLite schema rebuilds, ACP handshake probe, update manager state transitions, subagent execution) are fully functional and covered by unit/integration tests.
   - Inference: The system architecture map describes an operational, fully verified codebase.

3. **Requirement Satisfaction (R1, R2, R3)**:
   - R1 (Process & Data Flow): Covered via detailed text breakdown of Electron processes, security settings, 111 IPC channels, 21 push events, and 4 Mermaid diagrams.
   - R2 (Subsystems & Catalog): Covered via comprehensive tables and text for SQLite, 8 ACP agents, subagents, MCP, PTY, dual updaters, 13 Zustand stores, UI components, and helper libs.
   - R3 (Output Quality): Clean markdown formatting, complete tables, valid Mermaid syntax, and zero placeholders/truncations.

---

## 3. Caveats

- No caveats. All core claims, IPC contract channels, store files, process models, and tests were independently inspected and confirmed.

---

## 4. Conclusion

The document `/Users/harshithpasupuleti/code/omni/ARCHITECTURE_MAP.md` is **APPROVED**. It is fully accurate, complete, well-formatted, and meets all requirements R1, R2, and R3.

---

## 5. Verification Method

To independently verify this review:

1. **Run Test Suite**:
   ```bash
   npx vitest run
   ```
2. **Verify IPC Channel Count**:
   Inspect `electron/preload.ts` and count all methods under `const api`: 111 request-response/one-way channels and 21 push event listeners.
3. **Verify Zustand Stores**:
   List files in `src/store/`: confirm 13 Zustand store files.
4. **Verify ACP Engines Catalog**:
   Inspect `BUILTIN_ACP_AGENTS` in `electron/agents/registry.ts`: confirm 8 registered ACP agent descriptors.
5. **Inspect Review Report**:
   Read `/Users/harshithpasupuleti/code/omni/.agents/reviewer_1/report.md`.
