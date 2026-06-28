# Unsigned Launcher Update: Implementation and Release Plan

## 1. Purpose

Implement a temporary, conventional update path for the packaged Electron launcher used by Pipper Code alpha testers.

This system is separate from the existing agent-assisted workspace updater:

| Update system                 | Update unit                               | Location                                               | Installation method                                                |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| Launcher update               | Complete `Pipper Code (Alpha).app` bundle | `/Applications` or the user's chosen install directory | Download verified DMG, open it, quit Pipper, user replaces the app |
| Personalized workspace update | Editable React/Vite application source    | `~/Library/pipper/active`                              | Existing agent-assisted candidate/promotion flow                   |

The launcher updater must never edit the installed `.app` in place. It downloads a complete DMG and hands installation to Finder because the alpha application is unsigned.

This plan targets at most 15 internal and external alpha users for approximately one to two months. Reliability, diagnostics, and repairability take priority over silent installation and visual polish.

## 2. Settled product decisions

The following are requirements, not implementation choices left to the coding agent:

1. Builds are produced locally on an Apple Silicon Mac.
2. Release artifacts and the launcher manifest are distributed through public GitHub Releases. Vercel Blob is only an optional bridge for the old `latest.json` manifest URL.
3. Only macOS ARM64 is supported.
4. The launcher and personalized workspace have independent versions.
5. The launcher manifest contains only `schema_version`, `version`, `url`, and `sha256`.
6. The application checks for launcher updates automatically and on manual request.
7. The application does not download a launcher update until the user clicks `Download update`.
8. After download and verification, clicking `Install and quit` opens the DMG and immediately quits Pipper.
9. If the DMG cannot be opened, Pipper stays running and exposes recovery actions.
10. Launcher installation takes priority over a personalized update scheduled for quit. The personalized update remains scheduled for a later quit.
11. Launcher checks initialize independently of authentication, workspace initialization, Git, Mise, Bun, and the personalized updater.
12. `Later` dismisses the launcher notice only for the current Electron process. The notice returns on the next launch.
13. The marketing download page reads the same launcher manifest at runtime. Publishing a launcher release updates the website download without changing a DMG environment variable or rebuilding the marketing site.
14. Release assets are immutable. Do not overwrite or prune published GitHub release assets; publish a higher patch version for fixes.
15. Signing, notarization, `electron-updater`, x64 artifacts, delta downloads, silent replacement, and rollback automation are out of scope.

## 3. Verified current state

Verified against the repository on 2026-06-22.

| Area                        | Current behavior                                                                                         | Relevant code                                                  | Gap                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| Packaged launcher version   | Root package version is `0.0.0`                                                                          | `package.json`                                                 | No usable launcher release identity                                  |
| Packaged launcher files     | Electron main, preload, renderer, package, and `app-template` are packaged into ASAR/resources           | `electron-builder.yml`                                         | Requires full `.app` replacement                                     |
| macOS packaging             | Builds unsigned ARM64 DMG only with `identity: null`                                                     | `electron-builder.yml`                                         | Standard Electron automatic updater cannot be used                   |
| Personalized updater        | Updates `~/Library/pipper/active` through candidate validation and promotion                             | `electron/update-manager.ts`                                   | Correctly does not update the launcher                               |
| Protected launcher code     | `electron/`, update contracts, update UI, and launch update stage are rejected from personalized updates | `electron/update-validation.ts`                                | Must remain protected                                                |
| Main UI update notice       | Existing personalized update banner sits directly below the title bar                                    | `src/App.tsx`, `src/components/update-banner.tsx`              | New launcher banner must be clearly separate                         |
| Manual update button        | Header bell calls only `useUpdateStore().check()`                                                        | `src/App.tsx`                                                  | Must check both update systems                                       |
| Launch window               | Initializes personalized update state and renders only its progress dialog                               | `src/launch/app.tsx`, `src/launch/update-stage.tsx`            | Launcher notice must also be visible before entering a project       |
| IPC                         | Only `window.omni.update` exists                                                                         | `electron/preload.ts`, `src/electron.d.ts`, `electron/main.ts` | Needs a separate `window.omni.launcherUpdate` API                    |
| Version coupling            | `scripts/copy-template.js` uses root `package.json.version` as initial workspace version                 | `scripts/copy-template.js`                                     | Launcher-only version bumps would corrupt workspace version metadata |
| Release upload              | Publishes local DMGs and manifests through GitHub Releases                                               | `scripts/publish-launcher-github-release.ts`                   | Must verify public assets and never overwrite a published version    |
| Marketing download          | Compiles `PUBLIC_PIPPER_MAC_ARM64_DMG_URL` into the page                                                 | `marketing/src/pages/download.astro`                           | Would point to a deleted versioned artifact                          |
| Persistent application data | Customized workspace and update state live under `~/Library/pipper`                                      | `electron/workspace-manager.ts`                                | Full `.app` replacement preserves this data                          |
| Quit interception           | A personalized update scheduled for quit intercepts `before-quit` unless `quitAuthorized` is true        | `electron/main.ts`                                             | Launcher installation must intentionally bypass this once            |

## 4. Scope

### 4.1 In scope

- Independent launcher/workspace versioning.
- Strict parsing of a four-field launcher manifest.
- Startup and five-hour launcher update checks.
- Manual check through the existing header bell and a new Help menu entry.
- Explicit user-triggered DMG download.
- Streaming SHA-256 verification.
- Download cancellation, retry, cleanup, and bounded resource usage.
- Persistent launcher update state and crash recovery.
- Main-window banner, launch-window notice, download progress, failure dialog, and diagnostics dialog.
- `Install and quit` behavior that opens the DMG before authorizing quit.
- Coordination with the personalized updater and existing quit interception.
- Runtime marketing-page resolution of the latest DMG URL.
- Safe local build, publish, smoke-test, bridge, and repair runbooks.
- Unit and integration tests plus a real two-version macOS manual test.

### 4.2 Out of scope

- Developer ID signing, notarization, and stapling.
- `electron-updater`, Squirrel.Mac, Sparkle, or any equivalent updater framework.
- Automatic copying into `/Applications`.
- Privilege escalation or administrator-password prompts.
- Removing quarantine attributes programmatically.
- x64, universal, Windows, or Linux releases.
- Historical release retention after smoke testing.
- Partial/differential downloads or HTTP range resume.
- Mandatory releases, phased rollout, release notes, minimum OS, or launcher/workspace compatibility rules.
- Changes to the personalized update manifest or its agent-assisted candidate/promotion state machine, except the minimum coordination needed during quit.
- Update telemetry beyond existing application logs. This can be added later if required.

## 5. Architecture

```text
Local release machine
  package.json launcher version
       |
       v
electron-builder -> versioned ARM64 DMG
       |
       v
publish script -> Vercel Blob versioned DMG
       |                   |
       |                   +-> sha256
       v
desktop/launcher/latest.json
       |                   |
       |                   +-> Pipper LauncherUpdateManager
       |                   +-> marketing download page
       v
User clicks Download update
       |
       v
~/Library/pipper/launcher-updates/downloads/*.partial
       |
       +-> streaming size cap + SHA-256 verification
       v
~/Library/pipper/launcher-updates/downloads/pipper-<version>-arm64.dmg
       |
       v
Install and quit -> shell.openPath(dmg) -> authorize one quit -> app.quit()
       |
       v
User drags replacement app from DMG -> next launch confirms app.getVersion()
```

The launcher manager runs in Electron's main process. Renderers only receive typed state and invoke narrow IPC operations. Renderers never fetch manifests, write files, calculate hashes, or open arbitrary paths.

## 6. Version separation

### 6.1 Root package contract

Change the root package metadata to:

```json
{
  "name": "pipper-code-alpha",
  "version": "0.1.0",
  "pipper": {
    "workspaceVersion": "0.0.0"
  }
}
```

- `version` is the packaged Electron launcher version and is returned by `app.getVersion()`.
- `pipper.workspaceVersion` is the source version used to initialize a new editable workspace.
- Both values must be valid semantic versions.
- They may advance independently.

### 6.2 Template generation

Modify `scripts/copy-template.js` so it:

1. Reads and validates both root versions.
2. Copies the root package into `app-template/package.json` as it does today.
3. Rewrites only `app-template/package.json.version` to `pipper.workspaceVersion`.
4. Removes the `pipper` launcher-only metadata from the copied template package unless application code has a demonstrated need for it. Default: remove it.
5. Writes `app-template/installation.json.installed_version` from `pipper.workspaceVersion`, not the root launcher version.
6. Writes no commit identifiers into packaged installation metadata; the updater downloads the PR
   diff directly and uses local Git history only for accepted edit-mode changes.
7. Fails the build instead of emitting a warning when either version is absent or invalid. A release with ambiguous version metadata must not be built.

Existing users are unaffected because `~/Library/pipper/installation.json` is only created when missing. Launcher updates must never rewrite it.

### 6.3 Version rules

- Launcher release versions must increase monotonically.
- Rebuilding the same launcher version for publication is forbidden. Bump the patch version instead.
- A failed published launcher is repaired with a higher patch version. Do not publish a downgrade because installed clients reject manifests that are not newer.
- A workspace-only release changes `pipper.workspaceVersion` but does not require publishing a launcher DMG unless packaged launcher/template content also needs distribution to new installers.
- A launcher-only release changes root `version` and leaves `pipper.workspaceVersion` unchanged.

## 7. Launcher manifest

### 7.1 Exact schema

```json
{
  "schema_version": 1,
  "version": "0.2.0",
  "url": "https://github.com/<owner>/<repo>/releases/download/v0.2.0/pipper-0.2.0-arm64.dmg",
  "sha256": "64-lowercase-hex-characters"
}
```

Type contract:

```ts
export interface LauncherUpdateManifest {
  schema_version: 1;
  version: string;
  url: string;
  sha256: string;
}
```

### 7.2 Validation rules

`parseLauncherUpdateManifest(input, installedVersion)` must:

1. Require a plain JSON object.
2. Reject arrays, null, primitives, and unknown keys.
3. Require exactly schema version `1`.
4. Require `version` to use `major.minor.patch` with optional prerelease syntax consistent with the existing update parser.
5. Require `version` to be strictly greater than `app.getVersion()` when reporting an available update.
6. Treat equal or older versions as no update, not as a user-visible failure.
7. Require an HTTPS artifact URL.
8. Require the URL pathname to end in `.dmg` case-insensitively.
9. Require a 64-character hexadecimal SHA-256 and normalize it to lowercase.
10. Return a new normalized object rather than retaining the untrusted input object.

The parser must not accept optional fields. This prevents the temporary schema from silently expanding.

### 7.3 Manifest endpoint configuration

Add:

```text
VITE_PIPPER_LAUNCHER_UPDATE_MANIFEST_URL=https://github.com/<owner>/<repo>/releases/latest/download/latest.json
PUBLIC_PIPPER_LAUNCHER_UPDATE_MANIFEST_URL=https://github.com/<owner>/<repo>/releases/latest/download/latest.json
```

- The Electron main process reads `PIPPER_LAUNCHER_UPDATE_MANIFEST_URL`, falling back to `import.meta.env.VITE_PIPPER_LAUNCHER_UPDATE_MANIFEST_URL`.
- The marketing page reads `PUBLIC_PIPPER_LAUNCHER_UPDATE_MANIFEST_URL`.
- Automatic checks run only in packaged builds.
- Development builds remain testable when `PIPPER_ENABLE_LAUNCHER_UPDATES_IN_DEV=1` and a manifest URL is explicitly configured.
- Missing configuration produces a disabled/idle manager and one diagnostic log entry. It must not affect startup.

## 8. Filesystem and persisted state

### 8.1 Paths

```text
~/Library/pipper/launcher-updates/
├── state.json
└── downloads/
    ├── pipper-0.2.0-arm64.dmg.partial
    └── pipper-0.2.0-arm64.dmg
```

Use `getPipperLibraryPath()` for consistency with existing application state. Do not place launcher downloads inside `active`, `backup`, `candidate`, `previous`, shared dependencies, Electron's `.app`, `Downloads`, or temporary directories that macOS may clean unexpectedly.

Directory permissions should be owner-only where practical. State files must be written with mode `0600`, using the existing temporary-file, `fsync`, and atomic-rename pattern in `electron/update-state.ts`.

### 8.2 State contract

```ts
export const LAUNCHER_UPDATE_PHASES = [
  "idle",
  "checking",
  "available",
  "downloading",
  "downloaded",
  "failed",
] as const;

export type LauncherUpdatePhase = (typeof LAUNCHER_UPDATE_PHASES)[number];

export interface LauncherUpdateState {
  phase: LauncherUpdatePhase;
  current_version: string;
  manifest: LauncherUpdateManifest | null;
  downloaded_path: string | null;
  downloaded_sha256: string | null;
  error: string | null;
  updated_at: string;
  last_checked_at: string | null;
}

export interface LauncherDownloadProgress {
  received_bytes: number;
  total_bytes: number | null;
  percent: number | null;
}

export interface LauncherUpdateDiagnostics {
  current_version: string;
  pending_version: string | null;
  phase: LauncherUpdatePhase;
  manifest_url: string | null;
  artifact_url: string | null;
  download_path: string | null;
  expected_sha256: string | null;
  actual_sha256: string | null;
  last_checked_at: string | null;
  updated_at: string;
  last_error: string | null;
}
```

Download progress is broadcast in memory and is not persisted per chunk. Persisting every chunk would create needless disk writes. State changes are persisted.

`dismissed_for_session` belongs only in manager memory. It must reset to `false` each time Electron launches.

### 8.3 State transitions

```text
idle        -> checking
checking    -> idle | available | downloaded | failed
available   -> checking | downloading | idle | failed
downloading -> available | downloaded | failed
downloaded  -> checking | available | idle | failed
failed      -> checking | available | downloading | downloaded | idle
```

Same-phase transitions are allowed for state refreshes. All other transitions throw and are covered by tests.

### 8.4 Startup recovery

Before the first network check:

1. If `state.json` is absent, create an in-memory idle state. Do not write until a meaningful transition.
2. If `state.json` is malformed, rename it to `state.corrupt-<timestamp>.json`, start idle, and expose a diagnostic error. A malformed support file must not block Pipper startup.
3. Delete every stale `.partial` file. Downloads restart from byte zero; HTTP resume is out of scope.
4. If persisted phase is `checking`, recover to `idle`.
5. If persisted phase is `downloading`, recover to `available` when a valid manifest is present; otherwise recover to `idle`.
6. If phase is `downloaded`, require the final file to exist and be a regular file. If absent, recover to `available` with an error explaining that the downloaded installer was removed.
7. If `app.getVersion()` is equal to or newer than the pending manifest version, treat the launcher installation as successful: delete the old DMG, clear pending state, and enter `idle`.
8. If the running version is still older and the verified DMG exists, retain `downloaded` so the user can retry installation.
9. Never modify `~/Library/pipper/installation.json` during recovery.

## 9. LauncherUpdateManager behavior

Create one manager instance in `electron/main.ts`. It owns the manifest URL, fetch implementation, filesystem operations, download abort controller, timer, state, and broadcasts.

### 9.1 Initialization order

Initialize it after Electron is ready and the IPC handlers can be registered, but before dependency checks and `initializeWorkspaces()`.

Required startup sequence:

```text
app ready
  -> create LauncherUpdateManager
  -> register IPC
  -> recover launcher update state
  -> start five-hour timer
  -> fire non-blocking launcher check
  -> continue auth/dependency/workspace initialization
```

A launcher check failure must never delay creating the launch or main window.

### 9.2 Checking

`check()` must:

1. Return the existing in-flight check promise when called concurrently.
2. Avoid checking while a download is active. Return current state instead.
3. Set `checking`, preserving any valid downloaded installer until the response is parsed.
4. Fetch with `cache: "no-store"` and a 10-second timeout.
5. Require an HTTP 2xx response.
6. Parse JSON and validate the strict schema.
7. If the manifest version is equal to or older than the running launcher:
   - delete stale downloaded DMGs referenced by state;
   - clear the pending manifest;
   - enter `idle`.
8. If a newer manifest matches the already downloaded version and hash, retain `downloaded`.
9. If a newer manifest supersedes a previously pending version:
   - cancel an active old download first if applicable;
   - remove the old partial/final installer;
   - enter `available` for the new version.
10. On network or parse failure:

- retain a valid `downloaded` state because installation can still proceed;
- otherwise enter `failed` with a sanitized error;
- never throw into startup code.

11. Update `last_checked_at` only after receiving a response, whether valid or invalid.

Periodic interval: five hours, matching the personalized updater. Stop the interval in `will-quit`.

### 9.3 Downloading

`download()` must:

1. Require phase `available` or retryable `failed` with a valid manifest.
2. Return the existing download promise when invoked twice.
3. Reject when another launcher version is already downloading.
4. Create the download directory recursively.
5. Delete a stale target `.partial` before starting.
6. Fetch the artifact URL, following redirects.
7. Revalidate that the final response URL uses HTTPS.
8. Require an HTTP 2xx response and a non-null response body.
9. If `content-length` is present, reject invalid, negative, or larger-than-limit values before writing.
10. Apply a hard maximum of 1 GiB while streaming, even if `content-length` is absent or false.
11. Apply a 30-minute total timeout. A user may retry on a slow connection.
12. Stream chunks to the `.partial` file while updating one SHA-256 instance. Do not buffer the full DMG in memory.
13. Broadcast progress no more frequently than every 100 ms to avoid renderer churn.
14. `fsync` and close the partial file after the stream ends.
15. Compare the lowercase calculated hash using a timing-safe comparison after validating equal lengths.
16. On match, atomically rename `.partial` to the final versioned `.dmg` filename and persist `downloaded` with the actual hash.
17. On cancellation, timeout, HTTP error, disk-full error, stream error, size overflow, or hash mismatch:

- close the file descriptor;
- delete the partial file;
- enter `available` for explicit cancellation;
- enter `failed` for all other failures;
- preserve a concise supportable error message.

The content type may be checked for diagnostics, but the download must accept both `application/x-apple-diskimage` and `application/octet-stream`. SHA-256 is the integrity gate.

### 9.4 Cancel download

`cancelDownload()` aborts the active fetch, waits for stream cleanup, removes the partial file, and returns to `available`. It is idempotent.

### 9.5 Install and quit

`installAndQuit()` is coordinated in `electron/main.ts` because it needs access to `app`, `shell`, `quitAuthorized`, and personalized-update state.

Required algorithm:

1. Require persisted phase `downloaded`.
2. Reject if the personalized updater is in any busy phase from `preparing` through `rolling-back`.
3. Allow installation when a personalized update is only `scheduled`.
4. Recheck that the DMG exists and is a regular file.
5. Recalculate SHA-256 immediately before opening it. Compare against the manifest again. This detects post-download deletion or modification.
6. Call `shell.openPath(dmgPath)` and await its result.
7. Electron returns an empty string on success. Only then set `quitAuthorized = true`.
8. If `shell.openPath` returns a non-empty error or throws:
   - do not change `quitAuthorized`;
   - do not quit;
   - enter `failed` while retaining the verified DMG path;
   - show `Open download folder`, `Download in browser`, and `Retry` actions.
9. On success, call `app.quit()` immediately.
10. Existing `will-quit` cleanup stops agents, PTYs, analytics, timers, and the Vite process.
11. Because `quitAuthorized` is true, `before-quit` skips the personalized updater for this quit. Its persisted `scheduled_for_quit` remains true for a later quit.

Do not mark the launcher update complete before the newer `app.getVersion()` is observed on a later launch.

### 9.6 Reset and repair operations

Expose narrow manager methods:

- `retryDownload()`: equivalent to `download()` with stale partial cleanup.
- `openDownloadFolder()`: call `shell.showItemInFolder()` only for the manager-owned final or partial path.
- `downloadInBrowser()`: call `shell.openExternal()` only with the already validated manifest artifact URL.
- `clearDownloadedUpdate()`: cancel work, delete manager-owned partial/final files, keep a valid newer manifest, and return to `available`; otherwise return to `idle`.
- `getDiagnostics()`: return the typed diagnostics object.
- `copyDiagnostics()`: renderer formats diagnostics and uses a narrow main-process clipboard IPC, or main process formats and writes it. Preferred: main process returns a preformatted, redacted string and renderer uses a dedicated IPC to copy it.

Diagnostics must replace the user's home-directory prefix with `~`. They must not include environment variables, auth records, tokens, project names, project paths, prompts, terminal output, or workspace diffs.

## 10. IPC and renderer API

Add a separate namespace. Do not overload `window.omni.update`.

```ts
launcherUpdate: {
  check(): Promise<LauncherUpdateState>;
  getState(): Promise<LauncherUpdateState>;
  download(): Promise<LauncherUpdateState>;
  cancelDownload(): Promise<LauncherUpdateState>;
  dismissForSession(): Promise<LauncherUpdateState>;
  installAndQuit(): Promise<{ success: boolean; error?: string }>;
  retryDownload(): Promise<LauncherUpdateState>;
  openDownloadFolder(): Promise<void>;
  downloadInBrowser(): Promise<void>;
  clearDownloadedUpdate(): Promise<LauncherUpdateState>;
  getDiagnostics(): Promise<LauncherUpdateDiagnostics>;
  copyDiagnostics(): Promise<void>;
  onStateChanged(callback): () => void;
  onProgress(callback): () => void;
}
```

IPC channel names:

```text
launcher-update:check
launcher-update:getState
launcher-update:download
launcher-update:cancelDownload
launcher-update:dismissForSession
launcher-update:installAndQuit
launcher-update:retryDownload
launcher-update:openDownloadFolder
launcher-update:downloadInBrowser
launcher-update:clearDownloadedUpdate
launcher-update:getDiagnostics
launcher-update:copyDiagnostics
launcher-update:stateChanged
launcher-update:progress
```

Validate every IPC precondition in the main process. Renderer state is untrusted.

## 11. Renderer store

Create `src/store/launcher-update-store.ts` with:

```ts
interface LauncherUpdateStore {
  state: LauncherUpdateState | null;
  progress: LauncherDownloadProgress | null;
  diagnosticsOpen: boolean;
  initialize(): Promise<() => void>;
  check(): Promise<void>;
  download(): Promise<void>;
  cancelDownload(): Promise<void>;
  dismissForSession(): Promise<void>;
  installAndQuit(): Promise<void>;
  retryDownload(): Promise<void>;
  clearDownloadedUpdate(): Promise<void>;
  setDiagnosticsOpen(open: boolean): void;
}
```

Requirements:

- `initialize()` fetches current state before subscribing, matching the existing update store pattern.
- It unregisters both event listeners during cleanup.
- Button actions expose a local pending flag or derive disabled state from the manager phase so double-clicking cannot trigger duplicate requests.
- Failed IPC calls refresh state from `getState()` and open diagnostics instead of leaving stale loading UI.
- The store does not contain filesystem paths or URLs not supplied by the typed main-process API.

## 12. UI specification

### 12.1 Naming

Avoid calling both systems simply “Pipper update.” Use:

- **Application update** for the packaged launcher.
- **Personalized update** for the agent-assisted editable workspace update.

The user does not need to understand Electron, ASAR, or update agents.

### 12.2 Main-window placement

Render `<LauncherUpdateBanner />` directly below the title-bar `<header>` and before the existing `<UpdateBanner />` in `src/App.tsx`.

Stacking order:

```text
Title bar
Application update banner, when applicable
Personalized update banner, when applicable
Workspace panels
```

Use the existing banner visual language:

```text
flex items-center gap-3 border-b border-border bg-surface-2 px-4 py-2 text-sm
```

Add a small download/application icon before the text to distinguish it from the personalized banner. Buttons use the existing `Button` component with `size="sm"`.

### 12.3 Banner states and exact copy

#### Available

```text
[icon] Pipper application update 0.2.0 is available.
       Your projects and customizations stay unchanged.

                                      [Details] [Later] [Download update]
```

- `Details` opens diagnostics.
- `Later` dismisses only for this Electron session.
- `Download update` starts the explicit download.

#### Downloading

```text
[icon] Downloading Pipper 0.2.0… 46%
       109 MB of 238 MB

                                                   [Details] [Cancel]
```

- When total size is unknown, omit percentage and show received bytes only.
- Include a thin progress track under the text using existing color tokens.
- `Cancel` returns to available.

#### Downloaded

```text
[icon] Pipper 0.2.0 is ready to install.
       The installer will open and Pipper will quit.

                                      [Details] [Later] [Install and quit]
```

`Later` hides the banner for this session but retains the verified DMG.

#### Failed

```text
[warning] Application update failed.
          <sanitized one-line error>

                                     [Details] [Later] [Retry download]
```

If the failure happened while opening an already verified DMG, the primary action is `Open download folder`, with `Download in browser` available in Details.

### 12.4 Launch-window placement

Launcher checking must work before auth and workspace readiness. Render a compact `<LauncherUpdateNotice />` in every `LaunchApp` branch, including checking-auth and unauthenticated branches.

Because the launch window has no title-bar content area suitable for a full-width banner, use a fixed bottom card:

```text
fixed left-4 right-4 bottom-4 z-[350]
rounded-xl border border-border bg-surface-2 p-3 shadow-xl
```

It uses the same state copy and actions but may wrap buttons below text on narrow widths. It must not cover primary authentication or project actions; add bottom padding to stage content when the notice is present.

Downloading and failure details use the shared diagnostics dialog.

### 12.5 Diagnostics dialog

Use the existing update-dialog overlay conventions:

```text
fixed inset-0 z-[450] grid place-items-center bg-black/60 backdrop-blur-sm
width: min(620px, calc(100vw - 32px))
```

Title: `Application update details`

Display a two-column definition list:

- Current version
- Available version
- Status
- Last checked
- Manifest URL
- Download location
- Expected SHA-256
- Downloaded SHA-256
- Last error

Long values wrap using monospace text. Home paths display with `~`.

Contextual actions:

- `Retry download` when available/failed.
- `Cancel download` while downloading.
- `Open download folder` when a manager-owned path exists.
- `Download in browser` when a validated artifact URL exists.
- `Clear downloaded update` when a partial or final installer exists. Require an inline confirmation because it deletes the local installer.
- `Copy diagnostics` always.
- `Close` always.

### 12.6 Header bell

The existing bell remains the single manual “Check for updates” control.

On click:

```ts
await Promise.allSettled([window.omni.launcherUpdate.check(), window.omni.update.check()]);
```

Show the existing “Checking for updates” toast immediately. Do not claim the app is up to date in that toast. State broadcasts determine which banner appears.

If one check fails and the other succeeds, do not fail the combined action. The failed system exposes its own details.

### 12.7 Application menu

Add a `Help` menu on macOS with:

```text
Check for Updates…
Application Update Details…
```

- `Check for Updates…` invokes both managers and broadcasts results.
- `Application Update Details…` broadcasts a request that opens the diagnostics dialog in the focused main or launch window.
- If no window exists, create/show the launch window before broadcasting.

This gives support a deterministic path that does not depend on a visible banner.

### 12.8 Unsigned-app installation guidance

Before `Install and quit`, the dialog must state:

```text
The installer will open and Pipper will quit. Drag Pipper Code (Alpha) into
Applications and choose Replace. Then reopen Pipper. Your projects and
customizations are stored separately and will remain unchanged.
```

The marketing download page must retain unsigned-app troubleshooting. Prefer the user-facing macOS flow first:

1. Control-click the replaced application and choose Open.
2. If macOS still blocks it, open System Settings > Privacy & Security and choose Open Anyway.
3. Keep the existing `xattr -cr` command as an explicit last-resort alpha-support step, corrected to the exact product bundle name and path.

Do not run `xattr`, clear quarantine, or execute terminal commands from Pipper.

## 13. Marketing download page

Replace the compiled direct DMG URL with the manifest URL.

Required behavior in `marketing/src/pages/download.astro`:

1. Render the ARM64 download card disabled with text `Checking latest version…`.
2. On page load, fetch `PUBLIC_PIPPER_LAUNCHER_UPDATE_MANIFEST_URL` with `cache: "no-store"`.
3. Apply the same four-field validation appropriate for browser code: schema, semver-shaped version, HTTPS DMG URL, SHA string.
4. Set the card `href` to `manifest.url`.
5. Set `#version-label` to `Version <version>`.
6. Enable the card and label it `Apple Silicon (arm64) / .dmg`.
7. On failure, leave the card disabled and show `Download temporarily unavailable. Try again.` with a retry button.
8. Do not expose the SHA as a security claim unless the page also explains how to verify it. It may be shown in advanced troubleshooting.
9. Keep the unsigned launch notice and correct the product name/path capitalization.

The browser implementation may duplicate minimal schema validation rather than importing Electron code into Astro's client bundle.

## 14. Release artifact and Vercel Blob design

### 14.1 Artifact naming

Configure electron-builder:

```yaml
mac:
  artifactName: pipper-${version}-${arch}.${ext}
```

Expected artifact:

```text
release/pipper-0.2.0-arm64.dmg
```

Ignore generated `.blockmap` and `latest-mac.yml` for this temporary updater. Do not upload them.

### 14.2 GitHub release assets

Each launcher version uses a GitHub release tag:

```text
v0.2.0
```

Attach exactly these assets:

```text
pipper-0.2.0-arm64.dmg
latest.json
```

The manifest URL configured in launcher builds and marketing should be:

```text
https://github.com/<owner>/<repo>/releases/latest/download/latest.json
```

The manifest's `url` field must point to the immutable versioned DMG asset, not a `/latest/` URL.

### 14.3 Publish script responsibilities

`scripts/publish-launcher-github-release.ts` publishes the GitHub release. It must:

1. Read and validate root `package.json.version`.
2. Require exactly one DMG matching `pipper-<version>-arm64.dmg`.
3. Refuse ambiguous or differently versioned DMGs.
4. Calculate local SHA-256 and size.
5. Generate the exact four-field manifest in `release/latest.json`.
6. Refuse to overwrite a completed GitHub release.
7. Create release `v<version>` with the DMG and manifest assets.
8. Mark the release as latest.
9. Fetch and validate both the tag manifest and `/releases/latest/download/latest.json`.
10. Download the public GitHub DMG and verify SHA-256 before reporting success.

`scripts/publish-launcher-blob-bridge.ts` is bridge-only. It may overwrite the old Vercel Blob `desktop/launcher/latest.json` with the GitHub manifest, but it must never upload a DMG to Blob.

## 15. Package scripts

Add or normalize these scripts:

```json
{
  "scripts": {
    "build": "node scripts/build.js",
    "dist": "electron-builder --mac --arm64",
    "release:launcher:publish": "bun scripts/publish-launcher-github-release.ts",
    "release:launcher:bridge": "bun scripts/publish-launcher-blob-bridge.ts"
  }
}
```

Do not create one command that builds and publishes without human inspection. Publication is externally visible.

## 16. Exact release runbook

This runbook is part of the deliverable. Add it to `docs/launcher-release-runbook.md` or keep it as a clearly linked section in this document.

### 16.1 One-time bootstrap

1. Set the public GitHub release repository without committing secrets:

   ```bash
   export PIPPER_RELEASE_REPOSITORY='<owner>/<repo>'
   ```

2. Establish the fixed manifest URL in root and marketing environment configuration:

   ```text
   VITE_PIPPER_LAUNCHER_UPDATE_MANIFEST_URL=https://github.com/<owner>/<repo>/releases/latest/download/latest.json
   PUBLIC_PIPPER_LAUNCHER_UPDATE_MANIFEST_URL=https://github.com/<owner>/<repo>/releases/latest/download/latest.json
   ```

3. Confirm no secret is committed:

   ```bash
   git status --short
   rg -n "BLOB_READ_WRITE_TOKEN|GITHUB_TOKEN" .env* package.json marketing --hidden
   ```

4. Publish the first GitHub release. The first updater-enabled build cannot update itself until a later version is published. Test the complete flow using two launcher versions, for example `0.1.0` installed and `0.1.1` published.

### 16.2 Prepare a launcher release

1. Start from the repository root:

   ```bash
   cd /Users/harshithpasupuleti/code/omni
   ```

2. Confirm branch and working tree:

   ```bash
   git branch --show-current
   git status --short
   ```

   Release from the intended commit. Do not accidentally package unrelated uncommitted changes.

3. Update root `package.json.version` to the next launcher version. Leave `pipper.workspaceVersion` unchanged for a launcher-only release.

4. Refresh dependency metadata if the package edit changes the lockfile representation:

   ```bash
   bun install
   ```

5. Confirm both versions explicitly:

   ```bash
   node -e 'const p=require("./package.json"); console.log({launcher:p.version, workspace:p.pipper.workspaceVersion})'
   ```

6. Run the repository quality gates:

   ```bash
   bun run fmt:check
   bun run lint
   bun run test
   bun run build
   ```

   Stop on the first failure. Do not publish a build that fails any configured gate.

### 16.3 Build the DMG

1. Remove stale local release artifacts so discovery cannot select an old DMG:

   ```bash
   rm -rf release
   ```

2. Build the unsigned ARM64 distribution:

   ```bash
   bun run dist
   ```

3. Inspect output:

   ```bash
   find release -maxdepth 1 -type f -print
   ls -lh release/*.dmg
   shasum -a 256 release/*.dmg
   ```

4. Require exactly one filename matching the launcher version:

   ```text
   release/pipper-<launcher-version>-arm64.dmg
   ```

### 16.4 Local smoke test before publication

1. Open the DMG:

   ```bash
   open release/pipper-<launcher-version>-arm64.dmg
   ```

2. Copy the app to a temporary test directory, not over the currently used alpha app.
3. Control-click and choose Open if Gatekeeper requires approval.
4. Verify:
   - the launch window renders;
   - a project can be opened;
   - current launcher version in diagnostics is correct;
   - personalized workspace version remains unchanged;
   - existing `~/Library/pipper` state is visible;
   - automatic launcher checking does not block startup.
5. Quit the test copy.

### 16.5 Publish

1. Confirm the release repository is set or can be inferred from `origin`:

   ```bash
   test -n "$PIPPER_RELEASE_REPOSITORY" && echo "$PIPPER_RELEASE_REPOSITORY"
   ```

2. Publish the GitHub release with the versioned DMG and `latest.json`:

   ```bash
   bun run release:launcher:publish
   ```

3. Copy the printed manifest URL and verify it independently:

   ```bash
   export LAUNCHER_MANIFEST_URL='https://github.com/<owner>/<repo>/releases/latest/download/latest.json'
   curl -fsSL "$LAUNCHER_MANIFEST_URL" | jq .
   ```

4. Extract and inspect the artifact URL:

   ```bash
   export LAUNCHER_DMG_URL="$(curl -fsSL "$LAUNCHER_MANIFEST_URL" | jq -r .url)"
   curl -I -L "$LAUNCHER_DMG_URL"
   ```

5. Do not overwrite or delete published release assets.

### 16.6 End-to-end update smoke test

Use an installed previous-version Pipper build:

1. Launch the older app.
2. Click the header bell or Help > Check for Updates.
3. Confirm the application-update banner shows the published version.
4. Click `Download update`.
5. Confirm progress updates and the app stays usable.
6. Confirm the banner changes to ready-to-install only after hash verification.
7. Open Details and verify current/pending versions and matching expected/downloaded hashes.
8. Click `Install and quit`.
9. Confirm the DMG opens before Pipper exits.
10. Drag the new app to Applications and choose Replace.
11. Reopen Pipper using the unsigned-app approval flow if necessary.
12. Confirm:
    - diagnostics report the new launcher version;
    - pending update state is cleared;
    - downloaded DMG is removed;
    - projects, threads, customizations, and personalized update state remain intact;
    - the marketing download page points to the same new DMG.

### 16.7 Bridge the old manifest URL

Only if already installed launchers still read the old Vercel Blob manifest URL, publish the bridge manifest after the GitHub release succeeds:

```bash
export BLOB_READ_WRITE_TOKEN='...'
bun run release:launcher:bridge
```

Then verify the old Blob `latest.json` points at the GitHub DMG. No DMG should be uploaded to Blob.

### 16.8 Commit and distribute

Commit source/version changes only after verification according to the team's normal Git workflow. Send alpha users a short instruction:

```text
Pipper will show an application-update banner. Click Download update, then
Install and quit. When the DMG opens, drag Pipper Code (Alpha) into Applications
and choose Replace. Reopen it. Your projects and customizations remain unchanged.
```

## 17. Support and machine-repair runbook

When a tester reports a failure:

1. Ask them to open `Help > Application Update Details…`.
2. Ask them to click `Copy diagnostics` and send the result.
3. Determine the phase:

| Phase/error                                    | First action                                                    | Fallback                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Manifest check failed                          | Retry Check for Updates                                         | Verify internet and open manifest URL in browser                             |
| Download HTTP failure                          | Retry download                                                  | Download in browser                                                          |
| Disk full / write failure                      | Free at least 1 GiB, clear downloaded update, retry             | Browser download to another volume                                           |
| Hash mismatch                                  | Clear downloaded update and retry                               | Republish a higher patch version if remote artifact/manifest disagree        |
| DMG removed                                    | Retry download                                                  | Download in browser                                                          |
| DMG cannot open                                | Open download folder and double-click                           | Browser download                                                             |
| App replaced but macOS blocks launch           | Control-click > Open                                            | Privacy & Security > Open Anyway, then last-resort documented `xattr -cr`    |
| App reopens at old version                     | User did not replace the installed copy or launched a duplicate | Locate running app via Finder, remove duplicate, repeat replacement          |
| Banner still says downloaded after replacement | Running launcher version is still old                           | Confirm `app.getVersion()` in diagnostics and actual app path                |
| Personalized update runs unexpectedly          | Launcher quit was not authorized correctly                      | Inspect `quitAuthorized` ordering and persisted personalized scheduled state |

For deeper manual inspection on a tester's machine:

```bash
ls -la "$HOME/Library/pipper/launcher-updates"
find "$HOME/Library/pipper/launcher-updates" -maxdepth 2 -type f -print
sed -n '1,240p' "$HOME/Library/pipper/launcher-updates/state.json"
```

Do not ask a tester to delete `~/Library/pipper`. That directory contains their customized application state. If reset is required, delete only `~/Library/pipper/launcher-updates` after collecting diagnostics.

## 18. Failure modes and expected behavior

| Failure                                          | Required outcome                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Manifest URL missing                             | Launcher updater disabled; application starts normally; diagnostics explain missing configuration        |
| Offline startup                                  | Application starts normally; failed state is available later; previous verified installer remains usable |
| Manifest timeout                                 | Abort after 10 seconds; no startup delay because check is non-blocking                                   |
| Malformed JSON                                   | Reject; never attempt download                                                                           |
| Unknown manifest field                           | Reject strict schema                                                                                     |
| Equal/older version                              | Enter idle; never offer downgrade                                                                        |
| HTTP redirect to non-HTTPS                       | Reject artifact download                                                                                 |
| Duplicate check click                            | Reuse in-flight promise                                                                                  |
| Duplicate download click                         | Reuse in-flight promise and write one file                                                               |
| Cancel during download                           | Abort, close, delete partial, return available                                                           |
| App quits/crashes during download                | Startup removes partial and returns available                                                            |
| Missing content length                           | Stream with 1 GiB hard cap and unknown-total progress                                                    |
| False content length                             | Streaming hard cap still applies; hash remains authority                                                 |
| Disk full                                        | Close/delete partial; failed state; Pipper continues running                                             |
| Hash mismatch                                    | Delete partial/final target; failed state; never show Install                                            |
| Final DMG modified after verification            | Pre-install rehash fails; Pipper stays running                                                           |
| `shell.openPath` failure                         | Pipper stays running; recovery actions visible                                                           |
| Personalized update busy                         | Disable/reject Install and quit with explicit explanation                                                |
| Personalized update only scheduled               | Open launcher DMG, authorize quit, leave personalized schedule persisted                                 |
| User opens DMG but does not replace app          | Old launcher shows downloaded state on next launch and can retry                                         |
| User installs new launcher                       | Startup version comparison clears pending state and DMG                                                  |
| Newer release appears while older DMG downloaded | Remove stale older DMG and offer new release                                                             |
| Corrupt state JSON                               | Preserve renamed corrupt file for support; recover idle; never block startup                             |
| GitHub publish fails before release publication  | Existing clients still see the previous latest release                                                   |
| GitHub publish leaves a partial release          | Inspect assets and rerun publish with `--resume` only to upload missing assets                           |
| Bad release discovered after publication         | Rebuild/fix and publish a higher patch version; do not overwrite existing assets                         |

## 19. Testing plan

### 19.1 Unit tests

Add `electron/launcher-update-manifest.test.ts`:

1. Accept valid manifest.
2. Normalize SHA to lowercase.
3. Reject null/array/primitive input.
4. Reject missing required field.
5. Reject unknown field.
6. Reject unsupported schema.
7. Reject malformed semantic version.
8. Return no-update result for equal version.
9. Return no-update result for older version.
10. Reject HTTP artifact URL.
11. Reject non-DMG URL.
12. Reject malformed SHA-256.
13. Handle prerelease ordering consistently.

Add `electron/launcher-update-state.test.ts`:

1. Default idle state.
2. Every allowed transition.
3. Representative rejected transitions.
4. Atomic write/read round trip.
5. Malformed-state recovery behavior.
6. Downloaded state with missing file.
7. Recovery from checking.
8. Recovery from downloading.
9. Completion when current version reaches target.

Add `electron/launcher-update-manager.test.ts` with injected fetch, paths, clock, and shell-facing callbacks:

1. Concurrent checks share work.
2. Check discovers newer manifest.
3. Offline check does not throw into caller.
4. Existing verified download survives check failure.
5. Superseding manifest removes stale installer.
6. Successful streamed download produces matching final file.
7. Progress is emitted.
8. Missing content length succeeds below cap.
9. Over-limit content length rejects before writing.
10. Streaming beyond cap aborts.
11. Cancellation removes partial.
12. Timeout removes partial.
13. Disk write failure removes partial.
14. Hash mismatch removes partial and blocks installation.
15. Duplicate download calls share work.
16. Pre-install rehash detects modification.

Extract pure artifact-discovery, manifest-generation, and release-publication functions from the upload script and test:

1. Exact expected DMG selected.
2. No DMG fails.
3. Multiple DMGs fail.
4. Version mismatch fails.
5. Manifest fields generated exactly.
6. Existing completed release is not overwritten.
7. Partial release resume uploads only missing assets.
8. Blob bridge manifest points to the GitHub DMG.

### 19.2 Renderer tests

The repository currently has no established React component-test stack. Do not add a large browser-test dependency solely for this temporary updater unless implementation work establishes one for other features.

At minimum, keep banner state mapping in a pure function and unit-test:

- available copy/actions;
- downloading known/unknown total;
- downloaded copy/actions;
- generic failure;
- open-installer failure;
- session dismissal.

### 19.3 Manual packaged-app matrix

All rows must be executed against packaged DMGs, not only `bun run dev`.

| Scenario                                 | Expected result                             |
| ---------------------------------------- | ------------------------------------------- |
| Old launcher, no manifest update         | No banner                                   |
| Old launcher, newer manifest             | Banner in main and launch windows           |
| Click Later                              | Hidden until process restart                |
| Successful download                      | Progress then ready state                   |
| Cancel midway                            | Partial deleted; available state            |
| Disconnect midway                        | Failed state; retry works                   |
| Replace remote hash with incorrect value | Install never offered                       |
| Delete downloaded DMG in Finder          | Recovery offers redownload                  |
| Modify downloaded DMG                    | Install-time hash catches it                |
| Personalized update scheduled            | Launcher opens and quits; schedule survives |
| Personalized update actively running     | Install is blocked                          |
| Install and reopen same old app          | Downloaded notice returns                   |
| Replace and reopen new app               | State and downloaded DMG clear              |
| Marketing page after publish             | Links exact manifest DMG URL                |
| Gatekeeper rejection                     | Documented support flow restores launch     |

## 20. Implementation sequence

```text
1. Version separation
      |
      +-> 2. Contracts + manifest parser + state persistence
      |          |
      |          +-> 3. Manager check/download/recovery
      |                         |
      |                         +-> 4. IPC + preload + typing
      |                                      |
      |                                      +-> 5. Store + UI + menu
      |
      +-> 6. Versioned build/upload/manifest pipeline
                       |
                       +-> 7. Marketing runtime manifest

3 + 5 + 6 + 7 -> 8. Packaged two-version E2E and release runbook validation
```

### Step 1: Separate versions

Files:

- `package.json`
- `scripts/copy-template.js`
- `scripts/copy-template.test.ts` or equivalent extracted-function tests

Verification:

- Root package exposes launcher version.
- Generated template package exposes workspace version.
- Generated installation metadata exposes workspace version.
- Existing personalized update tests still pass.

### Step 2: Add contracts, parser, and persisted state

Files:

- `contracts/launcher-updates.ts`
- `electron/launcher-update-manifest.ts`
- `electron/launcher-update-state.ts`
- corresponding tests

Verification:

```bash
bun run test electron/launcher-update-manifest.test.ts electron/launcher-update-state.test.ts
```

### Step 3: Implement the manager

Files:

- `electron/launcher-update-manager.ts`
- `electron/launcher-update-manager.test.ts`

Build dependency injection into the constructor so network, paths, clock, and broadcasts are testable without touching real Vercel Blob or the user's `~/Library/pipper`.

### Step 4: Wire main process and IPC

Files:

- `electron/main.ts`
- `electron/preload.ts`
- `src/electron.d.ts`

Verification:

- Manager initializes before workspace setup.
- IPC calls are narrow and typed.
- timer stops on quit.
- launcher install bypasses only the current personalized scheduled-quit interception.

### Step 5: Implement UI

Files:

- `src/store/launcher-update-store.ts`
- `src/components/launcher-update-banner.tsx`
- `src/components/launcher-update-dialog.tsx`
- `src/launch/launcher-update-notice.tsx`
- `src/App.tsx`
- `src/launch/app.tsx`
- `electron/main.ts` Help menu integration

Verification:

- Every state/action matches Section 12.
- Both update systems can be visible without ambiguous naming.
- launch-window notice renders regardless of auth/workspace readiness.

### Step 6: Implement release publication

Files:

- `electron-builder.yml`
- `scripts/publish-launcher-github-release.ts`
- `scripts/publish-launcher-blob-bridge.ts`
- upload-script tests
- `package.json` scripts

Verification:

- Exact versioned artifact.
- GitHub release upload includes DMG and manifest.
- Published latest manifest is verified.
- Public DMG download matches SHA-256.
- Blob bridge publishes only `latest.json`.

### Step 7: Update marketing

Files:

- `marketing/src/pages/download.astro`
- marketing environment example/configuration as applicable

Verification:

- Runtime fetch resolves current manifest.
- failure leaves safe disabled UI.
- unsigned-app guidance remains available.

### Step 8: Full validation

Commands:

```bash
bun run fmt:check
bun run lint
bun run test
bun run build
rm -rf release
bun run dist
```

Then execute Sections 16.4 through 16.7 with two actual launcher versions.

## 21. File reference table

| File                                          | Change                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `package.json`                                | Real launcher version, independent workspace version, release scripts             |
| `bun.lock`                                    | Refresh only if package metadata/dependencies require it                          |
| `electron-builder.yml`                        | Versioned ARM64 DMG artifact name; keep unsigned identity                         |
| `scripts/copy-template.js`                    | Rewrite copied template package to workspace version                              |
| `scripts/publish-launcher-github-release.ts`  | Safe GitHub release publication and verification                                  |
| `scripts/publish-launcher-blob-bridge.ts`     | Optional old-manifest bridge to GitHub-hosted DMGs                                |
| `contracts/launcher-updates.ts`               | New launcher manifest, state, progress, diagnostics contracts                     |
| `electron/launcher-update-manifest.ts`        | Strict four-field parser and version comparison                                   |
| `electron/launcher-update-state.ts`           | Atomic state persistence and transition validation                                |
| `electron/launcher-update-manager.ts`         | Check, download, verify, recover, diagnostics, cleanup                            |
| `electron/main.ts`                            | Early manager initialization, IPC, Help menu, install-and-quit coordination       |
| `electron/preload.ts`                         | Expose narrow `launcherUpdate` bridge                                             |
| `src/electron.d.ts`                           | Renderer API typing                                                               |
| `src/store/launcher-update-store.ts`          | Zustand state and subscriptions                                                   |
| `src/components/launcher-update-banner.tsx`   | Main-window application update banner                                             |
| `src/components/launcher-update-dialog.tsx`   | Progress, diagnostics, recovery, install confirmation                             |
| `src/launch/launcher-update-notice.tsx`       | Launch-window bottom notice                                                       |
| `src/App.tsx`                                 | Initialize store, render banner/dialog, combined bell check                       |
| `src/launch/app.tsx`                          | Initialize and render launcher notice in every stage                              |
| `marketing/src/pages/download.astro`          | Resolve latest version and DMG from runtime manifest                              |
| `docs/launcher-update-implementation-plan.md` | This implementation contract                                                      |
| `docs/launcher-release-runbook.md`            | Optional extracted operator runbook if the implementation agent splits Section 16 |
| `electron/launcher-update-*.test.ts`          | Parser, state, and manager tests                                                  |

## 22. Acceptance criteria

1. Root `package.json.version` and `pipper.workspaceVersion` can differ, and a generated `app-template` uses only the workspace version for its package and installation metadata.
2. A packaged launcher obtains its current launcher version from `app.getVersion()`.
3. Launcher update initialization and automatic checking occur without waiting for authentication, workspace initialization, Git, Mise, Bun, or the personalized updater.
4. A strict valid four-field manifest with a newer version produces `available`; malformed, unknown-field, non-HTTPS, invalid-SHA, equal, and older manifests never offer installation.
5. Startup and periodic network failures do not block opening Pipper.
6. The existing header bell checks both launcher and personalized updates.
7. A distinct application-update banner appears above the personalized-update banner in the main window.
8. A launcher update notice is visible in the launch window regardless of auth/workspace stage.
9. `Later` hides the notice for only the current Electron process.
10. No DMG download begins before explicit `Download update` action.
11. DMGs stream to a `.partial` file, remain under 1 GiB, and are never fully buffered in memory.
12. Only a completed DMG matching the manifest SHA-256 reaches `downloaded`.
13. Cancellation, timeout, disk error, stream error, oversize response, and hash mismatch close and remove the partial file.
14. The downloaded DMG is rehashed immediately before installation.
15. `Install and quit` awaits successful `shell.openPath()` before setting quit authorization and calling `app.quit()`.
16. Failure to open the DMG leaves Pipper running and exposes diagnostics, folder, browser-download, clear, and retry actions.
17. An active personalized update blocks launcher installation with an explicit message.
18. A personalized update merely scheduled for quit is skipped for the launcher-install quit and remains scheduled afterward.
19. Reopening the old launcher retains the downloaded installer and offers installation again.
20. Reopening the installed target-or-newer launcher clears pending state and removes the downloaded installer.
21. Launcher updater operations never modify `active`, `backup`, `candidate`, `previous`, shared dependencies, or `installation.json`.
22. Diagnostics contain the agreed support fields, redact the home prefix, and exclude tokens, auth data, project data, prompts, terminal output, and workspace content.
23. Publisher uploads and verifies the versioned GitHub DMG and `latest.json`.
24. Publisher never overwrites an existing completed GitHub release.
25. Publishing marks the release latest so `/releases/latest/download/latest.json` resolves.
26. The optional Blob bridge never uploads a DMG to Blob.
27. Marketing obtains version and DMG URL from `latest.json` at runtime and fails safely when it cannot.
28. The complete two-version packaged-app smoke test in Section 16.6 passes on Apple Silicon.
29. `bun run fmt:check`, `bun run lint`, `bun run test`, `bun run build`, and `bun run dist` pass.
30. Existing personalized update tests and behavior remain passing and unchanged except for the intentional launcher-install quit priority.

## 23. Rollback and fix-forward policy

### Before publication

Delete local `release/`, fix the source/version, rebuild, and rerun all gates.

### Publication fails before `latest.json`

Clients still see the previous release. Delete the unreferenced new blob or rerun publication after diagnosing the failure.

### Bad release discovered before pruning

Preferred response: fix the defect, increment the launcher patch version, rebuild, and publish. The previous DMG remains available for direct support while the fix is prepared.

Changing `latest.json` back to an older version does not downgrade clients that already installed the newer version and should not be treated as a complete rollback.

### Bad release discovered after pruning

Fix forward with a higher patch version. If necessary, rebuild the previous source as a higher patch release rather than reusing an old version number.

### Code rollback

Revert the implementation commit(s). Persisted `~/Library/pipper/launcher-updates` is isolated and can be ignored by older launchers. Do not delete `~/Library/pipper` globally.

## 24. Definition of done

The feature is done only when:

1. Every acceptance criterion is checked with evidence.
2. Automated tests cover manifest, state, manager, and publication pure functions.
3. A real older packaged launcher discovers and downloads a real newer Vercel Blob release.
4. Hash verification succeeds and a forced mismatch fails safely.
5. `Install and quit` opens the DMG before the old process exits.
6. The replacement launcher starts, clears pending state, and preserves all existing Pipper data.
7. The marketing page resolves the same current DMG.
8. The release and support runbooks have been followed once by someone other than the implementation agent, or by the owner from a clean shell without undocumented steps.
