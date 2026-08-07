# Omni (Pipper Code) Architecture Map

This document describes the current desktop client architecture. The app is a conventional Electron application: the packaged UI is bundled into `out/renderer`, while projects and agent sessions remain user-owned runtime state.

## Runtime shape

```text
Electron main process
├── SQLite projects, threads, auth, MCP, tabs, and worktrees
├── ACP agent connection manager
├── PTY terminal manager
├── launcher binary updater
└── preload bridge
    ├── main renderer: chat, projects, threads, tabs, diffs, terminal
    └── launch renderer: authentication and project selection
```

There is no companion window, visual edit mode, editor ACP session, workspace-code updater, `app-template`, or active workspace runtime. The main renderer is loaded with the normal electron-vite URL in development and `out/renderer/index.html` in packaged builds.

## Main process

- `electron/main.ts` owns windows, IPC registration, launch flow, native dialogs, launcher updates, and process cleanup.
- `electron/agent-connection-manager.ts` owns ACP connections and regular chat thread sessions. Composer draft text APIs (`setEditorText`, `getEditorText`, `pasteToEditor`, and `reportEditorText`) are unrelated to visual editing and remain available.
- `electron/db.ts` persists projects, threads, users, agent selections, MCP servers, and tab state in SQLite.
- `electron/terminal-manager.ts` and `electron/worktree-manager.ts` provide PTY and Git worktree operations against user project paths.
- `electron/dependency-installer.ts` provides GUI-friendly PATH setup and optional Git verification/installation. It does not install Mise, Node, or Bun for the UI.
- `electron/paths.ts` contains the small set of app-library paths still needed by launcher binary updates.

## Renderer

The renderer is built from `src/` by electron-vite. It includes:

- ACP chat, streaming turns, permissions, agent selection, subagents, and composer drafts.
- Project and thread navigation backed by SQLite.
- Worktree switching, diffs, terminals, MCP configuration, themes, and launcher update UI.
- Launch/authentication screens in `src/launch/`.

The preload API is the source of truth for renderer-to-main boundaries. Keep launcher update APIs (`omni.launcherUpdate`) separate from removed workspace-code update APIs (`omni.update`).

## Build and packaging

- `scripts/build.js` runs only `electron-vite build`.
- `electron-builder.yml` packages `out/main`, `out/preload`, and `out/renderer` plus the required native/runtime assets.
- No build step copies a source template into `~/Library/pipper/active`.
- Opening a project requires its path and agent plumbing only; it does not wait for a guest Vite server or dependency bootstrap.

## Persistence and updates

User data remains in Electron’s normal user-data directory, including SQLite state and any harmless leftovers from older releases. The launcher updater may use the Pipper library directory for downloaded app binaries. It does not promote or roll back application source code.

## ACP boundary

ACP agents are external CLI processes speaking JSON-RPC over stdio. `electron/agents/registry.ts` describes available agents, while `electron/agent-connection-manager.ts` owns connections, thread sessions, session updates, permissions, and cleanup. Renderer session state is reduced in `src/lib/acp-session-reducer.ts`.

When changing agent behavior, preserve reconnects, partial streams, permission responses, thread switching, and disposal across app shutdown.
