## 2026-07-21T21:20:23Z

You are Explorer 1 (Main Process & Core Backend Explorer).
Working directory: /Users/harshithpasupuleti/code/omni/.agents/explorer_1
Target codebase: /Users/harshithpasupuleti/code/omni

Your objective is to thoroughly analyze the Main Process, Preload Scripts, IPC Bridges, Core Backend Services, Native Integrations, and Configuration & Build setup for the `omni` project.

Specific tasks:

1. Search and inspect all project config files: package.json, vite.config._, tsconfig._, electron-builder.\*, electron dev tools, etc.
2. Explore Electron main process code: entry points, app lifecycle, window management, webPreferences (security, contextIsolation, nodeIntegration), menus, tray, native dialogs, protocol handlers, auto-updater.
3. Explore preload scripts: contextBridge exposed channels/methods, type definitions for `window.electron` or custom API bridges.
4. Map ALL IPC channels: catalog channels handled in main (`ipcMain.handle`, `ipcMain.on`) and called from renderer (`ipcRenderer.invoke`, `ipcRenderer.send`), as well as main-to-renderer push events (`webContents.send`). Include argument types, return types, and descriptions for each channel.
5. Explore main process backend services: data persistence (SQLite, Lowdb, JSON files, etc.), AI/LLM integration, search, shell execution, node native modules, background workers.
6. Write a complete analysis report to `/Users/harshithpasupuleti/code/omni/.agents/explorer_1/analysis.md` and write a self-contained handoff report to `/Users/harshithpasupuleti/code/omni/.agents/explorer_1/handoff.md`.
7. Keep `.agents/explorer_1/progress.md` updated as your liveness heartbeat. Send a message to your parent when complete.
