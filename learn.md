# Workspace and Agent Primitive Notes

This document captures the current direction, decisions, open questions, and things we still need to learn. It is intentionally rough for now and should evolve into a structured implementation plan.

## What we are building

We are building an extensible application shell around Pi where users and agents can add new surfaces without damaging the architecture or performance of the app.

The goal is to provide first-class primitives: stable building blocks that users and agents can compose instead of rewriting core infrastructure from scratch.

The primitives are meant to protect the codebase from becoming messy, slow, and hard to change as the application grows.

Omni does not own the mechanisms for changing or improving the agent itself. Pi already owns agent customization through its SDK and package system. Omni owns the application layer built around Pi and the bridge that supplies application context to it.

## Main architecture direction

We are moving away from a strict split between:

- agent-view
- other-view

Instead, we want a unified workspace model.

A workspace can contain many tabs. Omni ships:

- agent session
- terminal

Users and agents can add tab types such as:

- browser
- editor
- preview
- custom view
- future agentic workflow

Agent sessions are no longer special because of where they live. They are one type of workspace tab, built using the agent primitive.

## Core idea

Views should be independent by default.

A terminal view should not need to know anything about agents unless it wants to. A user-defined browser view may provide context to an agent or expose capabilities, but that is optional and layered.

The system should support simple views first, and richer agent-aware views later.

## Current primitive set

We currently believe the foundation should have five core primitives:

1. Workspace primitive
2. Agent primitive
3. Storage primitive
4. State primitive
5. Context primitive

Other possible primitives like capability, event, render lifecycle, task, artifact, permissions, and layout may come later, but they should not be forced into the v1 foundation unless clearly needed.

## Workspace primitive

The workspace primitive owns the general container model.

Responsibilities:

- tabs
- tab identity
- tab type
- active tab
- tab lifecycle
- tab switching
- basic layout
- mounting and unmounting behavior
- restoring workspace state
- preserving tab state where appropriate

The workspace primitive should make the shipped Agent and Terminal views, plus user-defined views, all feel like first-class tabs.

Important design point: workspace is about what exists. Layout may later become its own deeper concern if we need split panes, docking, pinned panels, and more complex arrangements.

## Agent primitive

The agent primitive adapts Pi's agent runtime into Omni's application and UI model. It does not replace or independently maintain Pi's agent customization system.

Responsibilities:

- expose Pi sessions and runs to application views
- project Pi messages, streaming output, errors, and tool calls into UI state
- connect cancellation and other supported controls to Pi
- attach selected Omni context to Pi runs
- synchronize Pi runtime events across the frontend/backend boundary
- provide the default Agent tab UI
- isolate high-frequency agent events from unrelated application state

Our current/default agent session should be rebuilt using this primitive.

This proves the application-facing adapter is good enough and prevents the default app from relying on private shortcuts.

Users may build different agent UIs or workflows from this application-facing contract. Changes to agent behavior, skills, prompts, providers, and self-improvement mechanisms belong to Pi and should use Pi's extension mechanisms directly.

## Storage primitive

The storage primitive exists so agents and user code do not directly create messy SQLite interactions.

Responsibilities:

- local persistence
- SQLite access control
- schemas
- migrations
- namespaced storage
- transactions
- indexes
- cleanup policies
- persistence of workspace, tabs, agent sessions, messages, settings, drafts, artifacts, and view state

The storage primitive should answer: what should survive app restart?

A key rule: views and agents should not directly write arbitrary SQL. They should use safe storage APIs.

## State primitive

The state primitive owns live runtime state.

Responsibilities:

- active tab state
- focused tab or pane
- loading state
- streaming run state
- input drafts
- transient UI state
- optimistic updates
- selected IDs
- mounted view state
- subscriptions and selectors
- derived runtime state

State is different from storage.

Storage is long-lived persisted data. State is what is happening right now.

State is also different from context.

State is internal app truth. Context is semantic information shared across surfaces and agents.

We need a first-class state primitive because random React contexts and global stores can easily cause app-wide rerenders and performance issues.

## Context primitive

The context primitive owns semantic information produced by application surfaces and made available to other surfaces or to Pi.

Responsibilities:

- context providers
- context consumers
- active context
- selected semantic entities
- context freshness and staleness
- context snapshots
- context attached to agent runs
- context size limits
- context scoping

Examples:

- terminal tab provides current working directory or selected output
- agent tab consumes relevant workspace context
- a user-defined browser tab provides its current URL, title, or selection
- a user-defined editor tab provides its active file or selection

Context should be semantic and bounded, not a raw dump of React state or full view internals.

### Context type model

The core should define one generic context envelope and payloads for only the surfaces Omni ships:

- Agent context payload
- Terminal context payload

User-defined surfaces own their payload types locally. Adding a browser, editor, file viewer, or future surface must not require editing a central core union.

The common envelope should carry only cross-cutting metadata:

- provider ID
- context kind
- source tab ID
- creation time
- freshness or revision
- payload

The payload remains generic. A provider validates its payload and converts it into a bounded representation suitable for an agent run. A runtime registry connects a context kind to its provider, validator, and formatter. Core code may provide strong built-in mappings for Agent and Terminal while preserving an open string-based extension point for custom kinds.

The important distinction is:

- TypeScript types describe a provider while its code is being built.
- Runtime registration makes that provider available to the running application.
- Runtime validation protects persisted data and process boundaries.

User-created payload types do not mutate TypeScript types at runtime and do not need to be added to a single ever-growing primitive file.

### Pi and Omni boundary

Pi owns:

- agent behavior and run semantics
- model and provider integration
- prompts, skills, tools, and extensions
- agent-level customization and self-improvement

Omni owns:

- workspace and application UI
- shipped Agent and Terminal surfaces
- application state and persistence
- registration and lifecycle of user-defined surfaces
- collection, selection, and bounding of application context
- the bridge that passes selected context into Pi and presents Pi output

The context primitive models application-surface context. It must not become a second agent memory, skill, prompt, tool, or extension system.

## Important layering decision

Not all views are agent-aware.

We can think of levels:

1. Plain view: only renders as a workspace tab
2. Context-providing view: exposes semantic information
3. Agent-controllable view: exposes actions/capabilities later
4. Agent view: consumes context and runs agent sessions

For v1, context can be mostly read-only. Agent control over other views can come later.

## Performance as a first-class goal

Performance is one of the main reasons for these primitives.

The primitives are not only developer ergonomics. They are guardrails.

We want to prevent one bad design decision by an agent or user-created feature from slowing the entire application.

Performance risks we want to prevent:

- giant global React contexts
- app-wide rerenders
- streaming tokens rerendering the whole workspace
- unbounded message arrays in hot state
- direct slow SQLite queries from UI code
- loading all historical data eagerly
- dumping huge context into agent prompts
- inactive tabs continuing expensive work forever
- duplicated state ownership
- remounting expensive views unnecessarily
- no cleanup policy for sessions, tabs, or artifacts

## Performance principles

Each primitive needs clear ownership.

Every piece of data should have one owner.

Examples:

- workspace owns tabs
- agent owns sessions, runs, messages
- storage owns persistence
- state owns live runtime subscriptions
- context owns semantic sharing

We also need to separate hot path and cold path data.

Hot path examples:

- streaming text
- current input
- active tab
- selection
- terminal output

Cold path examples:

- old messages
- workspace name
- tab metadata
- historical runs
- saved settings

Hot data must be isolated carefully. Cold data can be persisted and hydrated lazily.

## Performance expectations per primitive

Workspace primitive should ensure:

- active tab changes do not rerender every tab body
- tab metadata is separate from heavy content
- inactive tabs can be suspended or kept alive intentionally
- tab content can be lazy-loaded
- switching is smooth

Agent primitive should ensure:

- streaming updates are isolated
- long message history is virtualized or paginated
- old messages do not rerender on each token
- background agent sessions do not cause active UI jank
- large tool outputs or artifacts do not live inline in hot render state

Storage primitive should ensure:

- no unsafe direct SQLite access
- queries are scoped and indexed
- migrations are centralized
- writes can be batched or debounced where needed
- large blobs are handled separately from hot rows
- storage reads do not block render paths

State primitive should ensure:

- selector-based subscriptions
- no giant global object subscriptions
- hot and cold state are separated
- updates are localized
- high-frequency updates are throttled or isolated

Context primitive should ensure:

- context snapshots are bounded
- context is semantic, not raw state
- context updates are scoped and debounced
- background tabs do not constantly push large context
- agents receive relevant context, not everything

## Testing and performance locks

We need tests and locks from the start.

The goal is not to test every line. The goal is to test behavior, contracts, and performance regressions.

Each primitive should have:

- contract tests
- integration behavior tests
- performance regression locks
- dev/runtime invariants where useful

## Contract tests

Workspace primitive should test:

- creating tabs
- closing tabs
- switching active tabs
- preserving tab state when expected
- restoring workspace state
- invalid tab types failing safely

Agent primitive should test:

- creating sessions
- adding messages
- starting runs
- streaming updates applying to the correct run/message
- cancellation
- error recovery
- tab switching without losing run state

Storage primitive should test:

- migrations
- namespacing
- transactions
- persistence across restart
- malformed writes failing safely
- large data following the right storage path

State primitive should test:

- selector subscriptions only update when selected values change
- hot state does not trigger cold-state subscribers
- cleanup happens when tabs or sessions are removed
- ownership boundaries are respected

Context primitive should test:

- provider registration/unregistration
- active context resolution
- stale context handling
- context size limits
- scoped updates
- expected context snapshots reaching agent runs

## Performance locks

We should add regression tests or measurements for:

- tab switch render cost
- streaming update render cost
- large agent history rendering
- storage query behavior
- workspace restore behavior
- context snapshot size
- number of rerendered components during common actions

Performance budgets can start rough, but they need to exist early so regressions are visible.

## Architecture locks

Tests alone are not enough.

We should add guardrails such as:

- no direct SQLite access outside storage primitive
- no importing primitive internals from extension/user code
- no giant app-wide React context for hot state
- no raw full view state passed as context
- no storage reads directly during render
- no unbounded message rendering without virtualization or pagination
- no unauthorized primitive implementation changes

## Launcher-owned primitives

The primitives are launcher/core-owned infrastructure.

This is non-negotiable.

Agents and user-created features should build on top of primitives, not modify the primitives directly.

Launcher/core owns:

- workspace primitive
- agent primitive
- storage primitive
- state primitive
- context primitive
- primitive tests
- performance locks
- migrations
- compatibility guarantees
- runtime contracts

Agents/users own:

- custom tab types
- custom views
- context providers
- UI composition
- workflow-specific logic
- integrations through approved extension points

Agent customization itself remains owned by Pi and uses Pi packages, extensions, skills, prompts, tools, and providers.

Primitive updates should happen deliberately through the launcher/runtime update path, with tests, migrations, and compatibility considered.

## Public contracts over internals

Custom views and agents should depend on stable public primitive APIs, not implementation details.

The default app should also use the public primitives. It should not rely on private shortcuts.

This keeps the primitives honest and usable.

---

## Decisions made

The following decisions have been confirmed and should be treated as settled.

### Big bang rewrite, not incremental

This is a full rewrite. We are not migrating incrementally. All five primitives will be built and the existing application will be rebuilt on top of them. The reason is clear: the current architecture is not structured for agents to safely extend, and bolting primitives onto the existing mess would not solve the fundamental problems.

### API designed for agent consumption, not human DX

The primary consumers of these primitives are AI agents, not human developers. The public APIs must be:

- consistently named
- predictable in patterns
- comprehensively typed with TypeScript
- documented with JSDoc
- simple enough that an agent reading the type signatures can correctly compose primitives without seeing internals
- the api must be openAPI compliant

Users will not be writing code against these primitives directly. Agents will. The ergonomics should optimize for that.

### Extensibility is non-negotiable

The primitives must be open enough that agents and users can create any new view type (browser, preview, git integration, PRs, anything) without being blocked by the primitive layer not supporting their use case.

If a primitive does not support something out of the box, there must be a way for an agent to handle it on its own. We should never be in a position where a user cannot ship a feature because our primitives are not ready.

Start small and strong. Improve based on what users actually do.

### Full state restoration on restart

When the application is closed and reopened, the exact same state must be replicated. Every tab, every position, every active thread, every terminal working directory. The user should not notice the restart.

### Zustand stays as the state primitive engine

Zustand is already in the codebase and works well for React UI state. It will serve as the foundation for the State primitive in the renderer. The improvement is better discipline: enforced selectors, hot/cold separation, no giant global subscriptions.

### Workspace manager functionality preserved

The existing workspace-manager.ts (filesystem lifecycle: active/backup/candidate/promote/rollback) is good infrastructure. It should be kept and improved, not replaced. It manages a different concern (filesystem workspace) than the workspace primitive (tab model).

### V1 includes the unified workspace tab model

V1 will ship with the new unified workspace tab model. Omni ships Agent and Terminal as first-class workspace tabs. The tab type registry must support runtime registration so users and agents can add browser, editor, preview, git integration, or any other view without touching primitive code.

### Pi owns agent customization

Omni will not build a parallel system for changing the agent itself. Pi owns agent behavior, extensions, skills, prompts, tools, providers, and self-improvement. Omni provides the application UI and passes selected application context into Pi through an explicit bridge.

### Context types are open, not centrally enumerated

Core owns the generic context envelope and built-in Agent and Terminal payload contracts. Each user-defined context provider owns its payload type, runtime validator, and agent-facing formatter. Custom context kinds are registered at runtime and do not require modification of a closed core union.

### All existing launcher features must be preserved

This is non-negotiable. The rewrite must not break or lose any existing launcher functionality. Everything that works today must work after the rewrite:

- agent runtime (sessions, streaming, threads, models, analytics)
- update system (manifest checking, candidate preparation, promotion, rollback)
- workspace manager (active/backup/candidate lifecycle, git integration, dependency symlinks)
- terminal PTY (node-pty backend, ghostty frontend)
- auth flow (Clerk OAuth with local HTTP callback)
- three-window architecture (main, launch, companion)
- project management (create, switch, list files)
- pipper overlay and edit mode
- thread persistence and open tabs tracking

The primitives exist to provide better building blocks under these features, not to replace the features themselves.

## Current codebase architecture (what exists today)

The following is a detailed map of the current codebase gathered through deep analysis. This knowledge is critical for planning the rewrite.

### App entry and structure

App.tsx (326 lines) uses stage-based routing via URL query params. If stage=companion, it renders CompanionView. Otherwise it renders the main workspace with two resizable panels:

- Left: AgentView (max 40% width) — the AI chat panel
- Right: OthersView (min 40% width) — terminal, thread sidebar

No React Router. Views determined by URL params and internal state. Uses react-resizable-panels for the layout.

Header has: draggable title bar, project selector dropdown, companion open button, update check, theme toggle.

Overlays: PipperOverlay, UpdateDialog, LauncherUpdateDialog, UpdateBanner, LauncherUpdateBanner.

Issues: no formal routing, project loading is imperative (useState + useEffect), multiple useEffect chains for update initialization, all window types share the same entry point.

### Zustand stores (7 stores)

#### agent-store.ts (291 lines)

State: snapshot (AgentRuntimeSnapshot), uiRequest, isConnecting, error.

Key actions: connect, refresh, sendPrompt, replacePrompt, abort, switchThread, createThread, cycleModel, setModel, cycleThinkingLevel, compact, setEditorText, pasteToEditor, reportEditorText.

Pattern: bridge event handler via window.omni.agent.onEvent(). Custom applyBridgeEvent() reducer merges snapshot patches. Thread switch queuing with latestThreadSwitchId and pendingThreadTarget to suppress stale snapshots during switches.

Issues: tightly coupled to window.omni.agent IPC. Uses React-specific toast notifications (toast(), Warning/Info icons) directly inside the store — mixes UI concerns with state logic.

#### thread-store.ts (196 lines)

State: threads[], pagesByProject (per-project pagination), isLoading, error.

Pattern: paginated loading with THREAD_PAGE_SIZE=10, hasMore/nextOffset/isLoading per project. Prevents double-loading via isLoading guard.

Issues: direct window.omni.threads IPC calls. Maintains its own thread cache that duplicates agent store snapshot data. Thread data lives in THREE places: SQLite DB, React Query cache, and zustand store.

#### project-store.ts (30 lines)

State: activeProject, isLoading, error. Simplest store. Fetches window.omni.projects.getActive().

#### terminal-store.ts (101 lines)

State: sessions[], activeSessionId, listenerInitialized.

Pattern: history bounded at 200k chars (truncates to 100k). Global listener initialized once via flag.

Issues: terminal sessions are ephemeral — lost on reload. History lives in memory. No persistence at all.

#### pipper-store.ts (48 lines)

State: editMode, overlayVisible, processingId.

Pattern: one-way sync. Optimistic calls to window.omni.pipper.\* but local state only changes via syncFromBroadcast() driven by IPC events from main process.

#### update-store.ts (177 lines)

State: state, manifest, installation, run, progress, detailsOpen, dismissedForSession.

Pattern: subscribes to onStateChanged, onProgress, onUpdaterEvent IPC events. Session-scoped dismiss via module-level dismissedManifestVersion.

#### launcher-update-store.ts (93 lines)

State: state, progress, diagnostics, diagnosticsOpen, dismissed, pending.

Pattern: generic run() wrapper managing pending guard to prevent concurrent operations.

#### Cross-store observations

Stores are largely independent with no direct cross-store subscriptions. Agent store's snapshot.threadId implicitly links to thread-store. Project store read by App.tsx for active project.

### Electron main process — main.ts (1,927 lines)

This is the monolithic heart of the app.

#### Window management

Three BrowserWindow types: mainWindow, launchWindow, companionWindow. All share the same preload script. broadcastToWindows() sends messages to all three.

#### IPC channels (70+ handlers)

Organized into namespaces: launch, projects, threads, tabs, messages, agent, terminal, theme, editor, pipper, dialog, shell, companion, onboarding, update, launcher-update, analytics.

All registered in a single flat registerIpc() function.

#### Other main process functionality

- Auth callback HTTP server (local 127.0.0.1 for Clerk OAuth)
- Vite dev server management (startViteServer, restartViteServer)
- PTY management (ptyProcesses Map with node-pty instances keyed by sessionId)
- Pipper edit baseline tracking (git status fingerprinting before/after edits)
- File listing (listProjectFiles via git ls-files)
- App menu construction (buildAppMenu)
- Quit flow with update scheduling (before-quit intercepted for scheduled updates)

Issues: massive monolith. No separation of concerns. Terminal, auth, vite, updates, pipper edits all mixed together.

### Workspace manager — workspace-manager.ts (689 lines)

Manages the Pipper library directory structure at ~/Library/pipper/:

- active/ — current workspace (source code + git repo)
- backup/ — recovery snapshot
- shared/active-deps/ — shared node_modules (symlinked)
- candidate/ — staging for updates
- shared/candidate-deps/ — candidate dependencies
- previous/ — pre-promotion snapshot
- updates/ — update state

Key operations: initializeWorkspaces (template copy, git init, deps, symlinks), backupActiveWorkspace/restoreFromBackup (git reset hard + clean), createCandidateFromActive/promoteCandidate/rollbackPromotion (atomic update flow with rename-based swaps), assertPostSwapInvariants (promotion integrity), dev file watcher (syncs source to active workspace).

This is solid infrastructure. Keep and improve, do not replace.

### Database layer — db.ts (196 lines)

SQLite via Node's built-in node:sqlite (DatabaseSync).

Tables:

- projects: id TEXT PK, path TEXT UNIQUE, name TEXT, icon TEXT
- threads: id TEXT PK, project_id TEXT FK→projects, title TEXT, sort_order INT, session_file TEXT, created_at INT, last_used_at INT. Indexed on project_id and (project_id, last_used_at DESC)
- messages: id TEXT PK, thread_id TEXT FK→threads, role TEXT, content TEXT, created_at INT. Indexed on thread_id and (thread_id, created_at)
- auth_users: provider TEXT, provider_user_id TEXT PK, email TEXT, name TEXT, avatar_url TEXT, created_at INT, updated_at INT, last_seen_at INT. Indexed on last_seen_at DESC

Migration pattern: ensureColumn() for schema evolution. PRAGMA foreign_keys = ON. Data migration backfills created_at/last_used_at from messages. Singleton db instance.

Issues: no transaction support, no typed errors, fragile migration pattern (ensureColumn only adds columns, cannot rename/drop/restructure).

### Agent system — agent.ts (1,663 lines)

AgentManager class — the central orchestrator.

Three runtime types:

- Project runtimes (projectRuntimes Map): one per project, sessions backed by SessionManager with file-based persistence
- Editor runtime (editorRecord): ephemeral in-memory for visual editing (companion window)
- Updater runtime (updaterRecord): ephemeral in-memory for update agent

Key lifecycle: activateProject (creates/reuses runtime, syncs threads from session files, resolves active thread), switchThread (switches session file, updates active thread), createThread (new session, auto-numbered titles), deleteThread (removes session file + DB row, switches to next).

Prompt handling: sendPrompt/replacePrompt with image validation, mutation analytics, auto-fallback model cycling on error.

Event system: emit() sends AgentBridgeEvent to renderer via IPC. subscribe() on sessions for queue updates, session info, agent_end events. requestUi/respondToUiRequest for async dialogs with timeouts.

Concurrency: lockProject() serializes operations per project via promise chaining.

Analytics: startMutation/completeMutation tracks duration, outcome, error types.

Issues: monolithic class doing too many things. All three runtime types in one file. Thread management mixed with session lifecycle mixed with analytics.

### Thread system

Threads exist across three layers:

- electron/threads.ts (163 lines): CRUD on threads/messages tables. Paginated listing. Sort order management.
- electron/open-tabs.ts (93 lines): open thread tabs persisted in launch-state.json (separate from SQLite). threadSwitchHistory (max 100 entries). broadcastOpenTabsChanged to main window.
- src/lib/thread-queries.ts (144 lines): React Query hooks (useOpenTabsQuery, useProjectThreadsQuery, useRecentProjectsQuery, usePrefetchRecentProjects, useMergedProjectThreads).
- src/store/thread-store.ts (196 lines): Zustand store with its own pagination and thread caching.

Issues: thread data lives in THREE places (SQLite, React Query cache, Zustand store). useMergedProjectThreads tries to reconcile them. Open tabs state in a separate JSON file, not SQLite.

### Terminal system

terminal-store.ts: in-memory sessions with id, title, cwd, history. Sequential titles ("Terminal 1", "Terminal 2"). History bounded at 200k chars. No persistence.

terminal-session.tsx (197 lines): uses @wterm/react with @wterm/ghostty (GhosttyCore via WASM). ResizeObserver for layout measurement. Two-phase: measure then render terminal. PTY backend via window.omni.terminal.create.

Main process terminal (in main.ts): node-pty instances in ptyProcesses Map. Default shell detection ($SHELL or bash). Login shell args (-l) for zsh/bash. terminal:data and terminal:exit events to renderer.

Issues: no terminal persistence (sessions lost on reload), no terminal multiplexing, PTY processes not cleaned up if renderer crashes.

### Preload/IPC bridge — preload.ts (366 lines)

Exposes window.omni with typed API namespaces: launch, shell, update, launcherUpdate, projects, onboarding, threads, tabs, messages, agent, dialog, terminal, companion, editor, analytics, pipper, theme.

Patterns: ipcRenderer.invoke() for request-response, ipcRenderer.send() for fire-and-forget, event listeners return cleanup functions.

### Existing test coverage

6 behavior test files in src/store/:

- agent-store.behavior.test.ts (205 lines): thread switch queuing, stale snapshot filtering, UI request lifecycle, error surfacing
- thread-store.behavior.test.ts (183 lines): pagination, error recovery, add/create/rename/delete, offset adjustment
- terminal-store.behavior.test.ts (105 lines): session creation/close/clear, global listener idempotency, history bounding
- pipper-store.behavior.test.ts (65 lines): broadcast-as-source-of-truth, partial broadcast merging
- project-store.behavior.test.ts (97 lines): load/clear, error preservation
- update-store.test.ts (112 lines): session-scoped dismiss, retry flow

3 utility test files in src/lib/:

- agent-commands.test.ts
- agent-message-images.test.ts
- message-utils.test.ts

Testing patterns: Vitest, mock window.omni on globalThis, reset stores via setState, behavior-driven naming (.behavior.test.ts), no rendering tests — pure store logic only.

### Key things that must be preserved in the rewrite

1. Agent runtime lifecycle: project activation, session management, thread-session linkage, queue/steering, streaming, model cycling, analytics
2. Three-window architecture: main, launch, companion with cross-window state broadcast
3. Workspace management: active/backup/candidate/previous lifecycle, git integration, dependency symlinks
4. SQLite schema: projects, threads, messages, auth_users tables (migrate, not drop)
5. Thread persistence: session files ↔ threads linkage, sort ordering, pagination
6. Terminal PTY: node-pty backend, ghostty frontend, history buffering
7. Update system: manifest checking, candidate preparation, atomic promotion, rollback
8. Auth flow: local HTTP callback server for Clerk OAuth
9. Open tabs state: persisted with history

### Key things that need untangling

1. main.ts is monolithic (1,927 lines): window management, IPC, auth, vite, terminal, pipper edits, updates, onboarding all in one file
2. agent.ts is monolithic (1,663 lines): project runtimes, editor runtime, updater runtime, thread management, analytics all in AgentManager
3. Thread data in 3 places: SQLite, React Query cache, Zustand store — needs single source of truth
4. Agent store mixes UI concerns: toast notifications with React elements inside a zustand store
5. Pipper edit baseline: tracked via module-level Map in main.ts, tightly coupled to git operations
6. Open tabs state: lives in launch-state.json separate from SQLite

### Key things to improve in the rewrite

1. No formal routing — just URL param checking
2. No terminal persistence — sessions lost on reload
3. No store persistence — all zustand stores are in-memory only
4. Redundant data fetching — thread data fetched by both zustand and React Query
5. Inconsistent IPC channel naming
6. Inconsistent error handling — some throw, some set error state, some toast
7. Module-level state in agent-store.ts makes testing harder

---

## Primitive dependency order

The primitives have a natural dependency order for building:

```
Storage (standalone) → State (standalone) → Workspace (Storage + State)
    → Context (Workspace + State) → Agent (all four)
```

Storage and State are foundations with no dependencies on other primitives. Workspace needs Storage for tab persistence and State for active tab tracking. Context needs Workspace for provider registration per tab and State for active context. Agent needs all four.

---

## Process boundary architecture

The Electron main process owns durable services and orchestration. The renderer stays React 19 + Zustand + React Query.

Main process:

- StorageService: SQLite wrapper with typed queries, migrations, transactions, namespacing
- PiAdapterService: bridges Pi sessions, events, controls, and context into Omni
- WorkspaceService: tab lifecycle, persistence, snapshot/restore
- ContextService: provider registry, validation, snapshot management, size limits

Renderer (React + Zustand + React Query):

- State stores built on Zustand with hot/cold separation
- Tab registry for extensible view types
- Context hooks for consuming cross-tab information
- Agent hooks and views for chat UI

IPC bridge connects the two layers. Each primitive registers its own IPC handlers.

## Things we still need to learn

### Product and UX questions

- Should the UI expose one flat parent tab bar, or grouped tabs by type?
- How should Agent and Terminal tabs relate to user-defined tabs visually?
- Should an agent consume only active tab context by default?
- Should users be able to pin context from another tab?
- How should context be shown to the user before it is sent to an agent?
- What does smooth tab switching feel like in practice?
- How much state should be preserved for inactive tabs?

### Architecture questions

- What is the exact public contract for a workspace tab?
- What is the exact application-facing adapter contract over Pi?
- What is the exact generic context envelope?
- How are context validators and agent-facing formatters registered?
- How do we version primitive contracts?
- How do we enforce that agents cannot mutate primitive internals?
- What belongs in workspace versus state versus storage?
- When does layout become its own primitive?
- When do capabilities become necessary?

### Storage questions

- What should be stored in SQLite versus files/blobs?
- How do custom views get namespaced storage safely?
- What data should be eagerly loaded versus lazily loaded?

Resolved storage questions:

- What local database should be used? SQLite via node:sqlite
- How do migrations work? Filesystem-based migration system replacing the current ensureColumn() pattern
- How do we prevent slow queries by design? Scoped queries via storage primitive API, no direct SQL from view code

### State questions

- How do we measure rerender boundaries?
- How does state sync with storage?

Resolved state questions:

- What state library or pattern should be used? Zustand with enforced selectors, hot/cold separation, and a store factory
- How do we guarantee selector-based updates? Store factory applies subscribeWithSelector middleware by default, API surface exposes useHot/useCold instead of raw getState
- How do we separate hot and cold state clearly? Store factory takes hotSlice and coldSlice configuration, separate subscription paths

### Agent questions

- What is the minimum Pi adapter API needed by Omni's UI?
- How do we isolate streaming updates?
- How do we virtualize or paginate message history?
- How do we persist sessions without loading everything eagerly?
- How do agent runs attach context snapshots?
- Which session and persistence responsibilities remain in Pi, and which projections must Omni store?

### Context questions

- What is the maximum context snapshot size?
- What should happen when context is stale?
- Should context be push-based, pull-based, or both?
- How do we represent active, pinned, and background context?
- How do we avoid context becoming another global state dump?
- What runtime schema contract should custom providers use?
- Should formatting for Pi be owned entirely by each provider or allow a shared default?

### Testing questions

- What testing tools should we use for render-count/performance locks?
- What budgets are realistic for tab switching and streaming?
- How do we test SQLite migrations reliably?
- How do we test app restart/restore flows?
- How do we make performance regressions visible in CI?

## Current working recommendation

Start with five launcher-owned application primitives:

1. Workspace primitive
2. Agent primitive
3. Storage primitive
4. State primitive
5. Context primitive

Build in dependency order: Storage → State → Workspace → Context → Pi adapter/Agent UI.

This is a big bang rewrite. All existing views will be rebuilt on primitives.

Build the current/default agent session UI on top of the Pi adapter.

Ship Agent and Terminal as built-in workspace tabs. Allow browser, editor, file, and other views to be registered by users without changing core.

Keep v1 context mostly read-only and bounded.

Use one generic context envelope. Keep built-in Agent and Terminal payloads in core; keep custom payload types, validators, and formatters with their providers.

Do not duplicate Pi's agent customization mechanisms in Omni. Pi owns changes to agent behavior; Omni owns the surrounding application and context bridge.

Do not add capability/event/render primitives as public concepts yet unless the need becomes obvious.

Protect primitives with contract tests, integration tests, performance locks, and architecture boundaries from the beginning.

Use primitives as performance-safe Lego blocks that users and agents can build with, but cannot casually modify.

Keep main process primitive internals behind plain TypeScript service contracts. Keep Zustand + React Query in renderer.

Preserve all existing functionality: agent runtime, three-window architecture, workspace management, SQLite data, terminal PTY, update system, auth flow.

Decompose main.ts (1,927 lines) and agent.ts (1,663 lines) into focused modules.

Unify thread data into a single source of truth.

Add terminal persistence so sessions survive restart.

Full state restoration on app restart — exact same state when reopened.
