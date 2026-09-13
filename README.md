# Pipper

Pipper is a single interface to control your agents.

## Purpose

Every individual has a different way of working, so instead of us adapting to new tools and workflows, what if the tool could evolve around us? Think of it as a Claude Code or Codex instance customized to each individual's needs.

Pipper is built on ACP, so it supports many agents out of the box like Claude Code, Codex, Cursor, OpenCode, and Grok. This opens a completely new way to interact with all these agents from one place — e.g. use Sol as orchestrator to spin up Composer 2.5.

## INSTALLATION

You can download actaul application from the pipper[https://www.pipper.dev/download] both the mac and windows builds are unsigned to for mac after droping the DMG into your Applications folder. run the following command in the terminal `xattr -cr "/Applications/Pipper Code (Alpha).app"` for the windows build i have seens the its running in the older windows machine , i can do much here

## Architecture

Pipper is a normal Electron desktop client with a stable launcher and a bundled renderer. The packaged application loads its UI from `out/renderer`; it does not start a guest Vite server or require a mutable active workspace.

The renderer talks to the Electron main process through the preload bridge. Main-process responsibilities include SQLite-backed projects and threads, ACP agent sessions, terminals, worktrees, MCP configuration, authentication, and launcher binary updates. User projects remain separate Git repositories and are used as agent working directories.
