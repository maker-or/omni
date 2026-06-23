# Improvements

## Dependency setup and project import edge case

### Problem

On a first launch, dependency setup can take a long time. While setup is still incomplete, a user can add/import a project and the app may proceed into the main app flow even though the required runtime is not ready.

This can trigger a main-process crash like:

```text
A JavaScript error occurred in the main process

Uncaught Exception:

Error: spawn /Users/puji/.local/share/mise/bin/mise ENOENT
```

### Failure chain

1. Startup checks dependencies with `checkAllDependencies()`.
2. The app correctly detects cases where `git` exists, but `nodeMatch` or `bunMatch` is false.
3. Existing project buttons are disabled while `workspaceReady === false`.
4. The add/import project flow still allows creating a project.
5. `handleProjectCreated()` immediately calls `handleOpen(project.id)`, bypassing the `workspaceReady` guard.
6. `launch.complete(projectId)` activates the project and can reach `createMainWindow()`.
7. `startViteServer()` calls `getMisePath()` and then `spawn(cmd, ...)`.
8. `getMisePath()` can return `~/.local/share/mise/bin/mise` even when that executable does not exist.
9. The `spawn()` call does not handle the child process `error` event, so `ENOENT` can surface as an uncaught Electron main-process exception.

### Additional setup mismatch

The explicit onboarding setup path installs/verifies Mise, Node, and Bun:

- `installMise()`
- `installNodeAndBunWithMise()`

However, the startup background setup path can call `initializeWorkspaces()` directly when `nodeMatch` or `bunMatch` is false. `initializeWorkspaces()` later runs `mise exec -- bun install`, but does not itself guarantee that Mise, Node 24, and Bun 1.3 are installed first.

### Proposed fixes

1. Disable add/import project while `workspaceReady === false`, or allow adding the record but do not auto-open it until setup completes.
2. Add a defensive readiness check in `launch:complete` before activating a project.
3. Add a defensive readiness check in `projects:setActive`.
4. Make startup background setup use the same dependency installation path as onboarding before calling `initializeWorkspaces()`.
5. Change `getMisePath()` so it does not silently return a nonexistent fallback path.
6. Add an `error` listener to the Vite child process in `startViteServer()` and reject the promise cleanly on `spawn ENOENT`.
7. Surface dependency setup failures in the launcher UI with actionable messaging instead of allowing the app to proceed into the main window.
