# Complete Analysis Report: Main Process, Preload Scripts, IPC Bridges, and Core Backend Services

**Target Codebase:** `/Users/harshithpasupuleti/code/omni`  
**Explorer:** Explorer 1 (Main Process & Core Backend Explorer)  
**Date:** July 21, 2026

---

## 1. Executive Summary

`omni` (package name `pipper-code-alpha`, version `0.0.22`) is a desktop AI-powered code editor and multi-agent development environment built on **Electron 42**, **React 19**, **Vite 8**, **Bun**, and **Node.js (es2023 / ESM)**. It uses the **Agent Client Protocol (ACP)** over stdio JSON-RPC to interface with LLM coding agents (Cursor, OpenAI Codex, Claude Code, Opencode, Grok, Gemini, Copilot, and local mock agents).

Key Architectural Highlights:

- **Dual Window Architecture**: A primary IDE workspace window (`mainWindow`), a initial launcher/onboarding window (`launchWindow`), and an auxiliary floating UI window (`companionWindow`).
- **Strict IPC & Context Isolation**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`. Preload script exposes a typed global API object `window.omni`.
- **Built-in SQLite Storage**: Uses Node.js native `node:sqlite` (`DatabaseSync`) for projects, threads, auth users, MCP servers, and agent selection persistence.
- **Native Terminal Manager**: Integrates `node-pty` for real-time interactive terminal emulation attached to xterm.js renderer components.
- **Dual Auto-Updater System**: `LauncherUpdateManager` for binary Electron app updates via GitHub Releases, and `UpdateManager` for workspace-level code updates via Git fetch/promotion with rollback safety.
- **Extensible Subagent Framework**: `SubagentManager` with HTTP/stdio MCP proxy capabilities allowing orchestrator agents to run subagents up to a configurable max depth.

---

## 2. Project Configuration & Build Setup

### 2.1 Package Manifest (`package.json`)

- **App Identity**: Name `pipper-code-alpha`, version `0.0.22`, private bundle, ESM type (`"type": "module"`).
- **Main Entry Point**: `out/main/index.js`
- **Key Dependencies**:
  - Agent & LLM Protocols: `@agentclientprotocol/codex-acp`, `@agentclientprotocol/sdk`, `@earendil-works/pi-coding-agent`.
  - Native Bindings: `node-pty` (listed under `trustedDependencies` for Bun).
  - Telemetry: `posthog-node`.
  - UI Engine: `react` v19.2.6, `react-dom` v19.2.6, `@wterm/dom`, `@wterm/ghostty`, `@wterm/react`, `framer-motion`, `lucide-react`, `@tailwindcss/vite` v4.3.0, `zustand` v5.0.14.
- **Dev Dependencies & Build Tools**:
  - `electron` v42.3.3, `electron-builder` v26.15.2, `electron-vite` v5.0.0.
  - Runtime & Bundling: `typescript` v6.0.2, `vite` v8.0.12, `@rolldown/plugin-babel`, `babel-plugin-react-compiler`.
  - Linters/Formatters: `oxlint` v1.68.0, `oxfmt` v0.53.0.
  - Testing: `vitest` v4.1.9, `@vitest/coverage-v8`.

### 2.2 Bundling & Build Pipeline (`electron.vite.config.ts` & `scripts/build.js`)

- `electron.vite.config.ts` configures three build targets:
  1. **Main Process**: Entry `electron/main.ts` -> `out/main/index.js`. Plugin `externalizeDepsPlugin()` externalizes dependencies (`electron`, `better-sqlite3`, `node-pty`).
  2. **Preload Script**: Entry `electron/preload.ts` -> `out/preload/index.js`. Externalizes `electron`.
  3. **Renderer**: HTML entry points `index.html` (main) and `launch.html` (launch window) -> `out/renderer`. Uses Tailwind v4, React compiler via Babel, and a custom alias resolver for `@/` paths.
- `scripts/build.js`: Executes `electron-vite build` and subsequently runs `scripts/copy-template.js` to copy application workspace templates into `out/`.

### 2.3 Electron Packaging (`electron-builder.yml`)

- App ID: `com.maker-or.omni`
- Product Name: `Pipper Code (Alpha)`
- Packaging Strategy: Uses ASAR archive (`asar: true`), unpacks native binaries:
  - `**/node_modules/node-pty/**/*`
  - `**/node_modules/@agentclientprotocol/codex-acp/**/*`
  - `**/node_modules/@openai/codex*/**/*`
- Targets:
  - macOS: DMG (`arm64`), Category `public.app-category.developer-tools`, entitlements in `build/entitlements.mac.plist`.
  - Windows: NSIS installer (`x64`).

### 2.4 TypeScript Configuration

- Root `tsconfig.json` references `tsconfig.app.json`, `tsconfig.node.json`, and `tsconfig.electron.json`.
- `tsconfig.electron.json` targets `es2023`, ES modules, includes types `bun`, `node`, `electron`, covering `electron/`, `contracts/`, and `electron.vite.config.ts`.

---

## 3. Electron Main Process Architecture

### 3.1 Main Entry Point & App Lifecycle (`electron/main.ts`)

- **Single Instance Lock**: Checks `app.requestSingleInstanceLock()`. Quits immediately if another instance is already running.
- **Global Error Protection**: Listens on `process.on("uncaughtException")` and `process.on("unhandledRejection")` to prevent unexpected agent or runtime errors from crashing the main process.
- **Initialization Sequence (`app.whenReady()`)**:
  1. Calls `startUsageHeartbeat()` to track active attention time every 60s via PostHog.
  2. Sets macOS dock icon if on Darwin platform.
  3. Constructs native Application Menu via `buildAppMenu()`.
  4. Initializes SQLite database handle via `getDb()`.
  5. Instantiates `AgentManager`, `UpdateManager` (app workspace updater), and `LauncherUpdateManager` (electron binary updater).
  6. Registers all IPC handlers via `registerIpc()`.
  7. Begins periodic update checks.
  8. Verifies workspace readiness (`isWorkspaceReady()`). If ready, starts `ensureWorkspaceReady()`, initializes update subsystem, checks launch state, and creates either `mainWindow` or `launchWindow`. If workspace setup is required, opens `launchWindow` and spawns `runWorkspaceSetupForLauncher()` in background.
- **Quit Handlers**:
  - `before-quit`: Intercepts quit if an update is scheduled for quit (`scheduled_for_quit`), completes update promotion, then quits.
  - `will-quit`: Closes auth HTTP server, cancels timers, kills active `node-pty` processes and Vite compiler subprocesses, disposes `AgentManager`, and flushes PostHog analytics (`shutdownAnalytics()`).

### 3.2 Window Management & Security

1. **Main Window (`mainWindow`)**:
   - Bounds: 1280x800 (min 720x480).
   - Window Title: Set to a short random ID (e.g. `generateRandomId()`).
   - WebPreferences: `preload: out/preload/index.js`, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`.
   - Security Handler: `webContents.setWindowOpenHandler` blocks unauthorized external navigation; only allowed URLs (Clerk auth domain) pass through to `shell.openExternal`.
   - Dynamic Dev Server: Spawns local Vite dev server on an available port (`bun run vite --host 127.0.0.1`) and loads the URL.
2. **Launch Window (`launchWindow`)**:
   - Bounds: 960x720 (min 640x560). Title: "Welcome to Pipper Code (Alpha)".
   - WebPreferences: `preload: out/preload/index.js`, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`.
   - Loads `launch.html` with query stage (`list`, `add`, or `onboarding`).
3. **Companion Window (`companionWindow`)**:
   - Bounds: Restored from `companion-state.json` (default 400x640, min 320x480).
   - Parent: `mainWindow`, Title: "Companion", titleBarStyle: `"hidden"`.
   - Unaccepted Edit Protection: When closing, prompts user with a dialog if dirty visual edit changes exist ("Keep Editing", "Reject Changes", "Close Without Reverting").

---

## 4. Preload Scripts & IPC Bridge Mapping

### 4.1 Preload Script (`electron/preload.ts`)

The preload script uses `contextBridge.exposeInMainWorld("omni", api)` to expose a secure bridge API object (`window.omni`) to the renderer process.

The TypeScript interface is defined in `/Users/harshithpasupuleti/code/omni/src/electron.d.ts` as `Window.omni`.

### 4.2 Complete Map of IPC Channels

#### IPC Invocation Channels (`ipcMain.handle` / `ipcRenderer.invoke`)

| Channel                                 | Preload API Method                                 | Args                                                                  | Return Type                                                        | Description                                               |
| --------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| `launcher-update:check`                 | `omni.launcherUpdate.check()`                      | None                                                                  | `Promise<LauncherUpdateState>`                                     | Checks for launcher app binary updates.                   |
| `launcher-update:getState`              | `omni.launcherUpdate.getState()`                   | None                                                                  | `Promise<LauncherUpdateState>`                                     | Gets current launcher update state.                       |
| `launcher-update:isDismissedForSession` | `omni.launcherUpdate.isDismissedForSession()`      | None                                                                  | `Promise<boolean>`                                                 | Returns true if update dialog was dismissed this session. |
| `launcher-update:download`              | `omni.launcherUpdate.download()`                   | None                                                                  | `Promise<LauncherUpdateState>`                                     | Starts downloading launcher installer.                    |
| `launcher-update:cancelDownload`        | `omni.launcherUpdate.cancelDownload()`             | None                                                                  | `Promise<LauncherUpdateState>`                                     | Cancels launcher download.                                |
| `launcher-update:dismissForSession`     | `omni.launcherUpdate.dismissForSession()`          | None                                                                  | `Promise<LauncherUpdateState>`                                     | Dismisses launcher update prompt for current session.     |
| `launcher-update:retryDownload`         | `omni.launcherUpdate.retryDownload()`              | None                                                                  | `Promise<LauncherUpdateState>`                                     | Retries failed launcher download.                         |
| `launcher-update:openDownloadFolder`    | `omni.launcherUpdate.openDownloadFolder()`         | None                                                                  | `Promise<void>`                                                    | Opens OS folder containing downloaded installer.          |
| `launcher-update:downloadInBrowser`     | `omni.launcherUpdate.downloadInBrowser()`          | None                                                                  | `Promise<void>`                                                    | Opens default browser to installer URL.                   |
| `launcher-update:clearDownloadedUpdate` | `omni.launcherUpdate.clearDownloadedUpdate()`      | None                                                                  | `Promise<LauncherUpdateState>`                                     | Removes downloaded installer file.                        |
| `launcher-update:getDiagnostics`        | `omni.launcherUpdate.getDiagnostics()`             | None                                                                  | `Promise<LauncherUpdateDiagnostics>`                               | Gets update system diagnostic details.                    |
| `launcher-update:copyDiagnostics`       | `omni.launcherUpdate.copyDiagnostics()`            | None                                                                  | `Promise<void>`                                                    | Copies update diagnostics to clipboard.                   |
| `launcher-update:installAndQuit`        | `omni.launcherUpdate.installAndQuit()`             | None                                                                  | `Promise<{ success: boolean; error?: string }>`                    | Launches external installer and quits app.                |
| `update:check`                          | `omni.update.check()`                              | None                                                                  | `Promise<UpdateState>`                                             | Checks for workspace/code updates.                        |
| `update:getState`                       | `omni.update.getState()`                           | None                                                                  | `Promise<UpdateState>`                                             | Gets current workspace UpdateState.                       |
| `update:getManifest`                    | `omni.update.getManifest()`                        | None                                                                  | `Promise<UpdateManifest \| null>`                                  | Fetches remote workspace update manifest.                 |
| `update:getInstallation`                | `omni.update.getInstallation()`                    | None                                                                  | `Promise<InstallationMetadata>`                                    | Reads workspace installation metadata.                    |
| `update:getRun`                         | `omni.update.getRun(runId)`                        | `runId: string`                                                       | `Promise<UpdateRunRecord \| null>`                                 | Gets record/transcript of update run.                     |
| `update:getUpdaterSnapshot`             | `omni.update.getUpdaterSnapshot()`                 | None                                                                  | `Promise<AcpSessionState>`                                         | Gets snapshot of background updater agent.                |
| `update:scheduleForQuit`                | `omni.update.scheduleForQuit()`                    | None                                                                  | `Promise<UpdateState>`                                             | Schedules update execution when app quits.                |
| `update:startNow`                       | `omni.update.startNow()`                           | None                                                                  | `Promise<UpdateRunResult>`                                         | Starts workspace update immediately.                      |
| `update:retryFailedUpdate`              | `omni.update.retryFailedUpdate()`                  | None                                                                  | `Promise<UpdateState>`                                             | Retries failed workspace update.                          |
| `update:dismiss`                        | `omni.update.dismiss()`                            | None                                                                  | `Promise<UpdateState>`                                             | Dismisses workspace update notification.                  |
| `update:cancel`                         | `omni.update.cancel()`                             | None                                                                  | `Promise<UpdateRunResult>`                                         | Cancels running workspace update.                         |
| `update:markActiveHealthy`              | `omni.update.markActiveHealthy(version)`           | `version: string`                                                     | `Promise<boolean>`                                                 | Marks current version as healthy.                         |
| `update:quitWithoutUpdating`            | `omni.update.quitWithoutUpdating()`                | None                                                                  | `Promise<void>`                                                    | Cancels scheduled update and quits app.                   |
| `projects:list`                         | `omni.projects.list()`                             | None                                                                  | `Promise<Project[]>`                                               | Lists all registered projects from SQLite.                |
| `projects:getActive`                    | `omni.projects.getActive()`                        | None                                                                  | `Promise<Project \| null>`                                         | Returns active project or null.                           |
| `projects:listFiles`                    | `omni.projects.listFiles()`                        | None                                                                  | `Promise<string[]>`                                                | Lists git files in active workspace.                      |
| `projects:create`                       | `omni.projects.create(input)`                      | `input: CreateProjectInput`                                           | `Promise<Project>`                                                 | Creates a new project entry.                              |
| `projects:setActive`                    | `omni.projects.setActive(projectId)`               | `projectId: string`                                                   | `Promise<void>`                                                    | Sets active project ID.                                   |
| `dialog:pickDirectory`                  | `omni.dialog.pickDirectory()`                      | None                                                                  | `Promise<string \| null>`                                          | Displays native folder picker dialog.                     |
| `worktrees:list`                        | `omni.worktrees.list(projectId)`                   | `projectId: string`                                                   | `Promise<Worktree[]>`                                              | Lists git worktrees for a project.                        |
| `worktrees:switch`                      | `omni.worktrees.switch(input)`                     | `input: { projectId: string; path: string }`                          | `Promise<Thread>`                                                  | Switches active worktree target.                          |
| `worktrees:getSelections`               | `omni.worktrees.getSelections()`                   | None                                                                  | `Promise<Record<string, string>>`                                  | Gets map of selected worktrees per project.               |
| `worktrees:listBranches`                | `omni.worktrees.listBranches(input)`               | `input: { projectId: string }`                                        | `Promise<GitBranch[]>`                                             | Lists git branches for project.                           |
| `worktrees:switchBranch`                | `omni.worktrees.switchBranch(input)`               | `input: { projectId: string; path: string; branch: string }`          | `Promise<{ thread: Thread; worktree: Worktree }>`                  | Switches git branch in worktree.                          |
| `worktrees:create`                      | `omni.worktrees.create(input)`                     | `input: { projectId: string; name: string }`                          | `Promise<Worktree>`                                                | Creates a new worktree & branch.                          |
| `shell:openExternal`                    | `omni.shell.openExternal(url)`                     | `url: string`                                                         | `Promise<void>`                                                    | Opens external URL in browser.                            |
| `launch:complete`                       | `omni.launch.complete(projectId)`                  | `projectId: string`                                                   | `Promise<void>`                                                    | Completes onboarding & launches main window.              |
| `launch:show`                           | `omni.launch.show(stage)`                          | `stage?: "list" \| "add" \| "onboarding"`                             | `Promise<void>`                                                    | Displays launch window at specified stage.                |
| `launch:isWorkspaceReady`               | `omni.launch.isReady()`                            | None                                                                  | `Promise<boolean>`                                                 | Checks runtime & workspace readiness.                     |
| `launch:getUser`                        | `omni.launch.getUser()`                            | None                                                                  | `Promise<{ name: string \| null; email: string \| null } \| null>` | Gets authenticated user profile.                          |
| `companion:open`                        | `omni.companion.open()`                            | None                                                                  | `Promise<void>`                                                    | Opens floating companion window.                          |
| `threads:list`                          | `omni.threads.list()`                              | None                                                                  | `Promise<Thread[]>`                                                | Lists all threads.                                        |
| `threads:listByIds`                     | `omni.threads.listByIds(ids)`                      | `ids: string[]`                                                       | `Promise<Thread[]>`                                                | Lists threads matching given IDs.                         |
| `threads:listProject`                   | `omni.threads.listProject(input)`                  | `input: { projectId: string; limit?: number; offset?: number }`       | `Promise<ThreadPage>`                                              | Gets paginated threads for project.                       |
| `threads:create`                        | `omni.threads.create(...)`                         | `projectId, title, afterThreadId, agentId, worktreePath`              | `Promise<Thread>`                                                  | Creates new thread row & agent session.                   |
| `threads:rename`                        | `omni.threads.rename(id, title)`                   | `id: string, title: string`                                           | `Promise<Thread>`                                                  | Renames thread.                                           |
| `threads:delete`                        | `omni.threads.delete(id)`                          | `id: string`                                                          | `Promise<void>`                                                    | Deletes thread.                                           |
| `tabs:listOpen`                         | `omni.tabs.listOpen()`                             | None                                                                  | `Promise<OpenTabsState>`                                           | Gets open thread tabs state.                              |
| `tabs:open`                             | `omni.tabs.open(threadId)`                         | `threadId: string`                                                    | `Promise<OpenTabsState>`                                           | Opens thread tab.                                         |
| `tabs:close`                            | `omni.tabs.close(threadId)`                        | `threadId: string`                                                    | `Promise<OpenTabsState>`                                           | Closes thread tab.                                        |
| `tabs:setActive`                        | `omni.tabs.setActive(threadId)`                    | `threadId: string \| null`                                            | `Promise<OpenTabsState>`                                           | Sets active thread tab.                                   |
| `tabs:getActive`                        | `omni.tabs.getActive()`                            | None                                                                  | `Promise<string \| null>`                                          | Gets active thread tab ID.                                |
| `agent:getState`                        | `omni.agent.getState()`                            | None                                                                  | `Promise<AcpSessionState>`                                         | Gets ACP session state for active thread.                 |
| `agent:getCommands`                     | `omni.agent.getCommands()`                         | None                                                                  | `Promise<AvailableCommand[]>`                                      | Gets slash commands for active agent.                     |
| `agent:getConfigOptions`                | `omni.agent.getConfigOptions()`                    | None                                                                  | `Promise<SessionConfigOption[]>`                                   | Gets ACP config options (models, options).                |
| `agent:getCapabilities`                 | `omni.agent.getCapabilities()`                     | None                                                                  | `Promise<AgentCapabilities \| null>`                               | Gets agent capabilities matrix.                           |
| `agent:getStats`                        | `omni.agent.getStats()`                            | None                                                                  | `Promise<{ used: number; size: number; cost?: ... } \| null>`      | Gets token & cost statistics.                             |
| `agent:getRunningThreads`               | `omni.agent.getRunningThreads()`                   | None                                                                  | `Promise<string[]>`                                                | Gets running thread IDs.                                  |
| `agent:sendPrompt`                      | `omni.agent.sendPrompt(input)`                     | `input: AcpPromptInput`                                               | `Promise<void>`                                                    | Sends user message prompt to agent.                       |
| `agent:replacePrompt`                   | `omni.agent.replacePrompt(input)`                  | `input: AcpReplacePromptInput`                                        | `Promise<void>`                                                    | Replaces/steers current prompt stream.                    |
| `agent:abort`                           | `omni.agent.abort()`                               | None                                                                  | `Promise<void>`                                                    | Aborts current agent generation turn.                     |
| `agent:switchThread`                    | `omni.agent.switchThread(threadId)`                | `threadId: string`                                                    | `Promise<void>`                                                    | Switches agent session to thread ID.                      |
| `agent:createThread`                    | `omni.agent.createThread(...)`                     | `projectId, title, afterThreadId, agentId, worktreePath`              | `Promise<Thread>`                                                  | Creates new thread via AgentManager.                      |
| `agent:setConfigOption`                 | `omni.agent.setConfigOption(configId, value)`      | `configId: string, value: string \| boolean`                          | `Promise<SessionConfigOption[]>`                                   | Updates agent configuration option.                       |
| `agent:respondToPermission`             | `omni.agent.respondToPermission(resp)`             | `resp: { sessionId: string; optionId?: string; cancelled?: boolean }` | `Promise<void>`                                                    | Responds to permission prompt.                            |
| `agent:listAgents`                      | `omni.agent.listAgents()`                          | None                                                                  | `Promise<AcpAgentDescriptor[]>`                                    | Lists available ACP agents.                               |
| `agent:probeAgent`                      | `omni.agent.probeAgent(agentId)`                   | `agentId: string`                                                     | `Promise<AgentProbeResult>`                                        | Performs live probe of agent binary.                      |
| `agent:switchAgent`                     | `omni.agent.switchAgent(agentId)`                  | `agentId: string`                                                     | `Promise<void>`                                                    | Switches active agent engine.                             |
| `agent:getPreferredAgentId`             | `omni.agent.getPreferredAgentId()`                 | None                                                                  | `Promise<string>`                                                  | Gets preferred agent ID.                                  |
| `agent:setPreferredAgentId`             | `omni.agent.setPreferredAgentId(agentId)`          | `agentId: string`                                                     | `Promise<void>`                                                    | Sets preferred agent ID.                                  |
| `agent:getSelectedAgentIds`             | `omni.agent.getSelectedAgentIds()`                 | None                                                                  | `Promise<string[]>`                                                | Gets list of selected agent IDs.                          |
| `agent:setSelectedAgentIds`             | `omni.agent.setSelectedAgentIds(ids)`              | `ids: string[]`                                                       | `Promise<void>`                                                    | Saves selected agent IDs list.                            |
| `agent:closeThreadSession`              | `omni.agent.closeThreadSession(threadId)`          | `threadId: string`                                                    | `Promise<void>`                                                    | Closes agent session for thread.                          |
| `agent:setEditorText`                   | `omni.agent.setEditorText(text)`                   | `text: string`                                                        | `Promise<void>`                                                    | Sets scratchpad editor text.                              |
| `agent:getEditorText`                   | `omni.agent.getEditorText()`                       | None                                                                  | `Promise<string>`                                                  | Reads scratchpad editor text.                             |
| `agent:pasteToEditor`                   | `omni.agent.pasteToEditor(text)`                   | `text: string`                                                        | `Promise<void>`                                                    | Pastes text into scratchpad editor.                       |
| `subagents:getConfig`                   | `omni.subagents.getConfig()`                       | None                                                                  | `Promise<SubagentConfig>`                                          | Gets subagent system settings.                            |
| `subagents:setConfig`                   | `omni.subagents.setConfig(partial)`                | `partial: Partial<SubagentConfig>`                                    | `Promise<SubagentConfig>`                                          | Updates subagent configuration.                           |
| `subagents:listRuns`                    | `omni.subagents.listRuns()`                        | None                                                                  | `Promise<SubagentRunSnapshot[]>`                                   | Lists active and recent subagent runs.                    |
| `mcp:list`                              | `omni.mcp.list()`                                  | None                                                                  | `Promise<McpServerRecord[]>`                                       | Lists registered MCP servers.                             |
| `mcp:create`                            | `omni.mcp.create(input)`                           | `input: McpServerInput`                                               | `Promise<McpServerRecord>`                                         | Creates new MCP server record.                            |
| `mcp:update`                            | `omni.mcp.update(id, input)`                       | `id: string, input: Partial<McpServerInput>`                          | `Promise<McpServerRecord \| null>`                                 | Updates MCP server settings.                              |
| `mcp:delete`                            | `omni.mcp.delete(id)`                              | `id: string`                                                          | `Promise<void>`                                                    | Deletes MCP server.                                       |
| `terminal:create`                       | `omni.terminal.create(sessionId, cwd)`             | `sessionId: string, cwd?: string`                                     | `Promise<void>`                                                    | Spawns interactive PTY session.                           |
| `terminal:kill`                         | `omni.terminal.kill(sessionId)`                    | `sessionId: string`                                                   | `Promise<void>`                                                    | Kills active PTY session.                                 |
| `theme:getCurrent`                      | `omni.theme.getCurrent()`                          | None                                                                  | `Promise<string>`                                                  | Gets current active UI theme.                             |
| `editor:activate`                       | `omni.editor.activate()`                           | None                                                                  | `Promise<void>`                                                    | Activates visual edit mode session.                       |
| `editor:getState`                       | `omni.editor.getState()`                           | None                                                                  | `Promise<AcpSessionState>`                                         | Gets companion editor session state.                      |
| `editor:sendPrompt`                     | `omni.editor.sendPrompt(input)`                    | `input: { message: string; images?: ... }`                            | `Promise<void>`                                                    | Sends prompt to companion agent.                          |
| `editor:abort`                          | `omni.editor.abort()`                              | None                                                                  | `Promise<void>`                                                    | Aborts companion editor generation turn.                  |
| `editor:setModel`                       | `omni.editor.setModel(model)`                      | `model: { provider?: string; modelId: string }`                       | `Promise<boolean>`                                                 | Changes model for visual editor.                          |
| `editor:dispose`                        | `omni.editor.dispose()`                            | None                                                                  | `Promise<void>`                                                    | Disposes companion editor session.                        |
| `analytics:componentMutationRequested`  | `omni.analytics.componentMutationRequested(input)` | `input: { componentId?: string; source?: ... }`                       | `Promise<void>`                                                    | Tracks component edit request event.                      |
| `pipper:setProcessing`                  | `omni.pipper.setProcessing(id)`                    | `processingId: string \| null`                                        | `Promise<void>`                                                    | Sets processing indicator state.                          |
| `pipper:setOverlayVisible`              | `omni.pipper.setOverlayVisible(visible)`           | `visible: boolean`                                                    | `Promise<void>`                                                    | Controls visual edit overlay visibility.                  |
| `pipper:enterEditMode`                  | `omni.pipper.enterEditMode()`                      | None                                                                  | `Promise<void>`                                                    | Enters visual edit mode.                                  |
| `pipper:exitEditMode`                   | `omni.pipper.exitEditMode()`                       | None                                                                  | `Promise<void>`                                                    | Exits visual edit mode.                                   |
| `pipper:addComment`                     | `omni.pipper.addComment(id, text)`                 | `pipperId: string, text: string`                                      | `Promise<void>`                                                    | Adds visual comment tag.                                  |
| `pipper:acceptChanges`                  | `omni.pipper.acceptChanges(intent)`                | `intent?: string`                                                     | `Promise<{ committed: boolean; filesChanged: string[] }>`          | Commits edit changes to git repository.                   |
| `pipper:rejectChanges`                  | `omni.pipper.rejectChanges()`                      | None                                                                  | `Promise<void>`                                                    | Reverts edit changes to baseline.                         |
| `onboarding:verifyGit`                  | `omni.onboarding.verifyGit()`                      | None                                                                  | `Promise<boolean>`                                                 | Checks Git availability.                                  |
| `onboarding:startSetup`                 | `omni.onboarding.startSetup()`                     | None                                                                  | `Promise<void>`                                                    | Runs runtime & workspace setup.                           |

#### One-Way Event Channels (`ipcMain.on` / `ipcRenderer.send`)

| Channel                  | Preload API Method                            | Args                                                | Description                              |
| ------------------------ | --------------------------------------------- | --------------------------------------------------- | ---------------------------------------- |
| `companion:minimize`     | `omni.companion.minimize()`                   | None                                                | Minimizes companion window.              |
| `companion:close`        | `omni.companion.close()`                      | None                                                | Requests companion window close.         |
| `agent:reportEditorText` | `omni.agent.reportEditorText(text)`           | `text: string`                                      | Syncs editor draft text to main process. |
| `terminal:write`         | `omni.terminal.write(sessionId, data)`        | `{ sessionId: string; data: string }`               | Sends keystrokes to PTY process.         |
| `terminal:resize`        | `omni.terminal.resize(sessionId, cols, rows)` | `{ sessionId: string; cols: number; rows: number }` | Resizes PTY terminal grid dimensions.    |
| `theme:changed`          | `omni.theme.changed(theme)`                   | `theme: string`                                     | Notifies main process of theme change.   |

#### Main-to-Renderer Push Events (`webContents.send` / `ipcRenderer.on`)

| Channel                               | Preload Listener Hook                           | Payload Type                                                                      | Description                                                 |
| ------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `launch:workspaceReady`               | `omni.launch.onWorkspaceReady(cb)`              | `{}`                                                                              | Workspace & dependencies ready notification.                |
| `launch:workspaceError`               | `omni.launch.onWorkspaceError(cb)`              | `{ message: string }`                                                             | Background workspace setup error.                           |
| `launch:authComplete`                 | `omni.launch.onAuthComplete(cb)`                | `AuthUserRecord`                                                                  | OAuth authentication completed.                             |
| `update:stateChanged`                 | `omni.update.onStateChanged(cb)`                | `UpdateState`                                                                     | Code update state update.                                   |
| `update:progress`                     | `omni.update.onProgress(cb)`                    | `UpdateProgress`                                                                  | Code update download/apply progress.                        |
| `updater:event`                       | `omni.update.onUpdaterEvent(cb)`                | `AcpBridgeEvent`                                                                  | Background updater agent event.                             |
| `launcher-update:stateChanged`        | `omni.launcherUpdate.onStateChanged(cb)`        | `LauncherUpdateState`                                                             | Launcher binary update state.                               |
| `launcher-update:progress`            | `omni.launcherUpdate.onProgress(cb)`            | `LauncherDownloadProgress`                                                        | Launcher download progress.                                 |
| `launcher-update:openDetails`         | `omni.launcherUpdate.onOpenDetails(cb)`         | `{}`                                                                              | Signal to open update details modal.                        |
| `launcher-update:dismissedForSession` | `omni.launcherUpdate.onDismissedForSession(cb)` | `{}`                                                                              | Update prompt dismissed signal.                             |
| `projects:activeChanged`              | `omni.projects.onActiveChanged(cb)`             | `projectId: string`                                                               | Active project changed signal.                              |
| `worktrees:setupProgress`             | `omni.worktrees.onSetupProgress(cb)`            | `WorktreeSetupProgress`                                                           | Background dependency install status for new worktrees.     |
| `onboarding:progress`                 | `omni.onboarding.onProgress(cb)`                | `{ step: string; status: string; error?: string; gitInstalled?: boolean }`        | First-run setup progress.                                   |
| `tabs:changed`                        | `omni.tabs.onChanged(cb)`                       | `OpenTabsState`                                                                   | Open thread tabs state change.                              |
| `agent:event`                         | `omni.agent.onEvent(cb)`                        | `AcpBridgeEvent`                                                                  | Agent streaming update (text chunk, tool call, permission). |
| `editor:event`                        | `omni.editor.onEvent(cb)`                       | `AcpBridgeEvent`                                                                  | Companion editor agent streaming event.                     |
| `terminal:data`                       | `omni.terminal.onData(cb)`                      | `{ sessionId: string; data: string }`                                             | Terminal stdout/stderr output.                              |
| `terminal:exit`                       | `omni.terminal.onExit(cb)`                      | `{ sessionId: string; exitCode: number; signal?: number }`                        | Terminal process exit notification.                         |
| `pipper:stateChanged`                 | `omni.pipper.onStateChanged(cb)`                | `{ processingId?: string \| null; editMode?: boolean; overlayVisible?: boolean }` | Visual edit mode state change.                              |
| `pipper:commentAdded`                 | `omni.pipper.onCommentAdded(cb)`                | `{ pipperId: string; text: string }`                                              | Visual comment added to element.                            |
| `theme:changed`                       | `omni.theme.onChanged(cb)`                      | `theme: string`                                                                   | Global UI theme changed.                                    |

---

## 5. Core Backend Services & Native Integrations

### 5.1 SQLite Data Persistence (`electron/db.ts`)

- **Database Engine**: Uses Node.js native `DatabaseSync` from `node:sqlite`.
- **Database Location**: Stores SQLite DB at `app.getPath("userData")/omni.sqlite`.
- **Schema & Migrations**:
  - `projects`: `id`, `path` (UNIQUE), `name`, `icon`.
  - `threads`: `id`, `project_id` (FK), `agent_id`, `agent_session_id`, `title`, `worktree_path`, `sort_order`, `created_at`, `last_used_at`. Rebuilt automatically if legacy constraints exist.
  - `user_agent_selections`: `agent_id`, `selected_at`.
  - `mcp_servers`: `id`, `name`, `transport_type`, `url`, `command`, `args`, `env`, `created_at`, `updated_at`.
  - `auth_users`: `provider`, `provider_user_id` (PK), `email`, `name`, `avatar_url`, `created_at`, `updated_at`, `last_seen_at`.
- **JSON File Stores**:
  - `companion-state.json`: Saved window position & dimensions.
  - `launch-state.json`: Selected project ID & completion status.
  - `subagents.json`: Config options for subagent depth, timeouts, and max concurrency.

### 5.2 Agent Client Protocol (ACP) & AI/LLM Integration (`electron/agent-connection-manager.ts`, `electron/agents/registry.ts`)

- **Protocol**: Implements `@agentclientprotocol/sdk` JSON-RPC connection over stdio.
- **Agent Registry**: Auto-detects installed coding agents via `probeAgentAvailability`:
  - `cursor-acp` (Cursor CLI over stdio)
  - `codex-acp` (OpenAI Codex via bundled `@agentclientprotocol/codex-acp`)
  - `claude-agent-acp` (Anthropic Claude Code)
  - `opencode-acp` (Opencode CLI)
  - `grok-acp` (xAI Grok Build CLI)
  - `gemini-acp` (Google Gemini CLI)
  - `copilot-acp` (GitHub Copilot CLI)
  - `pipper-mock` (Local NodeJS mock agent for testing)
- **Session State Management**: Manages session lifecycle (`ThreadSessionRuntime`), reducer-driven state (`acp-session-reducer.ts`), prompt streaming, model selection, permission responses, and stats (tokens/costs).

### 5.3 Subagents & MCP Subsystem (`electron/subagents/subagent-manager.ts`, `electron/mcp-servers.ts`)

- `SubagentManager` enables orchestrator agents to run autonomous subagents.
- Implements `McpHttpServer` and `stdio-proxy.ts` to bridge MCP tools and top-level MCP server configurations to subagent processes.

### 5.4 Native Terminal Integration (`electron/main.ts` & `node-pty`)

- Uses native C++ module `node-pty` to spawn real interactive shells (zsh/bash on macOS/Linux with `-l` login flag, powershell on Windows).
- PATH Resolution: Prepends standard binary paths (`~/.local/bin`, brew, etc.) via `prependStandardPaths()`.
- Interactive PTY processes map by `sessionId` for bidirectional streaming (`terminal:write`, `terminal:data`, `terminal:resize`).

### 5.5 File Search & Shell Execution

- **File Indexing**: `listProjectFiles()` uses `git ls-files --cached --others --exclude-standard` for performance, falling back to a 5,000-file directory walk ignoring build/node_modules dirs.
- **Shell Execution**: Standard `spawn` and `execFile` wrapped with `promisify`.

### 5.6 Automated Environment Setup & Dependency Installer (`electron/dependency-installer.ts`)

- Checks and auto-installs Git, Mise version manager, Node.js, and Bun inside `~/.pipper/library` if missing or version-mismatched.

### 5.7 Dual Auto-Updater System

1. **Launcher Update Manager (`LauncherUpdateManager`)**:
   - Manages Electron app binary updates via GitHub Releases.
   - Downloads installer files, verifies cryptographic checksums, and launches `launchLauncherInstaller()`.
2. **Workspace Code Update Manager (`UpdateManager`)**:
   - Manages workspace code updates via Git fetch/promotion.
   - Performs health checks, backup/restore of active workspace, and automatic rollback on failure.

---
