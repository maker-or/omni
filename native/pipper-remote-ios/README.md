# PipperRemote (iOS, Siri-first)

Native SwiftUI companion that talks to the laptop's `RemoteServer`
(`electron/remote-server.ts`) over Tailscale — the same HTTP + bearer-token
surface the phone PWA uses. Its reason to exist is Siri:

> "Start a Pipper thread in FolkLore" → Siri asks "What should the thread
> work on?" → the laptop creates a `phone-xxxx` worktree + thread and runs the
> agent. The app never has to open.

## How it maps to the macOS Siri integration

| macOS (`native/pipper-intents`)                                     | iOS (this app)                                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Electron writes `siri-catalog.json` to `~/Library/pipper`           | Laptop serves it as `GET /api/remote/catalog`; app caches it in its own Application Support                         |
| `String` params + `DynamicOptionsProvider` (ad-hoc workaround)      | Real `AppEntity` (`ProjectEntity`, `AgentEntity`) + `EntityStringQuery` so Siri phrases can carry the project/agent |
| Intent stages `siri-requests/<id>.json`, opens `pipper://siri/<id>` | Intent POSTs `/api/remote/threads` directly (`modelId` = agent id)                                                  |
| App Intents **extension** (needs sandbox exceptions)                | Intents run **in the app process** — no App Group, so a personal (free) team is enough                              |

The catalog shape is identical on both sides (`RemoteCatalog` ⇔ `SiriCatalog`
in `electron/siri/siri-catalog.ts`): selected agents only, with `available`.
Siri resolves names against the on-disk cache (fast, works with the Mac
asleep); the app refreshes it on launch/foreground, after every intent, and on
demand from Settings, then calls `updateAppShortcutParameters()` so Siri
learns new project names.

## Layout

- `Sources/PipperRemoteCore/` — Foundation-only: wire models, `RemoteConfig`,
  `PairingURL` (parses the laptop QR `http://100.x:4173/remote#token=…`),
  `CatalogStore`, `RemoteClient`. `swift test` runs here on the Mac.
- `App/` — SwiftUI app, `RemoteSession` (pairing in Keychain + defaults,
  catalog), and `Intents/` (`StartThreadIntent`, `CheckMacIntent`, entities,
  `PipperRemoteShortcuts` phrases).
- `PipperRemote.xcodeproj` — single app target compiling both directories.

## Build & install

### Device (Siri by voice)

1. Open `PipperRemote.xcodeproj` in Xcode, select the `PipperRemote` target →
   Signing & Capabilities → pick your personal team. Change the bundle id if
   `com.maker-or.omni.remote` is taken on your team.
2. Run on the phone. Free provisioning profiles expire after 7 days — re-run
   from Xcode to renew.
3. Install Tailscale on the phone and join the Mac's tailnet.
4. Pair: scan the QR from Pipper → Settings → Remote access, or type the
   three fields printed by `bun run dev` under `[Remote] iOS app → Pair`.
5. Say "Start a Pipper thread in <project>". First-time phrase indexing can
   take a minute after install.

### Simulator (intent via the Shortcuts app; no Siri voice)

```bash
native/pipper-remote-ios/scripts/run-simulator.sh            # iPhone 17 Pro
native/pipper-remote-ios/scripts/run-simulator.sh "iPhone 17"
```

Then pair manually (the simulator has no camera) and test the intent from
**Shortcuts → + → "Start Pipper thread"**.

**Why the project re-signs simulator builds.** Xcode ad-hoc signs every
simulator build, and an ad-hoc bundle has no Team ID. App Intents then cannot
register the app's `AppEntity` types (`ProjectEntity is not a registered
AppEntity identifier` in the log), every entity parameter arrives `nil`, and
Shortcuts reports "could not run because an internal error occurred"
(`LNContextErrorDomain 2004`). This is the same failure the ad-hoc macOS
extension hit. The target sets `CODE_SIGNING_ALLOWED=NO` for the simulator
SDK and `scripts/sign-simulator.sh` signs with the first `Apple Development`
identity in the keychain instead, so both `xcodebuild` and Xcode's Run button
produce a working build. You need to be signed in to Xcode → Settings →
Accounts once so that identity exists. Never pass `CODE_SIGNING_ALLOWED=NO`
on the command line: it also disables the re-sign phase.

Core tests (no simulator needed): `cd native/pipper-remote-ios && swift test`.

## Phrases

App Shortcuts allow one entity parameter per phrase, so:

- `Start a thread in Pipper` / `Start a Pipper thread` / `New Pipper thread`
- `Start a Pipper thread in <project>` / `New Pipper thread in <project>`
- `Start a Pipper thread with <agent>` / `Ask <agent> in Pipper`
- `Is my Mac reachable in Pipper` / `Check my Mac with Pipper`

Siri always asks for the task (it is a required `String`). When no agent is
named, `perform()` uses the Mac's default agent from the catalog, falling back
to the first available one.

## Threat model

Plain HTTP on purpose, exactly like the PWA: the laptop only binds loopback +
Tailscale, so the bearer token only ever crosses the WireGuard tailnet. ATS is
opened (`NSAllowsArbitraryLoads`) for that reason. The token lives in the
Keychain with `AfterFirstUnlock` so Siri works from the lock screen.
